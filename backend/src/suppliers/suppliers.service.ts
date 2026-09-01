import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Supplier, SupplierSource, SupplierStatus } from './entities/supplier.entity';
import { SupplierCategory } from './entities/supplier-category.entity';
import { CreateSupplierDto, SearchSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SupplierCategory)
    private readonly categoryRepo: Repository<SupplierCategory>,
  ) {}

  private async resolveCategories(names?: string[]): Promise<SupplierCategory[]> {
    if (!names?.length) return [];
    const existing = await this.categoryRepo.find({ where: { name: In(names) } });
    const existingNames = new Set(existing.map((c) => c.name));
    const toCreate = names.filter((n) => !existingNames.has(n));
    const created = await this.categoryRepo.save(
      toCreate.map((name) => this.categoryRepo.create({ name })),
    );
    return [...existing, ...created];
  }

  async create(dto: CreateSupplierDto): Promise<Supplier> {
    const categories = await this.resolveCategories(dto.categoryNames);
    const supplier = this.supplierRepo.create({
      ...dto,
      country: dto.country ?? 'India',
      categories,
      source: SupplierSource.MANUAL,
    });
    return this.supplierRepo.save(supplier);
  }

  /** Bulk import from a CSV buffer (headers: legalName,email,phone,city,state,category,taxId,certifications). */
  async importCsv(buffer: Buffer): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const rows: Record<string, string>[] = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.email || !row.legalName) {
        skipped++;
        errors.push(`Skipped row missing legalName/email: ${JSON.stringify(row)}`);
        continue;
      }
      const exists = await this.supplierRepo.findOne({ where: { email: row.email } });
      if (exists) {
        skipped++;
        continue;
      }
      const categoryNames = row.category ? row.category.split(';').map((c) => c.trim()) : [];
      const categories = await this.resolveCategories(categoryNames);
      const certifications = row.certifications
        ? row.certifications.split(';').map((c) => c.trim())
        : undefined;

      const supplier = this.supplierRepo.create({
        legalName: row.legalName,
        email: row.email,
        phone: row.phone,
        city: row.city,
        state: row.state,
        taxId: row.taxId,
        certifications,
        categories,
        source: SupplierSource.CSV_IMPORT,
      });
      await this.supplierRepo.save(supplier);
      imported++;
    }

    return { imported, skipped, errors };
  }

  /** Search suppliers using filters; MVP uses ILIKE, upgrade to tsvector/pg_trgm for scale. */
  async search(dto: SearchSupplierDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const qb = this.supplierRepo
      .createQueryBuilder('supplier')
      .leftJoinAndSelect('supplier.categories', 'category')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .orderBy('supplier.rating', 'DESC');

    if (dto.q) {
      qb.andWhere(
        '(supplier.legalName ILIKE :q OR supplier.email ILIKE :q OR supplier.city ILIKE :q OR supplier.state ILIKE :q)',
        { q: `%${dto.q}%` },
      );
    }
    if (dto.category) {
      qb.andWhere('category.name ILIKE :category', { category: `%${dto.category}%` });
    }
    if (dto.city) {
      qb.andWhere('supplier.city ILIKE :city', { city: `%${dto.city}%` });
    }
    if (dto.state) {
      qb.andWhere('supplier.state ILIKE :state', { state: `%${dto.state}%` });
    }
    if (dto.status) {
      qb.andWhere('supplier.status = :status', { status: dto.status });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<Supplier> {
    const supplier = await this.supplierRepo.findOne({ where: { id }, relations: ['categories'] });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async findByIds(ids: string[]): Promise<Supplier[]> {
    return this.supplierRepo.find({ where: { id: In(ids) } });
  }

  async updateStatus(id: string, status: SupplierStatus): Promise<Supplier> {
    const supplier = await this.findOne(id);
    supplier.status = status;
    return this.supplierRepo.save(supplier);
  }

  async listCategories(): Promise<SupplierCategory[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  /** Matches suppliers already in the DB against an AI-extracted requirement (product/location match + rating). */
  async matchForRequirement(criteria: {
    product: string;
    location?: string;
  }): Promise<(Supplier & { matchScore: number })[]> {
    const qb = this.supplierRepo
      .createQueryBuilder('supplier')
      .leftJoinAndSelect('supplier.categories', 'category')
      .where('supplier.status != :inactive', { inactive: SupplierStatus.INACTIVE });

    if (criteria.product) {
      qb.andWhere(
        '(category.name ILIKE :product OR supplier.legalName ILIKE :product)',
        { product: `%${criteria.product}%` },
      );
    }
    if (criteria.location) {
      qb.andWhere('(supplier.city ILIKE :location OR supplier.state ILIKE :location)', {
        location: `%${criteria.location}%`,
      });
    }

    const suppliers = await qb.orderBy('supplier.rating', 'DESC').limit(50).getMany();

    return suppliers.map((s) => {
      const categoryMatch = s.categories?.some((c) =>
        c.name.toLowerCase().includes(criteria.product.toLowerCase()),
      );
      const locationMatch =
        !!criteria.location &&
        (s.city?.toLowerCase().includes(criteria.location.toLowerCase()) ||
          s.state?.toLowerCase().includes(criteria.location.toLowerCase()));
      const matchScore = (s.rating ?? 0) * 0.6 + (categoryMatch ? 3 : 0) + (locationMatch ? 2 : 0);
      return { ...s, matchScore: Number(matchScore.toFixed(2)) };
    });
  }

  /** Checks which of the given emails already exist, to dedupe discovery results against the DB. */
  async existingEmails(emails: string[]): Promise<Set<string>> {
    if (!emails.length) return new Set();
    const rows = await this.supplierRepo.find({ where: { email: In(emails) }, select: ['email'] });
    return new Set(rows.map((r) => r.email.toLowerCase()));
  }

  /** Bulk-creates suppliers found via automated discovery, tagged for manual verification. */
  async bulkCreateDiscovered(
    raw: { legalName: string; email: string; phone?: string; city?: string; state?: string }[],
    categoryNames: string[],
  ): Promise<Supplier[]> {
    if (!raw.length) return [];
    const categories = await this.resolveCategories(categoryNames);
    const existing = await this.existingEmails(raw.map((r) => r.email));
    const toCreate = raw.filter((r) => r.email && !existing.has(r.email.toLowerCase()));

    const suppliers = toCreate.map((r) =>
      this.supplierRepo.create({
        legalName: r.legalName,
        email: r.email,
        phone: r.phone,
        city: r.city,
        state: r.state,
        categories,
        source: SupplierSource.DISCOVERED,
        status: SupplierStatus.PENDING_VERIFICATION,
      }),
    );
    return this.supplierRepo.save(suppliers);
  }
}

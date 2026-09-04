import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { parse } from 'csv-parse/sync';
import { Supplier, SupplierSource, SupplierStatus, SupplierVerificationStatus } from './entities/supplier.entity';
import { SupplierCategory } from './entities/supplier-category.entity';
import { CreateSupplierDto, SearchSupplierDto } from './dto/supplier.dto';
import { scoreCapabilityMatch, ScorableCriteria } from '../common/utils/capability-scoring.util';
import { cosineSimilarity } from '../common/utils/normalization.util';

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
      // Surface the most recently AI/heuristic-ranked suppliers first so search results are
      // immediately visible here, falling back to rating for suppliers never ranked yet.
      .orderBy('supplier.lastMatchedAt', 'DESC', 'NULLS LAST')
      .addOrderBy('supplier.rating', 'DESC');

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

  /** Sanitized public profile - omits email/phone/contact details. */
  async publicProfile(id: string) {
    const s = await this.findOne(id);
    return {
      id: s.id,
      legalName: s.legalName,
      tradeName: s.tradeName,
      city: s.city,
      state: s.state,
      country: s.country,
      website: s.website,
      logoUrl: s.logoUrl,
      description: s.description,
      categories: s.categories,
      rating: s.rating,
      verificationStatus: s.verificationStatus,
    };
  }

  async findByIds(ids: string[]): Promise<Supplier[]> {
    return this.supplierRepo.find({ where: { id: In(ids) } });
  }

  /** Persists the AI/heuristic ranking result onto each matched supplier for later review/audit. */
  async recordMatchResults(
    results: { supplierId: string; score: number; reason: string }[],
    criteria: Record<string, unknown>,
  ): Promise<void> {
    if (!results.length) return;
    const now = new Date();
    await Promise.all(
      results.map((r) =>
        this.supplierRepo.update(
          { id: r.supplierId },
          {
            lastMatchScore: r.score,
            lastMatchReason: r.reason,
            // TypeORM's QueryDeepPartialEntity can't infer a plain Record<string, unknown> for jsonb columns.
            lastMatchCriteria: criteria as unknown as () => string,
            lastMatchedAt: now,
          },
        ),
      ),
    );
  }

  async updateStatus(id: string, status: SupplierStatus): Promise<Supplier> {
    const supplier = await this.findOne(id);
    supplier.status = status;
    return this.supplierRepo.save(supplier);
  }

  /** Discovered suppliers with a website but missing email/phone/GSTIN - candidates for re-enrichment,
   * best matches first so a limited re-enrichment run covers the results users actually see. */
  async findMissingContactForReenrichment(limit: number): Promise<Supplier[]> {
    return this.supplierRepo
      .createQueryBuilder('supplier')
      .where('supplier.website IS NOT NULL')
      .andWhere('(supplier.email IS NULL OR supplier.phone IS NULL OR supplier.taxId IS NULL)')
      .orderBy('supplier.lastMatchScore', 'DESC', 'NULLS LAST')
      .addOrderBy('supplier.rating', 'DESC')
      .take(limit)
      .getMany();
  }

  /** Applies freshly re-enriched fields onto an existing supplier - only fills gaps, never
   * overwrites a field that already has a real value. */
  async applyEnrichmentPatch(
    id: string,
    patch: {
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      gstin?: string | null;
      enrichmentStatus?: string;
    },
  ): Promise<void> {
    const supplier = await this.findOne(id);
    if (!supplier.email && patch.email) supplier.email = patch.email;
    if (!supplier.phone && patch.phone) supplier.phone = patch.phone;
    if (!supplier.address && patch.address) supplier.address = patch.address;
    if (!supplier.city && patch.city) supplier.city = patch.city;
    if (!supplier.state && patch.state) supplier.state = patch.state;
    if (!supplier.country && patch.country) supplier.country = patch.country;
    if (!supplier.taxId && patch.gstin) supplier.taxId = patch.gstin;
    // Recomputed from the merged result, not the fresh-extraction-only patch, so a field the
    // supplier already had (before this re-enrichment) still counts toward availability.
    supplier.contactStatus = supplier.email && supplier.phone ? 'available' : supplier.email || supplier.phone ? 'partial' : 'missing';
    if (patch.enrichmentStatus) supplier.enrichmentStatus = patch.enrichmentStatus;
    await this.supplierRepo.save(supplier);
  }

  async listCategories(): Promise<SupplierCategory[]> {
    return this.categoryRepo.find({ order: { name: 'ASC' } });
  }

  /** Matches suppliers already in the DB against an AI-extracted requirement, scored via the capability table. */
  async matchForRequirement(
    criteria: ScorableCriteria,
  ): Promise<(Supplier & { matchScore: number; capabilityBreakdown: ReturnType<typeof scoreCapabilityMatch> })[]> {
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
      const capabilityBreakdown = scoreCapabilityMatch(criteria, s);
      return { ...s, matchScore: capabilityBreakdown.total, capabilityBreakdown };
    });
  }

  /** Checks which of the given emails already exist, to dedupe discovery results against the DB. */
  async existingEmails(emails: string[]): Promise<Set<string>> {
    if (!emails.length) return new Set();
    const rows = await this.supplierRepo.find({ where: { email: In(emails) }, select: ['email'] });
    return new Set(rows.map((r) => (r.email ?? '').toLowerCase()).filter(Boolean));
  }

  /**
   * Finds existing suppliers that may be duplicates of the given discovery candidates, matched via
   * GSTIN, website domain, phone or email (used for confidence-scored dedupe against the DB).
   */
  async findExistingForDedupe(
    candidates: { email?: string | null; gstin?: string; phone?: string; website?: string }[],
  ): Promise<Supplier[]> {
    if (!candidates.length) return [];
    const emails = candidates.map((c) => c.email?.toLowerCase()).filter((v): v is string => !!v);
    const gstins = candidates.map((c) => c.gstin).filter((v): v is string => !!v);
    const phones = candidates.map((c) => c.phone).filter((v): v is string => !!v);

    if (!emails.length && !gstins.length && !phones.length) return [];

    const qb = this.supplierRepo.createQueryBuilder('supplier');
    qb.where('1 = 0');
    if (emails.length) qb.orWhere('LOWER(supplier.email) IN (:...emails)', { emails });
    if (gstins.length) qb.orWhere('supplier.taxId IN (:...gstins)', { gstins });
    if (phones.length) qb.orWhere('supplier.phone IN (:...phones)', { phones });

    return qb.getMany();
  }

  /**
   * Priority-2 external source: semantic/vector similarity search over previously-discovered-but-
   * unmatched suppliers (status=pending_verification) using cosine similarity over stored embeddings.
   */
  async findUnmatchedForSemanticSearch(
    embedding: number[],
    limit = 20,
  ): Promise<(Supplier & { matchScore: number })[]> {
    const candidates = await this.supplierRepo.find({
      where: { status: SupplierStatus.PENDING_VERIFICATION },
      relations: ['categories'],
      take: 500,
    });

    return candidates
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length)
      .map((c) => ({ ...c, matchScore: Number((cosineSimilarity(embedding, c.embedding!) * 100).toFixed(2)) }))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }

  /** Bulk-creates suppliers found via automated discovery, tagged for manual verification. */
  async bulkCreateDiscovered(
    raw: {
      legalName: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string | null;
      website?: string;
      gstin?: string;
      contactStatus?: 'available' | 'partial' | 'missing';
      verificationStatus?: SupplierVerificationStatus;
      discoveryConfidence?: number;
      sourceTier?: number;
      discoverySourceUrl?: string;
      sourceType?: string;
      enrichmentStatus?: string;
      enrichmentError?: string;
      businessType?: string | null;
      products?: string[];
      productCategories?: string[];
      certifications?: string[];
      manufacturingCapabilities?: string[];
      fieldConfidence?: Record<string, number>;
      extractionMetadata?: Record<string, unknown>;
      embedding?: number[];
    }[],
    categoryNames: string[],
  ): Promise<Supplier[]> {
    if (!raw.length) return [];
    const categories = await this.resolveCategories(categoryNames);
    const emailsToCheck = raw.map((r) => r.email).filter((v): v is string => !!v);
    const existing = await this.existingEmails(emailsToCheck);
    // Records with no email at all are never filtered here (nothing to dedupe against) - only
    // an already-known real email blocks re-creation.
    const toCreate = raw.filter((r) => !r.email || !existing.has(r.email.toLowerCase()));

    const suppliers = toCreate.map((r) =>
      this.supplierRepo.create({
        legalName: r.legalName,
        email: r.email ?? undefined,
        phone: r.phone ?? undefined,
        address: r.address ?? undefined,
        city: r.city ?? undefined,
        state: r.state ?? undefined,
        country: r.country ?? undefined,
        website: r.website,
        taxId: r.gstin,
        contactStatus: r.contactStatus ?? 'missing',
        verificationStatus: r.verificationStatus ?? SupplierVerificationStatus.UNVERIFIED,
        discoveryConfidence: r.discoveryConfidence,
        sourceTier: r.sourceTier,
        discoverySourceUrl: r.discoverySourceUrl,
        sourceType: r.sourceType,
        enrichmentStatus: r.enrichmentStatus,
        enrichmentError: r.enrichmentError,
        businessType: r.businessType ?? undefined,
        products: r.products,
        productCategories: r.productCategories,
        certifications: r.certifications,
        manufacturingCapabilities: r.manufacturingCapabilities,
        fieldConfidence: r.fieldConfidence,
        extractionMetadata: r.extractionMetadata,
        embedding: r.embedding,
        categories,
        source: SupplierSource.DISCOVERED,
        status: SupplierStatus.PENDING_VERIFICATION,
      }),
    );
    return this.supplierRepo.save(suppliers);
  }
}

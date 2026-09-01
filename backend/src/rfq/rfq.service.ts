import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rfq, RfqStatus } from './entities/rfq.entity';
import { RfqItem } from './entities/rfq-item.entity';
import { RfqSupplier, RfqSupplierStatus } from './entities/rfq-supplier.entity';
import { CreateRfqDto, SubmitQuoteDto } from './dto/rfq.dto';
import { SuppliersService } from '../suppliers/suppliers.service';

@Injectable()
export class RfqService {
  constructor(
    @InjectRepository(Rfq) private readonly rfqRepo: Repository<Rfq>,
    @InjectRepository(RfqItem) private readonly itemRepo: Repository<RfqItem>,
    @InjectRepository(RfqSupplier) private readonly rfqSupplierRepo: Repository<RfqSupplier>,
    private readonly suppliersService: SuppliersService,
  ) {}

  private generateRfqNumber(): string {
    const year = new Date().getFullYear();
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `RFQ-${year}-${rand}`;
  }

  async create(dto: CreateRfqDto): Promise<Rfq> {
    const rfq = this.rfqRepo.create({
      rfqNumber: this.generateRfqNumber(),
      title: dto.title,
      description: dto.description,
      category: dto.category,
      dueDate: new Date(dto.dueDate),
      deliveryLocation: dto.deliveryLocation,
      paymentTerms: dto.paymentTerms,
      status: RfqStatus.DRAFT,
      items: dto.items.map((i) => this.itemRepo.create(i)),
    });
    const saved = await this.rfqRepo.save(rfq);

    if (dto.supplierIds?.length) {
      await this.inviteSuppliers(saved.id, dto.supplierIds);
    }
    return this.findOne(saved.id);
  }

  async inviteSuppliers(rfqId: string, supplierIds: string[]): Promise<RfqSupplier[]> {
    const rfq = await this.findOne(rfqId);
    const suppliers = await this.suppliersService.findByIds(supplierIds);
    const invites = suppliers.map((supplier) =>
      this.rfqSupplierRepo.create({ rfq, supplier, status: RfqSupplierStatus.INVITED }),
    );
    const saved = await this.rfqSupplierRepo.save(invites);
    if (rfq.status === RfqStatus.DRAFT) {
      rfq.status = RfqStatus.SENT;
      await this.rfqRepo.save(rfq);
    }
    return saved;
  }

  async findOne(id: string): Promise<Rfq> {
    const rfq = await this.rfqRepo.findOne({
      where: { id },
      relations: ['items', 'supplierInvites', 'supplierInvites.supplier'],
    });
    if (!rfq) throw new NotFoundException('RFQ not found');
    return rfq;
  }

  async findAll(): Promise<Rfq[]> {
    return this.rfqRepo.find({
      relations: ['items', 'supplierInvites'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Supplier-facing endpoint: record a quote against an invite. */
  async submitQuote(rfqSupplierId: string, dto: SubmitQuoteDto): Promise<RfqSupplier> {
    const invite = await this.rfqSupplierRepo.findOne({
      where: { id: rfqSupplierId },
      relations: ['rfq'],
    });
    if (!invite) throw new NotFoundException('RFQ invite not found');
    invite.quotedPrice = dto.quotedPrice;
    invite.leadTimeDays = dto.leadTimeDays;
    invite.notes = dto.notes;
    invite.status = RfqSupplierStatus.RESPONDED;
    invite.respondedAt = new Date();
    const saved = await this.rfqSupplierRepo.save(invite);

    const rfq = await this.rfqRepo.findOne({ where: { id: invite.rfq.id } });
    if (rfq && rfq.status === RfqStatus.SENT) {
      rfq.status = RfqStatus.RESPONSES_RECEIVED;
      await this.rfqRepo.save(rfq);
    }
    return saved;
  }

  async close(id: string): Promise<Rfq> {
    const rfq = await this.findOne(id);
    rfq.status = RfqStatus.CLOSED;
    return this.rfqRepo.save(rfq);
  }
}

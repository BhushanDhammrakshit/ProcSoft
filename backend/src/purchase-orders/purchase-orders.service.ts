import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseOrder, PoStatus } from './entities/purchase-order.entity';
import { PoItem } from './entities/po-item.entity';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';
import { SuppliersService } from '../suppliers/suppliers.service';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectRepository(PurchaseOrder) private readonly poRepo: Repository<PurchaseOrder>,
    @InjectRepository(PoItem) private readonly itemRepo: Repository<PoItem>,
    private readonly suppliersService: SuppliersService,
  ) {}

  private generatePoNumber(): string {
    const year = new Date().getFullYear();
    const rand = Math.floor(Math.random() * 900000 + 100000);
    return `PO-${year}-${rand}`;
  }

  async create(dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
    const supplier = await this.suppliersService.findOne(dto.supplierId);

    const items = dto.items.map((i) =>
      this.itemRepo.create({ ...i, uom: i.uom ?? 'unit', total: i.quantity * i.unitPrice }),
    );
    const totalAmount = items.reduce((sum, i) => sum + i.total, 0);

    const po = this.poRepo.create({
      poNumber: this.generatePoNumber(),
      supplier,
      rfq: dto.rfqId ? ({ id: dto.rfqId } as any) : undefined,
      deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
      deliveryAddress: dto.deliveryAddress,
      paymentTerms: dto.paymentTerms,
      incoterms: dto.incoterms,
      termsAndConditions: dto.termsAndConditions,
      currency: dto.currency ?? 'INR',
      totalAmount,
      status: PoStatus.DRAFT,
      items,
    });
    return this.poRepo.save(po);
  }

  async findAll(): Promise<PurchaseOrder[]> {
    return this.poRepo.find({ relations: ['items', 'supplier'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<PurchaseOrder> {
    const po = await this.poRepo.findOne({ where: { id }, relations: ['items', 'supplier', 'rfq'] });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  async updateStatus(id: string, status: PoStatus): Promise<PurchaseOrder> {
    const po = await this.findOne(id);
    po.status = status;
    return this.poRepo.save(po);
  }
}

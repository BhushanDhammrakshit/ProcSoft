import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';
import { Rfq } from '../../rfq/entities/rfq.entity';
import { PoItem } from './po-item.entity';

export enum PoStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  ACKNOWLEDGED = 'acknowledged',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('purchase_orders')
export class PurchaseOrder extends BaseEntity {
  @Column({ name: 'po_number', unique: true })
  poNumber: string;

  @ManyToOne(() => Supplier, { eager: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @ManyToOne(() => Rfq, { nullable: true })
  @JoinColumn({ name: 'rfq_id' })
  rfq?: Rfq;

  @Column({ name: 'delivery_date', type: 'timestamptz', nullable: true })
  deliveryDate?: Date;

  @Column({ name: 'delivery_address', nullable: true })
  deliveryAddress?: string;

  @Column({ name: 'payment_terms', nullable: true })
  paymentTerms?: string;

  @Column({ nullable: true })
  incoterms?: string; // e.g. FOB, CIF

  @Column({ type: 'text', nullable: true })
  termsAndConditions?: string;

  @Column({ type: 'float', default: 0 })
  totalAmount: number;

  @Column({ default: 'INR' })
  currency: string;

  @Column({ type: 'enum', enum: PoStatus, default: PoStatus.DRAFT })
  status: PoStatus;

  @OneToMany(() => PoItem, (item) => item.purchaseOrder, { cascade: true })
  items: PoItem[];
}

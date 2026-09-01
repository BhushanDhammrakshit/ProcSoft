import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Rfq } from './rfq.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';

export enum RfqSupplierStatus {
  INVITED = 'invited',
  VIEWED = 'viewed',
  RESPONDED = 'responded',
  DECLINED = 'declined',
}

@Entity('rfq_suppliers')
export class RfqSupplier extends BaseEntity {
  @ManyToOne(() => Rfq, (rfq) => rfq.supplierInvites, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id' })
  rfq: Rfq;

  @ManyToOne(() => Supplier, { eager: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ type: 'enum', enum: RfqSupplierStatus, default: RfqSupplierStatus.INVITED })
  status: RfqSupplierStatus;

  @Column({ name: 'quoted_price', type: 'float', nullable: true })
  quotedPrice?: number;

  @Column({ name: 'lead_time_days', type: 'int', nullable: true })
  leadTimeDays?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt?: Date;
}

import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { RfqItem } from './rfq-item.entity';
import { RfqSupplier } from './rfq-supplier.entity';

export enum RfqStatus {
  DRAFT = 'draft',
  SENT = 'sent',
  RESPONSES_RECEIVED = 'responses_received',
  CLOSED = 'closed',
  AWARDED = 'awarded',
}

@Entity('rfqs')
export class Rfq extends BaseEntity {
  @Column({ name: 'rfq_number', unique: true })
  rfqNumber: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true })
  category?: string;

  @Column({ name: 'due_date', type: 'timestamptz' })
  dueDate: Date;

  @Column({ name: 'delivery_location', nullable: true })
  deliveryLocation?: string;

  @Column({ name: 'payment_terms', nullable: true })
  paymentTerms?: string;

  @Column({ type: 'enum', enum: RfqStatus, default: RfqStatus.DRAFT })
  status: RfqStatus;

  @OneToMany(() => RfqItem, (item) => item.rfq, { cascade: true })
  items: RfqItem[];

  @OneToMany(() => RfqSupplier, (rs) => rs.rfq, { cascade: true })
  supplierInvites: RfqSupplier[];
}

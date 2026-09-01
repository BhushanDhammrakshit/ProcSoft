import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Rfq } from './rfq.entity';

@Entity('rfq_items')
export class RfqItem extends BaseEntity {
  @ManyToOne(() => Rfq, (rfq) => rfq.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rfq_id' })
  rfq: Rfq;

  @Column({ name: 'item_name' })
  itemName: string;

  @Column({ type: 'text', nullable: true })
  specifications?: string;

  @Column({ type: 'float' })
  quantity: number;

  @Column({ default: 'unit' })
  uom: string; // unit of measure
}

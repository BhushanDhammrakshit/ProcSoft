import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PurchaseOrder } from './purchase-order.entity';

@Entity('po_items')
export class PoItem extends BaseEntity {
  @ManyToOne(() => PurchaseOrder, (po) => po.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'po_id' })
  purchaseOrder: PurchaseOrder;

  @Column({ name: 'item_name' })
  itemName: string;

  @Column({ type: 'float' })
  quantity: number;

  @Column({ default: 'unit' })
  uom: string;

  @Column({ name: 'unit_price', type: 'float' })
  unitPrice: number;

  @Column({ type: 'float' })
  total: number;
}

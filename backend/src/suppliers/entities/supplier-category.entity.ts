import { Entity, Column, ManyToMany, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Supplier } from './supplier.entity';

@Entity('supplier_categories')
export class SupplierCategory extends BaseEntity {
  @Column({ unique: true })
  @Index()
  name: string; // e.g. "Electronics Components", "Packaging", "Logistics"

  @Column({ nullable: true })
  code?: string; // commodity/UNSPSC-style code

  @ManyToMany(() => Supplier, (supplier) => supplier.categories)
  suppliers: Supplier[];
}

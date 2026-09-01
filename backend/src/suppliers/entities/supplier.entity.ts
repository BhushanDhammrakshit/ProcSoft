import { Entity, Column, ManyToMany, JoinTable, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { SupplierCategory } from './supplier-category.entity';

export enum SupplierStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
}

export enum SupplierSource {
  MANUAL = 'manual',
  CSV_IMPORT = 'csv_import',
  SELF_REGISTERED = 'self_registered',
  DISCOVERED = 'discovered', // found via automated external discovery, pending verification
}

@Entity('suppliers')
export class Supplier extends BaseEntity {
  @Column({ name: 'legal_name' })
  @Index()
  legalName: string;

  @Column({ name: 'trade_name', nullable: true })
  tradeName?: string;

  @Column({ unique: true })
  @Index()
  email: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ name: 'contact_person', nullable: true })
  contactPerson?: string;

  // Statutory identifiers common in procurement systems
  @Column({ name: 'tax_id', nullable: true })
  taxId?: string; // e.g. GSTIN / VAT ID

  @Column({ name: 'registration_number', nullable: true })
  registrationNumber?: string;

  @Column({ nullable: true })
  @Index()
  city?: string;

  @Column({ nullable: true })
  @Index()
  state?: string;

  @Column({ default: 'India' })
  country: string;

  @Column({ type: 'jsonb', nullable: true })
  certifications?: string[]; // e.g. ["ISO 9001", "MSME"]

  @Column({ name: 'payment_terms', nullable: true })
  paymentTerms?: string; // e.g. "Net 30"

  @Column({ type: 'float', default: 0 })
  rating: number; // aggregated performance score

  @Column({ type: 'enum', enum: SupplierStatus, default: SupplierStatus.PENDING_VERIFICATION })
  status: SupplierStatus;

  @Column({ type: 'enum', enum: SupplierSource, default: SupplierSource.MANUAL })
  source: SupplierSource;

  @ManyToMany(() => SupplierCategory, (category) => category.suppliers, { cascade: true })
  @JoinTable({
    name: 'supplier_category_map',
    joinColumn: { name: 'supplier_id' },
    inverseJoinColumn: { name: 'category_id' },
  })
  categories: SupplierCategory[];

  // Full-text search vector populated via DB trigger/migration (see search.sql)
  @Column({ name: 'search_vector', type: 'tsvector', select: false, nullable: true })
  searchVector?: string;
}

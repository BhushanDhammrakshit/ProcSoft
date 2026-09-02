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

export enum SupplierVerificationStatus {
  VERIFIED = 'verified',
  // Good enriched profile (name+website+contact/location) but official business verification
  // (GSTIN/registration) isn't complete yet - distinct from a reachable-website-only profile.
  VERIFICATION_PENDING = 'verification_pending',
  PARTIALLY_VERIFIED = 'partially_verified',
  UNVERIFIED = 'unverified',
}

export type SupplierContactStatus = 'available' | 'partial' | 'missing';

@Entity('suppliers')
export class Supplier extends BaseEntity {
  @Column({ name: 'legal_name' })
  @Index()
  legalName: string;

  @Column({ name: 'trade_name', nullable: true })
  tradeName?: string;

  // Nullable for discovered suppliers with no verifiable email (never a fake placeholder) - a unique
  // index still permits multiple NULLs in Postgres. Manual/CSV creation still requires a real email
  // via CreateSupplierDto.
  @Column({ unique: true, nullable: true })
  @Index()
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  // "available" (email+phone) / "partial" (one of them) / "missing" (neither) - never faked.
  @Column({ name: 'contact_status', default: 'missing' })
  contactStatus: SupplierContactStatus;

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

  @Column({ nullable: true })
  website?: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl?: string;

  // Public-facing "about us" text shown on the seller's public profile page.
  @Column({ type: 'text', nullable: true })
  description?: string;

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

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: SupplierVerificationStatus,
    default: SupplierVerificationStatus.UNVERIFIED,
  })
  verificationStatus: SupplierVerificationStatus;

  // Confidence (0-100) from dedupe/matching when sourced via automated discovery.
  @Column({ name: 'discovery_confidence', type: 'float', nullable: true })
  discoveryConfidence?: number;

  // Which external-sourcing priority tier found this supplier (1=licensed API, 2=internal
  // semantic re-match, 3=government/open data, 4=official supplier websites).
  @Column({ name: 'source_tier', type: 'int', nullable: true })
  sourceTier?: number;

  // Original discovered-lead URL, its classification (official_website/marketplace/...), and how
  // the enrichment pipeline fared on it - persisted for audit/debugging (SupplierEnrichmentService).
  @Column({ name: 'discovery_source_url', type: 'text', nullable: true })
  discoverySourceUrl?: string;

  @Column({ name: 'source_type', nullable: true })
  sourceType?: string; // UrlClassification value

  @Column({ name: 'enrichment_status', nullable: true })
  enrichmentStatus?: string; // 'enriched' | 'skipped' | 'failed'

  @Column({ name: 'enrichment_error', type: 'text', nullable: true })
  enrichmentError?: string;

  // AI/deterministic-extraction supplier-profile fields (Manufacturer/Distributor/Trader/etc, products...).
  @Column({ name: 'business_type', nullable: true })
  businessType?: string;

  @Column({ type: 'jsonb', nullable: true })
  products?: string[];

  @Column({ name: 'product_categories', type: 'jsonb', nullable: true })
  productCategories?: string[];

  @Column({ name: 'manufacturing_capabilities', type: 'jsonb', nullable: true })
  manufacturingCapabilities?: string[];

  // Per-field extraction confidence (0-100) and source ('json_ld'/'mailto'/'ai'/...), from SupplierEnrichmentService.
  @Column({ name: 'field_confidence', type: 'jsonb', nullable: true })
  fieldConfidence?: Record<string, number>;

  @Column({ name: 'extraction_metadata', type: 'jsonb', nullable: true })
  extractionMetadata?: Record<string, unknown>;

  // Text embedding for semantic re-matching of previously-discovered-but-unmatched suppliers.
  @Column({ type: 'jsonb', nullable: true })
  embedding?: number[];

  // Persisted result of the most recent AI/heuristic supplier-search ranking this record appeared in.
  @Column({ name: 'last_match_score', type: 'float', nullable: true })
  lastMatchScore?: number;

  @Column({ name: 'last_match_reason', type: 'text', nullable: true })
  lastMatchReason?: string;

  @Column({ name: 'last_match_criteria', type: 'jsonb', nullable: true })
  lastMatchCriteria?: Record<string, unknown>;

  @Column({ name: 'last_matched_at', type: 'timestamptz', nullable: true })
  lastMatchedAt?: Date;

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

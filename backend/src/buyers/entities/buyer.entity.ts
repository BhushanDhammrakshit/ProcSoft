import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export enum BuyerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING_VERIFICATION = 'pending_verification',
}

export enum BuyerVerificationStatus {
  VERIFIED = 'verified',
  PARTIALLY_VERIFIED = 'partially_verified',
  UNVERIFIED = 'unverified',
}

@Entity('buyers')
export class Buyer extends BaseEntity {
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

  @Column({ name: 'tax_id', nullable: true })
  taxId?: string; // GSTIN / VAT ID

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

  // Public-facing "about us" text shown on the buyer's public profile page.
  @Column({ type: 'text', nullable: true })
  description?: string;

  // What this buyer typically procures - used to route/filter RFQ visibility per category.
  @Column({ name: 'procurement_categories', type: 'jsonb', nullable: true })
  procurementCategories?: string[];

  @Column({ type: 'enum', enum: BuyerStatus, default: BuyerStatus.PENDING_VERIFICATION })
  status: BuyerStatus;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: BuyerVerificationStatus,
    default: BuyerVerificationStatus.UNVERIFIED,
  })
  verificationStatus: BuyerVerificationStatus;
}

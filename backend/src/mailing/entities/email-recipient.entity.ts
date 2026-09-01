import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { EmailCampaign } from './email-campaign.entity';
import { Supplier } from '../../suppliers/entities/supplier.entity';

export enum RecipientStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

@Entity('email_recipients')
export class EmailRecipient extends BaseEntity {
  @ManyToOne(() => EmailCampaign, (c) => c.recipients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: EmailCampaign;

  @ManyToOne(() => Supplier, { eager: true })
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ type: 'enum', enum: RecipientStatus, default: RecipientStatus.PENDING })
  status: RecipientStatus;

  @Column({ type: 'text', nullable: true })
  renderedBody?: string;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Column({ name: 'error_message', nullable: true })
  errorMessage?: string;
}

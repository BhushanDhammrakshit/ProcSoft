import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { EmailRecipient } from './email-recipient.entity';

export enum CampaignStatus {
  DRAFT = 'draft',
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
}

@Entity('email_campaigns')
export class EmailCampaign extends BaseEntity {
  @Column()
  subject: string;

  @Column({ type: 'text' })
  bodyTemplate: string; // supports {{legalName}}, {{contactPerson}} placeholders

  @Column({ name: 'rfq_id', nullable: true })
  rfqId?: string;

  @Column({ name: 'use_ai_personalization', default: false })
  useAiPersonalization: boolean;

  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @OneToMany(() => EmailRecipient, (r) => r.campaign, { cascade: true })
  recipients: EmailRecipient[];
}

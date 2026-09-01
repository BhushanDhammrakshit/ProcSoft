import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { EmailCampaign, CampaignStatus } from './entities/email-campaign.entity';
import { EmailRecipient, RecipientStatus } from './entities/email-recipient.entity';
import { CreateCampaignDto } from './dto/campaign.dto';
import { SuppliersService } from '../suppliers/suppliers.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class MailingService {
  private readonly logger = new Logger(MailingService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(EmailCampaign) private readonly campaignRepo: Repository<EmailCampaign>,
    @InjectRepository(EmailRecipient) private readonly recipientRepo: Repository<EmailRecipient>,
    private readonly suppliersService: SuppliersService,
    private readonly aiService: AiService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
  }

  private renderTemplate(template: string, supplier: { legalName: string; contactPerson?: string }): string {
    return template
      .replaceAll('{{legalName}}', supplier.legalName)
      .replaceAll('{{contactPerson}}', supplier.contactPerson ?? supplier.legalName);
  }

  async createCampaign(dto: CreateCampaignDto): Promise<EmailCampaign> {
    const suppliers = await this.suppliersService.findByIds(dto.supplierIds);
    const campaign = this.campaignRepo.create({
      subject: dto.subject,
      bodyTemplate: dto.bodyTemplate,
      rfqId: dto.rfqId,
      useAiPersonalization: dto.useAiPersonalization ?? false,
      status: CampaignStatus.DRAFT,
      recipients: suppliers.map((s) =>
        this.recipientRepo.create({ supplier: s, status: RecipientStatus.PENDING }),
      ),
    });
    return this.campaignRepo.save(campaign);
  }

  async findAll(): Promise<EmailCampaign[]> {
    return this.campaignRepo.find({ relations: ['recipients'], order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<EmailCampaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id }, relations: ['recipients'] });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /** Sends the campaign to every recipient, optionally personalizing each email via AI. */
  async sendCampaign(id: string): Promise<EmailCampaign> {
    const campaign = await this.findOne(id);
    campaign.status = CampaignStatus.SENDING;
    await this.campaignRepo.save(campaign);

    for (const recipient of campaign.recipients) {
      try {
        let body = this.renderTemplate(campaign.bodyTemplate, recipient.supplier);
        if (campaign.useAiPersonalization) {
          body = await this.aiService.draftSupplierEmail({
            supplierName: recipient.supplier.legalName,
            purpose: campaign.subject,
            keyPoints: campaign.bodyTemplate,
          });
        }

        await this.transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: recipient.supplier.email,
          subject: campaign.subject,
          text: body,
        });

        recipient.status = RecipientStatus.SENT;
        recipient.renderedBody = body;
        recipient.sentAt = new Date();
      } catch (err) {
        recipient.status = RecipientStatus.FAILED;
        recipient.errorMessage = (err as Error).message;
        this.logger.error(`Failed to email supplier ${recipient.supplier.email}`, err as Error);
      }
      await this.recipientRepo.save(recipient);
    }

    campaign.status = campaign.recipients.some((r) => r.status === RecipientStatus.FAILED)
      ? CampaignStatus.FAILED
      : CampaignStatus.SENT;
    return this.campaignRepo.save(campaign);
  }
}

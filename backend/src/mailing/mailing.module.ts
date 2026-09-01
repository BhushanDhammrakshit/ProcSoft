import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailCampaign } from './entities/email-campaign.entity';
import { EmailRecipient } from './entities/email-recipient.entity';
import { MailingService } from './mailing.service';
import { MailingController } from './mailing.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([EmailCampaign, EmailRecipient]), SuppliersModule, AiModule],
  controllers: [MailingController],
  providers: [MailingService],
  exports: [MailingService],
})
export class MailingModule {}

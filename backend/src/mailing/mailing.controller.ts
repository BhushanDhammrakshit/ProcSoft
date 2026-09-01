import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MailingService } from './mailing.service';
import { CreateCampaignDto } from './dto/campaign.dto';

@Controller('mailing/campaigns')
export class MailingController {
  constructor(private readonly mailingService: MailingService) {}

  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.mailingService.createCampaign(dto);
  }

  @Get()
  findAll() {
    return this.mailingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mailingService.findOne(id);
  }

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.mailingService.sendCampaign(id);
  }
}

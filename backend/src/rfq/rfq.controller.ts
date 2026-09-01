import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RfqService } from './rfq.service';
import { CreateRfqDto, SubmitQuoteDto } from './dto/rfq.dto';
import { AiService } from '../ai/ai.service';

@Controller('rfqs')
export class RfqController {
  constructor(
    private readonly rfqService: RfqService,
    private readonly aiService: AiService,
  ) {}

  @Post()
  create(@Body() dto: CreateRfqDto) {
    return this.rfqService.create(dto);
  }

  @Get()
  findAll() {
    return this.rfqService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rfqService.findOne(id);
  }

  @Post(':id/invite')
  invite(@Param('id') id: string, @Body('supplierIds') supplierIds: string[]) {
    return this.rfqService.inviteSuppliers(id, supplierIds);
  }

  @Patch(':id/close')
  close(@Param('id') id: string) {
    return this.rfqService.close(id);
  }

  @Patch('invites/:inviteId/quote')
  submitQuote(@Param('inviteId') inviteId: string, @Body() dto: SubmitQuoteDto) {
    return this.rfqService.submitQuote(inviteId, dto);
  }

  /** AI: suggest suppliers best matching an RFQ's category/history before inviting. */
  @Get(':id/suggest-suppliers')
  async suggestSuppliers(@Param('id') id: string) {
    const rfq = await this.rfqService.findOne(id);
    return this.aiService.suggestSuppliersForRfq(rfq);
  }

  /** AI: expand a short buyer prompt into a structured RFQ title/description/items draft. */
  @Post('ai/draft')
  draftFromPrompt(@Body('prompt') prompt: string) {
    return this.aiService.generateRfqDraft(prompt);
  }
}

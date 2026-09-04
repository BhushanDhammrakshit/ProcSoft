import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SupplierSearchService } from './supplier-search.service';
import { SearchRequirementDto } from './dto/search-requirement.dto';

@Controller('suppliers/search')
export class SupplierSearchController {
  constructor(private readonly supplierSearchService: SupplierSearchService) {}

  @Post('ai')
  search(@Body() dto: SearchRequirementDto) {
    const coords =
      dto.latitude !== undefined && dto.longitude !== undefined
        ? { latitude: dto.latitude, longitude: dto.longitude }
        : undefined;
    return this.supplierSearchService.search(dto.prompt, dto.targetCount, dto.minScore, coords, dto.locationOverride);
  }

  /** Re-runs website extraction for already-discovered suppliers missing email/phone/GSTIN
   * despite having a website - see SupplierSearchService.reenrichMissingContacts. */
  @Post('reenrich')
  reenrich(@Query('limit') limit?: string) {
    return this.supplierSearchService.reenrichMissingContacts(limit ? Number(limit) : undefined);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.supplierSearchService.getJob(id);
  }
}

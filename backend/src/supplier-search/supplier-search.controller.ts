import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SupplierSearchService } from './supplier-search.service';
import { SearchRequirementDto } from './dto/search-requirement.dto';

@Controller('suppliers/search')
export class SupplierSearchController {
  constructor(private readonly supplierSearchService: SupplierSearchService) {}

  @Post('ai')
  search(@Body() dto: SearchRequirementDto) {
    return this.supplierSearchService.search(dto.prompt);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.supplierSearchService.getJob(id);
  }
}

import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BuyersService } from './buyers.service';
import { CreateBuyerDto, SearchBuyerDto } from './dto/buyer.dto';
import { BuyerStatus } from './entities/buyer.entity';

@Controller('buyers')
export class BuyersController {
  constructor(private readonly buyersService: BuyersService) {}

  @Post()
  create(@Body() dto: CreateBuyerDto) {
    return this.buyersService.create(dto);
  }

  @Get()
  search(@Query() dto: SearchBuyerDto) {
    return this.buyersService.search(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.buyersService.findOne(id);
  }

  @Get(':id/public')
  publicProfile(@Param('id') id: string) {
    return this.buyersService.publicProfile(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: BuyerStatus) {
    return this.buyersService.updateStatus(id, status);
  }
}

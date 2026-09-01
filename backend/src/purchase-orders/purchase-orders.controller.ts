import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';
import { PoStatus } from './entities/purchase-order.entity';

@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) {}

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto) {
    return this.poService.create(dto);
  }

  @Get()
  findAll() {
    return this.poService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.poService.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: PoStatus) {
    return this.poService.updateStatus(id, status);
  }
}

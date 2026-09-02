import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto, SearchSupplierDto } from './dto/supplier.dto';
import { SupplierStatus } from './entities/supplier.entity';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importCsv(@UploadedFile() file: Express.Multer.File) {
    return this.suppliersService.importCsv(file.buffer);
  }

  @Get()
  search(@Query() dto: SearchSupplierDto) {
    return this.suppliersService.search(dto);
  }

  @Get('categories')
  listCategories() {
    return this.suppliersService.listCategories();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Get(':id/public')
  publicProfile(@Param('id') id: string) {
    return this.suppliersService.publicProfile(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: SupplierStatus) {
    return this.suppliersService.updateStatus(id, status);
  }
}

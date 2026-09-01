import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Rfq } from './entities/rfq.entity';
import { RfqItem } from './entities/rfq-item.entity';
import { RfqSupplier } from './entities/rfq-supplier.entity';
import { RfqService } from './rfq.service';
import { RfqController } from './rfq.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Rfq, RfqItem, RfqSupplier]),
    SuppliersModule,
    AiModule,
  ],
  controllers: [RfqController],
  providers: [RfqService],
  exports: [RfqService],
})
export class RfqModule {}

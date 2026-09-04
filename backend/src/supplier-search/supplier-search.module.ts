import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryJob } from './entities/discovery-job.entity';
import { SupplierSearchService } from './supplier-search.service';
import { SupplierSearchController } from './supplier-search.controller';
import { ExternalSourceService } from './external-source.service';
import { SupplierEnrichmentService } from './supplier-enrichment.service';
import { GstVerificationService } from './gst-verification.service';
import { DataGovInUdyamAdapter } from './adapters/data-gov-in-udyam.adapter';
import { GoogleMapsAdapter } from './adapters/google-maps.adapter';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([DiscoveryJob]), SuppliersModule, AiModule],
  controllers: [SupplierSearchController],
  providers: [
    SupplierSearchService,
    ExternalSourceService,
    SupplierEnrichmentService,
    GstVerificationService,
    DataGovInUdyamAdapter,
    GoogleMapsAdapter,
  ],
})
export class SupplierSearchModule {}

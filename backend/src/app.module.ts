import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuppliersModule } from './suppliers/suppliers.module';
import { RfqModule } from './rfq/rfq.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { MailingModule } from './mailing/mailing.module';
import { AiModule } from './ai/ai.module';
import { SupplierSearchModule } from './supplier-search/supplier-search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(
      process.env.DATABASE_URL
        ? {
            type: 'postgres',
            url: process.env.DATABASE_URL,
            // Neon (and most hosted Postgres) requires TLS but uses a self-signed chain.
            ssl: { rejectUnauthorized: false },
            autoLoadEntities: true,
            // Dev-only convenience; use migrations before production.
            synchronize: true,
          }
        : {
            type: 'postgres',
            host: process.env.DB_HOST ?? 'localhost',
            port: Number(process.env.DB_PORT ?? 5432),
            username: process.env.DB_USER ?? 'procsoft',
            password: process.env.DB_PASSWORD ?? 'procsoft',
            database: process.env.DB_NAME ?? 'procsoft',
            autoLoadEntities: true,
            synchronize: true,
          },
    ),
    SuppliersModule,
    RfqModule,
    PurchaseOrdersModule,
    MailingModule,
    AiModule,
    SupplierSearchModule,
  ],
})
export class AppModule {}

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class RfqItemDto {
  @IsString()
  itemName: string;

  @IsOptional()
  @IsString()
  specifications?: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  uom?: string;
}

export class CreateRfqDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  deliveryLocation?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RfqItemDto)
  items: RfqItemDto[];

  @IsOptional()
  @IsArray()
  supplierIds?: string[]; // suppliers to invite immediately
}

export class SubmitQuoteDto {
  @IsNumber()
  quotedPrice: number;

  @IsNumber()
  leadTimeDays: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

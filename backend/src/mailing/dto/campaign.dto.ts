import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  subject: string;

  @IsString()
  bodyTemplate: string;

  @IsOptional()
  @IsString()
  rfqId?: string;

  @IsOptional()
  @IsBoolean()
  useAiPersonalization?: boolean;

  @IsArray()
  supplierIds: string[];
}

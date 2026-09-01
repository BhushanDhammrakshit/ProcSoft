import { IsString } from 'class-validator';

export class SearchRequirementDto {
  @IsString()
  prompt: string;
}

export interface RawSupplierResult {
  legalName: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  website?: string;
}

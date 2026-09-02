import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchRequirementDto {
  @IsString()
  prompt: string;

  /** How many good/qualified suppliers to aim for before skipping automated discovery. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetCount?: number;

  /** Minimum capability-match score (0-100) for a supplier to count as a "good" match. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;
}

export interface RawSupplierResult {
  legalName: string;
  // Web-search leads (tier 4) rarely carry a real email/phone - left undefined rather than faked.
  // These are enriched via SupplierEnrichmentService before being treated as real supplier data.
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  website?: string;
  gstin?: string;
  // Priority tier that produced this raw result (1=licensed API, 2=internal semantic, 3=open data, 4=official sites).
  sourceTier?: number;
}

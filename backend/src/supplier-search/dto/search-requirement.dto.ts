import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
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

  /** Requester's own browser geolocation - only used as a soft Google Places bias when the
   * prompt itself doesn't mention a location (explicit prompt location always takes priority). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  /** Manual location typed by the user in the "location required" popup, used when browser
   * geolocation is unavailable/denied and the prompt itself has no location mention. */
  @IsOptional()
  @IsString()
  locationOverride?: string;
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
  // Priority tier that produced this raw result (1=Google Places, 2=licensed API, 3=internal semantic, 4=open data, 5=general web search).
  sourceTier?: number;
}

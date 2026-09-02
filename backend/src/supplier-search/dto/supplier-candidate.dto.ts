import { UrlClassification } from '../util/url-classifier.util';

/** "available" = email+phone, "partial" = one of email/phone, "missing" = neither. Never a fake placeholder. */
export type ContactStatus = 'available' | 'partial' | 'missing';

export type EnrichmentStatus = 'enriched' | 'skipped' | 'failed';

export interface ExtractionMetadata {
  legalNameSource: 'json_ld' | 'meta' | 'title' | 'ai' | null;
  emailSource: 'mailto' | 'json_ld' | 'text' | null;
  phoneSource: 'tel' | 'json_ld' | 'text' | null;
  addressSource: 'json_ld' | 'text' | null;
}

export interface FieldConfidence {
  legalName: number;
  email: number;
  phone: number;
  address: number;
  products: number;
}

/**
 * Output of SupplierEnrichmentService: a supplier CANDIDATE derived from a search-result lead, not
 * yet normalized/deduped/verified/saved. `legalName`/`email`/etc. are null (never a placeholder) when
 * the field genuinely could not be found.
 */
export interface SupplierCandidate {
  legalName: string | null;
  website: string;
  email: string | null;
  phone: string | null;

  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;

  businessType: string | null;

  products: string[];
  productCategories: string[];
  certifications: string[];
  manufacturingCapabilities: string[];

  extractionMetadata: ExtractionMetadata;
  fieldConfidence: FieldConfidence;

  sourceUrl: string;
  urlClassification: UrlClassification;
  contactStatus: ContactStatus;
  enrichmentStatus: EnrichmentStatus;
  enrichmentError?: string;

  // Carried through from the originating lead so downstream dedupe/verification can still use it.
  gstin?: string;
  sourceTier?: number;
}

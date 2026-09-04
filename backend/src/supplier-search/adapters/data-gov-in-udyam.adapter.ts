import { Injectable, Logger } from '@nestjs/common';
import { RawSupplierResult } from '../dto/search-requirement.dto';

const FETCH_TIMEOUT_MS = Number(process.env.DATA_GOV_IN_TIMEOUT_MS ?? 8000);
const RECORD_LIMIT = Number(process.env.DATA_GOV_IN_LIMIT ?? 100);

// data.gov.in's OGD resource API has one stable contract across every dataset on the portal:
// https://api.data.gov.in/resource/<resource_id>?api-key=<key>&format=json&limit=<n>&filters[<field>]=<value>
// Field NAMES inside `records` vary per dataset/revision though, so we try several plausible
// column-name variants below rather than assuming one exact schema (the exact names weren't
// publicly visible without a signed-in API key at implementation time - verify against your own
// key's response and extend these candidate lists if a field comes back empty).
const NAME_FIELDS = ['enterprise_name', 'company_name', 'name_of_enterprise', 'udyam_name', 'name'];
const ACTIVITY_FIELDS = ['major_activity', 'nic_5_digit_description', 'nic_description', 'activity'];
const STATE_FIELDS = ['state', 'official_address_state', 'state_name'];
const DISTRICT_FIELDS = ['district', 'official_address_district', 'city'];
const ENTERPRISE_TYPE_FIELDS = ['enterprise_type', 'organisation_type', 'category'];

function firstNonEmpty(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Real, free Tier-3 open-data source: the "List of MSME Registered Units under UDYAM" dataset
 * (https://www.data.gov.in/resource/list-msme-registered-units-under-udyam), published by the
 * Ministry of MSME on the Open Government Data (OGD) platform. Requires a free data.gov.in
 * account (instant signup, no card) for DATA_GOV_IN_API_KEY, plus the dataset's own resource UUID
 * (copy from the "API" tab on that resource page) as DATA_GOV_IN_UDYAM_RESOURCE_ID. Disabled
 * (returns []) when either is unset, so the generic EXTERNAL_OPEN_DATA_URL passthrough still works
 * as a fallback for other open-data sources.
 */
@Injectable()
export class DataGovInUdyamAdapter {
  private readonly logger = new Logger(DataGovInUdyamAdapter.name);
  private readonly apiKey = process.env.DATA_GOV_IN_API_KEY;
  private readonly resourceId = process.env.DATA_GOV_IN_UDYAM_RESOURCE_ID;

  get enabled(): boolean {
    return !!(this.apiKey && this.resourceId);
  }

  /** Fetches a page of registered MSME units, optionally filtered by state, and keyword-matches locally. */
  async search(query: string, location?: string): Promise<RawSupplierResult[]> {
    if (!this.enabled) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = new URL(`https://api.data.gov.in/resource/${this.resourceId}`);
      url.searchParams.set('api-key', this.apiKey!);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', String(RECORD_LIMIT));
      // The dataset's own filter contract only supports exact-match per-field filters, not
      // free-text search, so location narrows the request and the product/keyword match happens
      // locally below against whichever name/activity field is actually present.
      if (location) url.searchParams.set('filters[state]', location);

      const res = await fetch(url.toString(), { signal: controller.signal });
      if (!res.ok) throw new Error(`data.gov.in Udyam dataset responded with ${res.status}`);
      const data = (await res.json()) as { records?: Record<string, unknown>[] };
      const records = Array.isArray(data.records) ? data.records : [];

      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      return records
        .map((r) => ({
          legalName: firstNonEmpty(r, NAME_FIELDS),
          state: firstNonEmpty(r, STATE_FIELDS),
          city: firstNonEmpty(r, DISTRICT_FIELDS),
          activity: firstNonEmpty(r, ACTIVITY_FIELDS),
          enterpriseType: firstNonEmpty(r, ENTERPRISE_TYPE_FIELDS),
        }))
        .filter((r) => !!r.legalName)
        .filter(
          (r) =>
            !keywords.length ||
            keywords.some((kw) => r.legalName!.toLowerCase().includes(kw) || r.activity?.toLowerCase().includes(kw)),
        )
        .map(
          (r): RawSupplierResult => ({
            legalName: r.legalName!,
            city: r.city,
            state: r.state,
            sourceTier: 3,
          }),
        );
    } catch (err) {
      this.logger.error(`data.gov.in Udyam dataset search failed for "${query}"`, err as Error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

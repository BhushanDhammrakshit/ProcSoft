import { Injectable, Logger } from '@nestjs/common';
import { RawSupplierResult } from './dto/search-requirement.dto';
import { DataGovInUdyamAdapter } from './adapters/data-gov-in-udyam.adapter';
import { GoogleMapsAdapter, GoogleMapsCoords } from './adapters/google-maps.adapter';

const TIER_FETCH_TIMEOUT_MS = Number(process.env.EXTERNAL_SOURCE_TIMEOUT_MS ?? 8000);

/**
 * Pluggable connectors for automated supplier discovery, queried as a priority chain.
 * No paid B2B data providers are used here (per project scope).
 *
 * Tiers (Priority 3 - internal semantic search over previously-discovered-but-unmatched
 * suppliers - is handled separately in SupplierSearchService via SuppliersService, since
 * it needs an embedding rather than an HTTP call):
 *   1. Business listings (PRIMARY) -> Google Places API (GOOGLE_MAPS_API_KEY) - real, structured
 *                                 business listings (name/phone/website/address), geo-biased by
 *                                 the requester's own coordinates when no explicit location is
 *                                 mentioned. Skipped entirely when GOOGLE_MAPS_API_KEY is unset.
 *                                 Requires a location (explicit prompt location or coords) -
 *                                 SupplierSearchService gates discovery on this, see below.
 *   2. Licensed APIs           -> EXTERNAL_LICENSED_API_URL (generic {suppliers:[]} contract;
 *                                 no free/universal option exists, pick a provider yourself)
 *   4. Government/open data    -> DataGovInUdyamAdapter (the real, free "MSME Registered Units
 *                                 under UDYAM" dataset on data.gov.in) if DATA_GOV_IN_API_KEY +
 *                                 DATA_GOV_IN_UDYAM_RESOURCE_ID are set, else EXTERNAL_OPEN_DATA_URL
 *                                 (generic {suppliers:[]} contract; each open-data portal/dataset
 *                                 has its own schema, so a different dataset needs your own adapter)
 *   5. General web search       -> Serper.dev (SERPER_API_KEY, no card required for its free tier),
 *                                 then the Brave Search API (BRAVE_SEARCH_API_KEY), then
 *                                 EXTERNAL_OFFICIAL_SITES_URL/EXTERNAL_SUPPLIER_SEARCH_URL (generic
 *                                 {suppliers:[]} contract) if none are configured - last resort,
 *                                 least authoritative source. Includes `site:`-scoped variants
 *                                 fired at IndiaMART and the MSME/Udyam government portals so their
 *                                 public listing pages surface via the search engine index (neither
 *                                 site is scraped directly - fragile + against ToS).
 *
 * Generic endpoints must accept `?q=<query>` and return `{ suppliers: RawSupplierResult[] }`.
 * A tier is only queried if the previous tiers haven't produced `targetCount` results yet.
 */
@Injectable()
export class ExternalSourceService {
  private readonly logger = new Logger(ExternalSourceService.name);
  private readonly licensedApiUrl = process.env.EXTERNAL_LICENSED_API_URL;
  private readonly openDataUrl = process.env.EXTERNAL_OPEN_DATA_URL;
  private readonly serperApiKey = process.env.SERPER_API_KEY;
  private readonly braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  private readonly officialSitesUrl =
    process.env.EXTERNAL_OFFICIAL_SITES_URL ?? process.env.EXTERNAL_SUPPLIER_SEARCH_URL;

  constructor(
    private readonly dataGovInUdyamAdapter: DataGovInUdyamAdapter,
    private readonly googleMapsAdapter: GoogleMapsAdapter,
  ) {}

  /** Whether Google Places is configured - it's the primary tier-4 source and requires a location. */
  get googleMapsEnabled(): boolean {
    return this.googleMapsAdapter.enabled;
  }

  private async queryEndpoint(endpoint: string, query: string, tierLabel: string): Promise<RawSupplierResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIER_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`${tierLabel} responded with ${res.status}`);
      const data = (await res.json()) as { suppliers?: RawSupplierResult[] };
      return Array.isArray(data.suppliers) ? data.suppliers : [];
    } catch (err) {
      this.logger.error(`${tierLabel} search failed for "${query}"`, err as Error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Site-scoped query variants layered onto the plain tier-4 web search. */
  private readonly siteScopedDomains = [
    { label: 'IndiaMART', filter: 'site:indiamart.com' },
    { label: 'MSME/Udyam', filter: '(site:msme.gov.in OR site:udyamregistration.gov.in)' },
  ];

  /**
   * Runs the plain query plus IndiaMART/MSME `site:`-scoped variants through whichever web
   * search engine is configured, merging and de-duping by website. `location` is appended as a
   * text modifier to every variant so the search engine biases results toward that geography
   * (Serper/Brave don't support a structured geo filter on this endpoint).
   */
  private async queryWebSearch(query: string, location?: string): Promise<RawSupplierResult[]> {
    const engine = this.serperApiKey
      ? (q: string) => this.querySerper(q)
      : this.braveApiKey
        ? (q: string) => this.queryBraveSearch(q)
        : null;
    if (!engine) return [];

    const locatedQuery = location ? `${query} in ${location}` : query;
    const variants = [locatedQuery, ...this.siteScopedDomains.map((d) => `${locatedQuery} ${d.filter}`)];
    const results = (await Promise.all(variants.map((q) => engine(q)))).flat();

    const seen = new Set<string>();
    return results.filter((r) => {
      const key = r.website ?? r.legalName;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Real web search via Serper.dev (https://google.serper.dev/search) - a Google-results-backed
   * SERP API with a 2,500-query free tier and no credit card required. Results are titles/URLs only
   * (no contact email) - treated as supplier LEADS and run through SupplierEnrichmentService before
   * being used as real supplier data, rather than faking contact details here.
   */
  private async querySerper(query: string): Promise<RawSupplierResult[]> {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': this.serperApiKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query }),
      });
      if (!res.ok) throw new Error(`Serper.dev responded with ${res.status}`);
      const data = (await res.json()) as { organic?: { title: string; link: string }[] };
      return (data.organic ?? []).map((r) => ({
        legalName: r.title,
        website: r.link,
      }));
    } catch (err) {
      this.logger.error(`Serper.dev search failed for "${query}"`, err as Error);
      return [];
    }
  }

  /**
   * Real web search via the Brave Search API (https://api.search.brave.com/res/v1/web/search).
   * Results are titles/URLs only (no contact email) - treated as supplier LEADS and run through
   * SupplierEnrichmentService before being used as real supplier data, rather than faking contact
   * details here.
   */
  private async queryBraveSearch(query: string): Promise<RawSupplierResult[]> {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Subscription-Token': this.braveApiKey! },
      });
      if (!res.ok) throw new Error(`Brave Search API responded with ${res.status}`);
      const data = (await res.json()) as { web?: { results?: { title: string; url: string }[] } };
      return (data.web?.results ?? []).map((r) => ({
        legalName: r.title,
        website: r.url,
      }));
    } catch (err) {
      this.logger.error(`Brave Search API failed for "${query}"`, err as Error);
      return [];
    }
  }

  async searchTiered(
    queries: string[],
    targetCount: number,
    location?: string,
    coords?: GoogleMapsCoords,
  ): Promise<{ results: RawSupplierResult[]; tiersUsed: number[] }> {
    const collected: RawSupplierResult[] = [];
    const tiersUsed: number[] = [];

    // Google Places runs FIRST (primary source) - only the other tiers are a fallback chain below it.
    // Tier 3 (internal semantic search) is handled separately in SupplierSearchService, not here.
    const tiers: { tier: number; label: string; endpoint?: string; run?: (q: string) => Promise<RawSupplierResult[]> }[] = [
      ...(this.googleMapsAdapter.enabled
        ? [{ tier: 1, label: 'Business listings (Google Places)', run: (q: string) => this.googleMapsAdapter.search(q, location, coords) }]
        : []),
      { tier: 2, label: 'Licensed API', endpoint: this.licensedApiUrl },
      this.dataGovInUdyamAdapter.enabled
        ? { tier: 4, label: 'Government/open data (data.gov.in Udyam MSME dataset)', run: (q) => this.dataGovInUdyamAdapter.search(q, location) }
        : { tier: 4, label: 'Government/open data', endpoint: this.openDataUrl },
      this.serperApiKey
        ? { tier: 5, label: 'General web search + IndiaMART/MSME (Serper.dev)', run: (q) => this.queryWebSearch(q, location) }
        : this.braveApiKey
          ? { tier: 5, label: 'General web search + IndiaMART/MSME (Brave Search)', run: (q) => this.queryWebSearch(q, location) }
          : { tier: 5, label: 'Official supplier websites', endpoint: this.officialSitesUrl },
    ];

    for (const { tier, label, endpoint, run } of tiers) {
      if (collected.length >= targetCount) break;
      if (!endpoint && !run) {
        this.logger.warn(`Tier ${tier} (${label}) not configured — skipping`);
        continue;
      }
      const queryFn = run ?? ((q: string) => this.queryEndpoint(endpoint!, q, label));
      const tierResults = (await Promise.all(queries.map((q) => queryFn(q)))).flat();
      if (tierResults.length) {
        tiersUsed.push(tier);
        collected.push(...tierResults.map((r) => ({ ...r, sourceTier: tier })));
      }
    }

    return { results: collected, tiersUsed };
  }
}

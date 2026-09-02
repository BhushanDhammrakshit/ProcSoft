import { Injectable, Logger } from '@nestjs/common';
import { RawSupplierResult } from './dto/search-requirement.dto';

const TIER_FETCH_TIMEOUT_MS = Number(process.env.EXTERNAL_SOURCE_TIMEOUT_MS ?? 8000);

/**
 * Pluggable connectors for automated supplier discovery, queried as a priority chain.
 * No paid B2B data providers are used here (per project scope).
 *
 * Tiers (Priority 2 - internal semantic search over previously-discovered-but-unmatched
 * suppliers - is handled separately in SupplierSearchService via SuppliersService, since
 * it needs an embedding rather than an HTTP call):
 *   1. Licensed APIs           -> EXTERNAL_LICENSED_API_URL (generic {suppliers:[]} contract;
 *                                 no free/universal option exists, pick a provider yourself)
 *   3. Government/open data    -> EXTERNAL_OPEN_DATA_URL (generic {suppliers:[]} contract; each
 *                                 open-data portal/dataset has its own schema, so this must point
 *                                 at your own adapter/wrapper around the dataset you choose)
 *   4. Official supplier sites -> natively uses Serper.dev (SERPER_API_KEY, no card required for
 *                                 its free tier) if set, else the Brave Search API
 *                                 (BRAVE_SEARCH_API_KEY). These are the only currently-active,
 *                                 documented, generally-available web search APIs (Google Custom
 *                                 Search JSON API is closed to new customers and Bing Web Search
 *                                 API is retired). Falls back to EXTERNAL_OFFICIAL_SITES_URL/
 *                                 EXTERNAL_SUPPLIER_SEARCH_URL (generic {suppliers:[]} contract)
 *                                 if neither is configured.
 *
 * Within tier 4, in addition to the plain web query, `site:`-scoped variants are fired at
 * IndiaMART and the MSME/Udyam government portals so their public (unauthenticated) listing
 * pages surface via the search engine index. Neither site is scraped directly - no free/public
 * supplier-search API exists for either, and direct HTML scraping would be fragile and against
 * their terms of service, so this reuses the same Serper/Brave search already configured above.
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
   * search engine is configured, merging and de-duping by website.
   */
  private async queryWebSearch(query: string): Promise<RawSupplierResult[]> {
    const engine = this.serperApiKey
      ? (q: string) => this.querySerper(q)
      : this.braveApiKey
        ? (q: string) => this.queryBraveSearch(q)
        : null;
    if (!engine) return [];

    const variants = [query, ...this.siteScopedDomains.map((d) => `${query} ${d.filter}`)];
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
  ): Promise<{ results: RawSupplierResult[]; tiersUsed: number[] }> {
    const collected: RawSupplierResult[] = [];
    const tiersUsed: number[] = [];

    const tiers: { tier: number; label: string; endpoint?: string; run?: (q: string) => Promise<RawSupplierResult[]> }[] = [
      { tier: 1, label: 'Licensed API', endpoint: this.licensedApiUrl },
      { tier: 3, label: 'Government/open data', endpoint: this.openDataUrl },
      this.serperApiKey
        ? { tier: 4, label: 'Official sites + IndiaMART/MSME (Serper.dev)', run: (q) => this.queryWebSearch(q) }
        : this.braveApiKey
          ? { tier: 4, label: 'Official sites + IndiaMART/MSME (Brave Search)', run: (q) => this.queryWebSearch(q) }
          : { tier: 4, label: 'Official supplier websites', endpoint: this.officialSitesUrl },
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

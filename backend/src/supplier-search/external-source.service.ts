import { Injectable, Logger } from '@nestjs/common';
import { RawSupplierResult } from './dto/search-requirement.dto';

/**
 * Pluggable connector for automated supplier discovery.
 *
 * No paid B2B data providers are used here (per project scope). Point
 * EXTERNAL_SUPPLIER_SEARCH_URL at any licensed/open API you have access to
 * (e.g. GeM open data, a self-hosted search-engine wrapper, or an official
 * supplier-directory API) that accepts `?q=<query>` and returns
 * `{ suppliers: RawSupplierResult[] }`. If unset, discovery returns no
 * external results and the flow simply reports "no additional matches found".
 */
@Injectable()
export class ExternalSourceService {
  private readonly logger = new Logger(ExternalSourceService.name);
  private readonly endpoint = process.env.EXTERNAL_SUPPLIER_SEARCH_URL;

  async search(query: string): Promise<RawSupplierResult[]> {
    if (!this.endpoint) {
      this.logger.warn(`EXTERNAL_SUPPLIER_SEARCH_URL not configured — skipping external search for "${query}"`);
      return [];
    }
    try {
      const res = await fetch(`${this.endpoint}?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`External source responded with ${res.status}`);
      const data = (await res.json()) as { suppliers?: RawSupplierResult[] };
      return Array.isArray(data.suppliers) ? data.suppliers : [];
    } catch (err) {
      this.logger.error(`External supplier search failed for "${query}"`, err as Error);
      return [];
    }
  }

  async searchMany(queries: string[]): Promise<RawSupplierResult[]> {
    const results = await Promise.all(queries.map((q) => this.search(q)));
    return results.flat();
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { RawSupplierResult } from './dto/search-requirement.dto';
import {
  ContactStatus,
  EnrichmentStatus,
  ExtractionMetadata,
  SupplierCandidate,
} from './dto/supplier-candidate.dto';
import { classifyUrl, UrlClassification } from './util/url-classifier.util';
import {
  discoverInternalLinks,
  extractAddress,
  extractCompanyName,
  extractEmail,
  extractJsonLd,
  extractPhone,
  stripHtmlToText,
} from './util/html-extraction.util';
import { extractDomain } from '../common/utils/normalization.util';

const FETCH_TIMEOUT_MS = Number(process.env.SUPPLIER_ENRICHMENT_TIMEOUT_MS ?? 8000);
const MAX_RESPONSE_BYTES = Number(process.env.SUPPLIER_ENRICHMENT_MAX_BYTES ?? 2_000_000);
const MAX_PAGES_PER_SUPPLIER = Number(process.env.SUPPLIER_ENRICHMENT_MAX_PAGES ?? 5);
const CONCURRENCY = Number(process.env.SUPPLIER_ENRICHMENT_CONCURRENCY ?? 3);
const USER_AGENT = process.env.SUPPLIER_ENRICHMENT_USER_AGENT ?? 'ProcSoftSupplierBot/1.0 (+supplier enrichment)';

/** Simple async concurrency gate - avoids pulling in a dependency for something this small. */
class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

function contactStatusFor(email: string | null, phone: string | null): ContactStatus {
  if (email && phone) return 'available';
  if (email || phone) return 'partial';
  return 'missing';
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

/**
 * Turns a bare search-result lead (title + URL) into a SupplierCandidate by classifying the URL,
 * fetching a handful of the supplier's own pages, extracting structured data deterministically, and
 * only then asking the AI to fill in semantic fields it can find no other way. Never invents contact
 * details - missing fields stay null and `contactStatus` reflects what was actually found.
 */
@Injectable()
export class SupplierEnrichmentService {
  private readonly logger = new Logger(SupplierEnrichmentService.name);
  // Two independent pools: a subpage fetch nested inside enrichOfficialWebsite must never compete
  // for the same slot its own outer enrichLead call is holding, or every pool slot deadlocks waiting
  // on itself as soon as >= CONCURRENCY suppliers with internal links are enriched at once.
  private readonly supplierLimiter = new ConcurrencyLimiter(CONCURRENCY);
  private readonly pageLimiter = new ConcurrencyLimiter(CONCURRENCY * 2);
  // Caches a completed candidate per root domain so re-discovered leads for the same company (across
  // queries/jobs) don't re-fetch/re-enrich the same website.
  private readonly domainCache = new Map<string, SupplierCandidate>();

  constructor(private readonly aiService: AiService) {}

  /** Enriches a single lead. Never throws - failures are reported via `enrichmentStatus: 'failed'`. */
  async enrichLead(lead: RawSupplierResult): Promise<{ candidate: SupplierCandidate; urlClassification: UrlClassification }> {
    const urlClassification = classifyUrl(lead.website);

    if (urlClassification !== 'official_website' || !lead.website) {
      return { candidate: this.buildLeadOnlyCandidate(lead, urlClassification, 'skipped'), urlClassification };
    }

    const domain = extractDomain(lead.website);
    const cached = domain ? this.domainCache.get(domain) : undefined;
    if (cached) {
      this.logger.debug(`Using cached enrichment for domain ${domain}`);
      return { candidate: cached, urlClassification };
    }

    try {
      const candidate = await this.supplierLimiter.run(() => this.enrichOfficialWebsite(lead, urlClassification));
      if (domain) this.domainCache.set(domain, candidate);
      return { candidate, urlClassification };
    } catch (err) {
      this.logger.warn(`Enrichment failed for ${lead.website}: ${(err as Error).message}`);
      return {
        candidate: this.buildLeadOnlyCandidate(lead, urlClassification, 'failed', (err as Error).message),
        urlClassification,
      };
    }
  }

  private async enrichOfficialWebsite(lead: RawSupplierResult, classification: UrlClassification): Promise<SupplierCandidate> {
    const homepageUrl = normalizeUrl(lead.website!);
    const homepageHtml = await this.safeFetchHtml(homepageUrl);
    if (!homepageHtml) {
      return this.buildLeadOnlyCandidate(lead, classification, 'failed', 'homepage unreachable');
    }

    const links = discoverInternalLinks(homepageHtml, homepageUrl).slice(0, Math.max(0, MAX_PAGES_PER_SUPPLIER - 1));
    const fetchedPages = await Promise.all(
      links.map((link) => this.pageLimiter.run(async () => ({ url: link.url, html: await this.safeFetchHtml(link.url) }))),
    );

    const pages = [{ url: homepageUrl, html: homepageHtml }, ...fetchedPages.filter((p) => !!p.html)] as {
      url: string;
      html: string;
    }[];

    const allJsonLd = pages.flatMap((p) => extractJsonLd(p.html));

    const nameField = this.firstNonNull(pages.map((p) => extractCompanyName(p.html, allJsonLd)));
    const emailField = this.firstNonNull(pages.map((p) => extractEmail(p.html, allJsonLd)));
    const phoneField = this.firstNonNull(pages.map((p) => extractPhone(p.html, allJsonLd)));
    const addressField = this.firstNonNull(pages.map((p) => extractAddress(p.html, allJsonLd)));

    const cleanedText = pages.map((p) => stripHtmlToText(p.html, 2500)).join('\n');
    const aiProfile = await this.aiService.extractSupplierProfile(cleanedText);

    const legalName = nameField.value ?? aiProfile.companyName ?? lead.legalName ?? null;
    const legalNameSource: ExtractionMetadata['legalNameSource'] = nameField.value
      ? (nameField.source as ExtractionMetadata['legalNameSource'])
      : aiProfile.companyName
        ? 'ai'
        : null;

    const email = emailField.value ?? (lead.email ? lead.email.trim().toLowerCase() : null) ?? null;
    const phone = phoneField.value ?? lead.phone ?? null;
    const address = addressField.value?.address ?? null;
    const city = addressField.value?.city ?? aiProfile.city ?? lead.city ?? null;
    const state = addressField.value?.state ?? aiProfile.state ?? lead.state ?? null;
    const country = addressField.value?.country ?? aiProfile.country ?? null;

    this.logger.log(`Enriched ${homepageUrl}: name=${!!legalName} email=${!!email} phone=${!!phone}`);

    return {
      legalName,
      website: homepageUrl,
      email,
      phone,
      address,
      city,
      state,
      country,
      businessType: aiProfile.businessType,
      products: aiProfile.products,
      productCategories: aiProfile.productCategories,
      certifications: aiProfile.certifications,
      manufacturingCapabilities: aiProfile.manufacturingCapabilities,
      extractionMetadata: {
        legalNameSource,
        emailSource: (emailField.source as ExtractionMetadata['emailSource']) ?? null,
        phoneSource: (phoneField.source as ExtractionMetadata['phoneSource']) ?? null,
        addressSource: (addressField.source as ExtractionMetadata['addressSource']) ?? null,
      },
      fieldConfidence: {
        legalName: nameField.confidence,
        email: emailField.confidence,
        phone: phoneField.confidence,
        address: addressField.confidence,
        products: aiProfile.products.length ? 40 : 0,
      },
      sourceUrl: lead.website!,
      urlClassification: classification,
      contactStatus: contactStatusFor(email, phone),
      enrichmentStatus: 'enriched',
      gstin: lead.gstin,
      sourceTier: lead.sourceTier,
    };
  }

  private firstNonNull<T>(fields: { value: T | null; source: string | null; confidence: number }[]) {
    return fields.find((f) => f.value !== null) ?? { value: null, source: null, confidence: 0 };
  }

  /** Builds a candidate directly from the search lead when we can't/won't fetch the site (marketplace, social, failure, ...). */
  private buildLeadOnlyCandidate(
    lead: RawSupplierResult,
    classification: UrlClassification,
    status: EnrichmentStatus,
    error?: string,
  ): SupplierCandidate {
    const email = lead.email ? lead.email.trim().toLowerCase() : null;
    const phone = lead.phone ?? null;
    return {
      legalName: lead.legalName ?? null,
      website: lead.website ?? '',
      email,
      phone,
      address: null,
      city: lead.city ?? null,
      state: lead.state ?? null,
      country: null,
      businessType: null,
      products: [],
      productCategories: [],
      certifications: [],
      manufacturingCapabilities: [],
      extractionMetadata: { legalNameSource: null, emailSource: null, phoneSource: null, addressSource: null },
      fieldConfidence: {
        legalName: lead.legalName ? 40 : 0,
        email: email ? 60 : 0,
        phone: phone ? 60 : 0,
        address: 0,
        products: 0,
      },
      sourceUrl: lead.website ?? '',
      urlClassification: classification,
      contactStatus: contactStatusFor(email, phone),
      enrichmentStatus: status,
      enrichmentError: error,
      gstin: lead.gstin,
      sourceTier: lead.sourceTier,
    };
  }

  /** Fetches a page with a timeout, response-size cap, redirect-follow, and a declared User-Agent. */
  private async safeFetchHtml(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });
      if (!res.ok) return null;

      const contentType = res.headers.get('content-type') ?? '';
      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return null;

      const reader = res.body?.getReader();
      if (!reader) return await res.text();

      let received = 0;
      const chunks: Uint8Array[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
    } catch (err) {
      this.logger.debug(`Fetch failed for ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

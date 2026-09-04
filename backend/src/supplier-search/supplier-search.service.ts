import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscoveryJob, DiscoveryJobStatus } from './entities/discovery-job.entity';
import { RawSupplierResult } from './dto/search-requirement.dto';
import { ContactStatus, SupplierCandidate } from './dto/supplier-candidate.dto';
import { AiService, SupplierRequirement, SupplierSuggestion } from '../ai/ai.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { ExternalSourceService } from './external-source.service';
import { GoogleMapsCoords } from './adapters/google-maps.adapter';
import { SupplierEnrichmentService } from './supplier-enrichment.service';
import { GstVerificationService } from './gst-verification.service';
import { SupplierVerificationStatus } from '../suppliers/entities/supplier.entity';
import { classifyUrl, UrlClassification } from './util/url-classifier.util';
import {
  extractDomain,
  isValidGstin,
  normalizeCompanyName,
  normalizePhone,
  stringSimilarity,
} from '../common/utils/normalization.util';
import { scoreCapabilityMatch } from '../common/utils/capability-scoring.util';

const DEFAULT_TARGET_COUNT = Number(process.env.SUPPLIER_SEARCH_TARGET_COUNT ?? 10);
const DEFAULT_MIN_SCORE = Number(process.env.SUPPLIER_SEARCH_MIN_SCORE ?? 70);
const DEDUPE_CONFIDENCE_THRESHOLD = 0.82;
// Caps how many raw leads get enriched/verified per discovery job (performance requirement -
// don't fetch hundreds of supplier websites for one search).
const MAX_CANDIDATES_PER_JOB = Number(process.env.SUPPLIER_SEARCH_MAX_CANDIDATES ?? 20);

interface NormalizedResult {
  legalName: string;
  email: string | null;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  gstin?: string;
  sourceTier?: number;
  sourceUrl?: string;
  urlClassification: UrlClassification;
  contactStatus: ContactStatus;
  enrichmentStatus?: string;
  enrichmentError?: string;
  businessType?: string | null;
  products: string[];
  productCategories: string[];
  certifications: string[];
  manufacturingCapabilities: string[];
  fieldConfidence?: Record<string, number>;
  extractionMetadata?: Record<string, unknown>;
  normalizedName: string;
  normalizedPhone?: string;
  domain?: string;
}

@Injectable()
export class SupplierSearchService {
  private readonly logger = new Logger(SupplierSearchService.name);

  constructor(
    @InjectRepository(DiscoveryJob) private readonly jobRepo: Repository<DiscoveryJob>,
    private readonly aiService: AiService,
    private readonly suppliersService: SuppliersService,
    private readonly externalSourceService: ExternalSourceService,
    private readonly supplierEnrichmentService: SupplierEnrichmentService,
    private readonly gstVerificationService: GstVerificationService,
  ) {}

  /**
   * Implements the full flow:
   * requirement -> extract criteria -> search DB (capability-matching table) -> good matches?
   *   -> yes: rank & return immediately
   *   -> no: create a discovery job, return it right away (pending) and run the tiered
   *          discovery + normalize/dedupe/verify/rank pipeline in the background for polling.
   */
  async search(
    prompt: string,
    targetCount?: number,
    minScore?: number,
    coords?: GoogleMapsCoords,
    locationOverride?: string,
  ) {
    const criteria = await this.aiService.extractRequirement(prompt);
    if (!criteria.location && locationOverride) {
      criteria.location = locationOverride;
    }
    const effectiveTargetCount = targetCount ?? DEFAULT_TARGET_COUNT;
    const effectiveMinScore = minScore ?? DEFAULT_MIN_SCORE;

    const internalMatches = await this.suppliersService.matchForRequirement(criteria);
    const goodMatches = internalMatches.filter((m) => m.matchScore >= effectiveMinScore);

    if (goodMatches.length >= effectiveTargetCount) {
      const ranked = this.dedupeBySupplierId(await this.aiService.rankSuppliersForRequirement(criteria, goodMatches));
      await this.suppliersService.recordMatchResults(ranked, criteria as unknown as Record<string, unknown>);
      return { criteria, source: 'database' as const, suppliers: ranked, job: null };
    }

    // Google Places is now the primary external source, and it needs a location (explicit prompt
    // location/override or the requester's own coordinates) to search meaningfully. Rather than
    // silently falling back to un-located results, ask the frontend to prompt the user for one.
    if (this.externalSourceService.googleMapsEnabled && !criteria.location && !coords) {
      const fallbackRanked = this.dedupeBySupplierId(
        await this.aiService.rankSuppliersForRequirement(criteria, internalMatches),
      );
      return { criteria, source: 'location-required' as const, suppliers: fallbackRanked, job: null };
    }

    let job = this.jobRepo.create({
      promptText: prompt,
      criteria: criteria as unknown as Record<string, unknown>,
      status: DiscoveryJobStatus.PENDING,
      targetCount: effectiveTargetCount,
      minScore: effectiveMinScore,
      progressStage: 'queued',
      progressMessage: '🔍 Finding additional suppliers...',
    });
    job = await this.jobRepo.save(job);

    // Fire-and-forget: the frontend polls GET /suppliers/search/jobs/:id for progress/results.
    void this.runDiscoveryJob(job.id, criteria, internalMatches, coords).catch((err) =>
      this.logger.error('Unhandled discovery job failure', err as Error),
    );

    const fallbackRanked = this.dedupeBySupplierId(
      await this.aiService.rankSuppliersForRequirement(criteria, internalMatches),
    );
    // Persist the immediate ranking right away (not just after the background job completes),
    // so partial results are already visible/queryable in the Suppliers tab while discovery runs.
    await this.suppliersService.recordMatchResults(fallbackRanked, criteria as unknown as Record<string, unknown>);
    return { criteria, source: 'discovery-pending' as const, suppliers: fallbackRanked, job };
  }

  /** Guards against the same supplier appearing twice in a ranked result set before it's persisted/returned. */
  private dedupeBySupplierId(suggestions: SupplierSuggestion[]) {
    const seen = new Set<string>();
    return suggestions.filter((s) => (seen.has(s.supplierId) ? false : (seen.add(s.supplierId), true)));
  }

  /** Re-runs website extraction for already-discovered suppliers whose email/phone/GSTIN are
   * still missing despite having a website - fixes cases where the original discovery pass
   * couldn't find contact details that do exist on the site (e.g. extraction gaps, since fixed).
   * Only fills gaps; never overwrites data the supplier already has. */
  async reenrichMissingContacts(limit = 20): Promise<{ processed: number; updated: number }> {
    const candidates = await this.suppliersService.findMissingContactForReenrichment(limit);
    let updated = 0;
    for (const supplier of candidates) {
      if (!supplier.website) continue;
      const { candidate } = await this.supplierEnrichmentService.enrichLead({
        legalName: supplier.legalName,
        website: supplier.website,
        email: supplier.email ?? undefined,
        phone: supplier.phone ?? undefined,
        city: supplier.city ?? undefined,
        state: supplier.state ?? undefined,
        gstin: supplier.taxId ?? undefined,
        sourceTier: supplier.sourceTier,
      });
      const foundSomethingNew =
        (candidate.email && !supplier.email) ||
        (candidate.phone && !supplier.phone) ||
        (candidate.gstin && !supplier.taxId) ||
        (candidate.address && !supplier.address);
      await this.suppliersService.applyEnrichmentPatch(supplier.id, {
        email: candidate.email,
        phone: candidate.phone,
        address: candidate.address,
        city: candidate.city,
        state: candidate.state,
        country: candidate.country,
        gstin: candidate.gstin ?? null,
        enrichmentStatus: candidate.enrichmentStatus,
      });
      if (foundSomethingNew) updated++;
    }
    return { processed: candidates.length, updated };
  }


  private async runDiscoveryJob(
    jobId: string,
    criteria: SupplierRequirement,
    fallbackMatches: {
      id: string;
      legalName: string;
      rating: number;
      categories?: { name: string }[];
      city?: string;
      state?: string;
    }[],
    coords?: GoogleMapsCoords,
  ) {
    let record = (await this.jobRepo.findOne({ where: { id: jobId } }))!;
    record.status = DiscoveryJobStatus.RUNNING;
    record = await this.updateProgress(record, 'generating_queries', '🔍 Generating search queries...');

    try {
      const queries = await this.aiService.generateSearchQueries(criteria);
      record.queries = queries;
      record = await this.updateProgress(record, 'searching', '🔍 Searching licensed APIs, open data and official sites...');

      // Priority 1, 3, 4: external tiered sourcing (licensed API -> open data -> official sites).
      const { results: externalResults, tiersUsed } = await this.externalSourceService.searchTiered(
        queries,
        record.targetCount,
        criteria.location,
        coords,
      );
      record.tiersUsed = tiersUsed;
      record = await this.updateProgress(
        record,
        'tier2_semantic',
        '🔍 Checking previously-discovered suppliers for a semantic match...',
      );

      // Priority 2: semantic/vector similarity search over previously-discovered-but-unmatched suppliers.
      const semanticText = [criteria.product, criteria.specifications, criteria.location]
        .filter(Boolean)
        .join(' ');
      const embedding = await this.aiService.generateEmbedding(semanticText);
      const semanticMatches = await this.suppliersService.findUnmatchedForSemanticSearch(embedding, 20);
      const semanticAsRaw: RawSupplierResult[] = semanticMatches
        .filter((s) => s.matchScore >= 60)
        .map((s) => ({
          legalName: s.legalName,
          email: s.email,
          phone: s.phone,
          city: s.city,
          state: s.state,
          website: s.website,
          gstin: s.taxId,
          sourceTier: 3,
        }));

      record = await this.updateProgress(record, 'collecting_results', '🔍 Collecting candidate supplier leads...');
      // Performance cap: never enrich/verify more than MAX_CANDIDATES_PER_JOB leads for one search.
      const allLeads = [...externalResults, ...semanticAsRaw].slice(0, MAX_CANDIDATES_PER_JOB);

      record = await this.updateProgress(record, 'classifying_urls', '🔍 Classifying supplier lead URLs...');
      const candidates = await this.classifyAndEnrichLeads(allLeads);

      record = await this.updateProgress(record, 'normalizing', '🔍 Normalizing candidate profiles...');
      const normalized = this.normalize(candidates);
      record = await this.updateProgress(record, 'deduping', '🔍 Removing duplicates...');

      const { deduped, confidenceByItem } = this.dedupeWithConfidence(normalized);
      const existingInDb = await this.suppliersService.findExistingForDedupe(
        deduped.map((r) => ({ email: r.email, gstin: r.gstin, phone: r.normalizedPhone, website: r.website })),
      );
      const existingKeys = new Set(
        existingInDb.flatMap((s) =>
          [s.email?.toLowerCase(), s.taxId, s.phone].filter((v): v is string => !!v),
        ),
      );
      const newOnes = deduped.filter(
        (r) =>
          !(r.email && existingKeys.has(r.email.toLowerCase())) &&
          !(r.gstin && existingKeys.has(r.gstin)) &&
          !(r.normalizedPhone && existingKeys.has(r.normalizedPhone)),
      );

      // Exact-match dedupe above can miss the same real-world company re-discovered under a
      // different domain/lead (especially now that missing emails are null, not a unique
      // placeholder). Catch those via fuzzy name+location similarity against known suppliers.
      const knownForFuzzyDedupe = [...existingInDb, ...fallbackMatches];
      const newOnesDeduped = newOnes.filter((r) => {
        const normalizedIncoming = normalizeCompanyName(r.legalName);
        return !knownForFuzzyDedupe.some((existing) => {
          const nameSimilarity = stringSimilarity(normalizedIncoming, normalizeCompanyName(existing.legalName));
          const addressMatch =
            (r.city && existing.city && r.city === existing.city) ||
            (r.state && existing.state && r.state === existing.state);
          return nameSimilarity >= DEDUPE_CONFIDENCE_THRESHOLD && addressMatch;
        });
      });

      record = await this.updateProgress(record, 'verifying', '🔍 Verifying business details...');

      // Tiered verification status: verified / verification_pending / partially_verified / unverified.
      const verifiedCandidates = await Promise.all(
        newOnesDeduped.map(async (r) => ({
          raw: r,
          verificationStatus: await this.computeVerificationStatus(r),
        })),
      );
      // Data quality filter: a lead must at least have a company name plus a website OR another
      // identifiable business source (GSTIN/email/phone) - irrelevant/undiscoverable leads are dropped.
      const qualified = verifiedCandidates.filter((v) => this.passesMinimumQuality(v.raw));

      record = await this.updateProgress(record, 'saving', '🔍 Saving qualified profiles for review...');

      const categoryNames = criteria.product ? [criteria.product] : [];
      const created = await this.suppliersService.bulkCreateDiscovered(
        qualified.map((v) => ({
          legalName: v.raw.legalName,
          email: v.raw.email,
          phone: v.raw.phone,
          address: v.raw.address,
          city: v.raw.city,
          state: v.raw.state,
          country: v.raw.country,
          website: v.raw.website,
          gstin: v.raw.gstin,
          contactStatus: v.raw.contactStatus,
          verificationStatus: v.verificationStatus,
          discoveryConfidence: confidenceByItem.get(v.raw) ?? 100,
          sourceTier: v.raw.sourceTier,
          discoverySourceUrl: v.raw.sourceUrl,
          sourceType: v.raw.urlClassification,
          enrichmentStatus: v.raw.enrichmentStatus,
          enrichmentError: v.raw.enrichmentError,
          businessType: v.raw.businessType,
          products: v.raw.products,
          productCategories: v.raw.productCategories,
          certifications: v.raw.certifications,
          manufacturingCapabilities: v.raw.manufacturingCapabilities,
          fieldConfidence: v.raw.fieldConfidence,
          extractionMetadata: v.raw.extractionMetadata,
        })),
        categoryNames,
      );

      record = await this.updateProgress(record, 'ranking', '🔍 Ranking candidates against your requirement...');

      // Rank (product/quantity/location/verification/past-performance via the capability-matching table).
      // Newly-discovered suppliers otherwise entered ranking with matchScore:0, skipping the
      // capability-matching table entirely (including its 15-point locationMatch weight) - so a
      // discovered supplier in the wrong country scored the same as one in the right city.
      const scoredCreated = created.map((s) => ({
        ...s,
        matchScore: scoreCapabilityMatch(criteria, s).total,
      }));
      const combinedCandidates = [...fallbackMatches, ...scoredCreated];
      const ranked = this.dedupeBySupplierId(
        await this.aiService.rankSuppliersForRequirement(criteria, combinedCandidates),
      );
      await this.suppliersService.recordMatchResults(ranked, criteria as unknown as Record<string, unknown>);

      record.status = DiscoveryJobStatus.COMPLETED;
      record.discoveredCount = normalized.length;
      record.qualifiedCount = created.length;
      record.progressStage = 'done';
      record.progressMessage = `✅ Found ${created.length} new qualified supplier(s).`;
      record.finalResults = ranked;
      record.resultsPreview = ranked;
      record = await this.jobRepo.save(record);

      return { record, rankedSuppliers: ranked };
    } catch (err) {
      this.logger.error('Discovery job failed', err as Error);
      record.status = DiscoveryJobStatus.FAILED;
      record.errorMessage = (err as Error).message;
      record.progressStage = 'failed';
      record.progressMessage = '❌ Discovery job failed.';

      const ranked = this.dedupeBySupplierId(
        await this.aiService.rankSuppliersForRequirement(criteria, fallbackMatches),
      );
      record.finalResults = ranked;
      record = await this.jobRepo.save(record);
      return { record, rankedSuppliers: ranked };
    }
  }

  private async updateProgress(record: DiscoveryJob, stage: string, message: string): Promise<DiscoveryJob> {
    record.progressStage = stage;
    record.progressMessage = message;
    return this.jobRepo.save(record);
  }

  /**
   * Classifies each lead's URL and, for official-website leads, runs it through
   * SupplierEnrichmentService (fetch -> structured extraction -> AI profile). Leads pointing at
   * marketplaces/directories/government/social sites are kept as-is (never scraped directly) using
   * whatever contact data the source tier already supplied. One supplier's enrichment failure never
   * aborts the batch - it's simply marked enrichment_failed and processing continues.
   */
  private async classifyAndEnrichLeads(leads: RawSupplierResult[]): Promise<SupplierCandidate[]> {
    return Promise.all(
      leads.map(async (lead) => {
        try {
          const { candidate } = await this.supplierEnrichmentService.enrichLead(lead);
          return candidate;
        } catch (err) {
          this.logger.warn(`Unexpected enrichment error for ${lead.website ?? lead.legalName}`, err as Error);
          const classification = classifyUrl(lead.website);
          return {
            legalName: lead.legalName ?? null,
            website: lead.website ?? '',
            email: lead.email ?? null,
            phone: lead.phone ?? null,
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
            fieldConfidence: { legalName: 0, email: 0, phone: 0, address: 0, products: 0 },
            sourceUrl: lead.website ?? '',
            urlClassification: classification,
            contactStatus: lead.email && lead.phone ? 'available' : lead.email || lead.phone ? 'partial' : 'missing',
            enrichmentStatus: 'failed',
            enrichmentError: (err as Error).message,
            gstin: lead.gstin,
            sourceTier: lead.sourceTier,
          } satisfies SupplierCandidate;
        }
      }),
    );
  }

  private normalize(candidates: SupplierCandidate[]): NormalizedResult[] {
    return candidates
      // Data quality filter: news/blog/job/irrelevant pages never become supplier candidates.
      .filter((c) => c.urlClassification !== 'irrelevant')
      .filter((c) => c.legalName && (c.website || c.email || c.phone || c.gstin))
      .map((c) => {
        const domain = extractDomain(c.website);
        return {
          legalName: c.legalName!.trim(),
          email: c.email ? c.email.trim().toLowerCase() : null,
          phone: c.phone?.trim(),
          address: c.address?.trim(),
          city: c.city?.trim(),
          state: c.state?.trim(),
          country: c.country?.trim(),
          website: c.website?.trim(),
          gstin: c.gstin?.trim().toUpperCase(),
          sourceTier: c.sourceTier,
          sourceUrl: c.sourceUrl,
          urlClassification: c.urlClassification,
          contactStatus: c.contactStatus,
          enrichmentStatus: c.enrichmentStatus,
          enrichmentError: c.enrichmentError,
          businessType: c.businessType,
          products: c.products ?? [],
          productCategories: c.productCategories ?? [],
          certifications: c.certifications ?? [],
          manufacturingCapabilities: c.manufacturingCapabilities ?? [],
          fieldConfidence: c.fieldConfidence as unknown as Record<string, number>,
          extractionMetadata: c.extractionMetadata as unknown as Record<string, unknown>,
          normalizedName: normalizeCompanyName(c.legalName!),
          normalizedPhone: normalizePhone(c.phone ?? undefined),
          domain,
        };
      });
  }

  /**
   * Dedupes by GSTIN / website domain / phone / name+address similarity, assigning a confidence
   * score (0-100) per surviving record based on the strongest signal that matched a duplicate.
   * Keyed by object identity (not email, which may now be null for multiple records) to avoid
   * key collisions.
   */
  private dedupeWithConfidence(items: NormalizedResult[]): {
    deduped: NormalizedResult[];
    confidenceByItem: Map<NormalizedResult, number>;
  } {
    const kept: NormalizedResult[] = [];
    const confidenceByItem = new Map<NormalizedResult, number>();

    for (const item of items) {
      let matchIndex = -1;
      let matchConfidence = 0;

      for (let i = 0; i < kept.length; i++) {
        const other = kept[i];
        let confidence = 0;
        if (item.gstin && other.gstin && item.gstin === other.gstin) {
          confidence = Math.max(confidence, 100);
        }
        if (item.domain && other.domain && item.domain === other.domain) {
          confidence = Math.max(confidence, 90);
        }
        if (item.normalizedPhone && other.normalizedPhone && item.normalizedPhone === other.normalizedPhone) {
          confidence = Math.max(confidence, 85);
        }
        const nameSimilarity = stringSimilarity(item.normalizedName, other.normalizedName);
        const addressMatch = (item.city && item.city === other.city) || (item.state && item.state === other.state);
        if (nameSimilarity >= DEDUPE_CONFIDENCE_THRESHOLD && addressMatch) {
          confidence = Math.max(confidence, Math.round(nameSimilarity * 80));
        }

        if (confidence > matchConfidence) {
          matchConfidence = confidence;
          matchIndex = i;
        }
      }

      if (matchIndex >= 0 && matchConfidence >= 70) {
        confidenceByItem.set(kept[matchIndex], matchConfidence);
        continue; // duplicate of an already-kept record
      }

      kept.push(item);
      confidenceByItem.set(item, 100);
    }

    return { deduped: kept, confidenceByItem };
  }

  /**
   * Separates identity signals (name/website/email/phone/address/GSTIN found) from an overall
   * verification status, so a supplier is never marked "verified" just because its website loads:
   *  - verified: GSTIN authoritatively confirmed active via GstVerificationService (Surepass), or
   *    (when that's unconfigured) reachable official site + shape-valid GSTIN + phone
   *  - verification_pending: good profile (name+website+contact/location+product info) but no GSTIN yet
   *  - partially_verified: name + official website + at least one contact/location signal
   *  - unverified: little else is known
   */
  private async computeVerificationStatus(r: NormalizedResult): Promise<SupplierVerificationStatus> {
    const hasName = !!r.legalName;
    const emailValid = !!r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email);
    const phonePresent = !!r.normalizedPhone && r.normalizedPhone.length === 10;
    const hasAddress = !!(r.address || r.city || r.state);
    const gstinShapeValid = isValidGstin(r.gstin);
    const hasProfile = r.products.length > 0 || r.certifications.length > 0 || r.manufacturingCapabilities.length > 0;
    const websiteReachable = r.enrichmentStatus === 'enriched' ? true : await this.isWebsiteReachable(r.website);

    // Authoritative signal: a real GSTIN registry check beats every other heuristic below.
    if (gstinShapeValid && this.gstVerificationService.enabled) {
      const gstResult = await this.gstVerificationService.verify(r.gstin!);
      if (gstResult) {
        if (gstResult.legalName) r.legalName = gstResult.legalName;
        if (gstResult.address && !r.address) r.address = gstResult.address;
        if (gstResult.verified) return SupplierVerificationStatus.VERIFIED;
      }
    }

    if (websiteReachable && gstinShapeValid && phonePresent) {
      return SupplierVerificationStatus.VERIFIED;
    }
    if (hasName && websiteReachable && (emailValid || phonePresent || hasAddress) && hasProfile) {
      return SupplierVerificationStatus.VERIFICATION_PENDING;
    }
    if (hasName && websiteReachable && (emailValid || phonePresent || hasAddress)) {
      return SupplierVerificationStatus.PARTIALLY_VERIFIED;
    }
    return SupplierVerificationStatus.UNVERIFIED;
  }

  private async isWebsiteReachable(website?: string): Promise<boolean> {
    if (!website) return false;
    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Minimum bar to persist a discovered lead at all: a company name plus some identifiable source. */
  private passesMinimumQuality(r: NormalizedResult): boolean {
    return !!r.legalName && !!(r.website || r.gstin || r.email || r.phone);
  }

  async getJob(id: string): Promise<DiscoveryJob | null> {
    return this.jobRepo.findOne({ where: { id } });
  }
}

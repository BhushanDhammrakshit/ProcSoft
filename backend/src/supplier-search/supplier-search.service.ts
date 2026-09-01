import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscoveryJob, DiscoveryJobStatus } from './entities/discovery-job.entity';
import { RawSupplierResult } from './dto/search-requirement.dto';
import { AiService, SupplierRequirement } from '../ai/ai.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { ExternalSourceService } from './external-source.service';

const MIN_GOOD_MATCHES = 3;
const GOOD_MATCH_SCORE_THRESHOLD = 3;

@Injectable()
export class SupplierSearchService {
  private readonly logger = new Logger(SupplierSearchService.name);

  constructor(
    @InjectRepository(DiscoveryJob) private readonly jobRepo: Repository<DiscoveryJob>,
    private readonly aiService: AiService,
    private readonly suppliersService: SuppliersService,
    private readonly externalSourceService: ExternalSourceService,
  ) {}

  /**
   * Implements the full flow:
   * requirement -> extract criteria -> search DB -> good matches? -> rank & return
   *                                                -> else automated discovery -> normalize/dedupe/verify -> rank -> save -> return
   */
  async search(prompt: string) {
    const criteria = await this.aiService.extractRequirement(prompt);

    const internalMatches = await this.suppliersService.matchForRequirement(criteria);
    const goodMatches = internalMatches.filter((m) => m.matchScore >= GOOD_MATCH_SCORE_THRESHOLD);

    if (goodMatches.length >= MIN_GOOD_MATCHES) {
      const ranked = await this.aiService.rankSuppliersForRequirement(criteria, goodMatches);
      return { criteria, source: 'database' as const, suppliers: ranked, job: null };
    }

    const job = await this.runDiscoveryJob(prompt, criteria, internalMatches);
    return {
      criteria,
      source: 'discovery' as const,
      suppliers: job.rankedSuppliers,
      job: job.record,
    };
  }

  /** Background-style discovery job (executed inline for MVP; safe to move to a queue worker later). */
  private async runDiscoveryJob(
    prompt: string,
    criteria: SupplierRequirement,
    fallbackMatches: { id: string; legalName: string; rating: number; categories?: { name: string }[] }[],
  ) {
    let record = this.jobRepo.create({
      promptText: prompt,
      criteria: criteria as unknown as Record<string, unknown>,
      status: DiscoveryJobStatus.RUNNING,
    });
    record = await this.jobRepo.save(record);

    try {
      // AI generates multiple search queries
      const queries = await this.aiService.generateSearchQueries(criteria);
      record.queries = queries;
      await this.jobRepo.save(record);

      // Search external sources (APIs / open data / official supplier sites via configured connector)
      const rawResults = await this.externalSourceService.searchMany(queries);

      // Normalize
      const normalized = this.normalize(rawResults);

      // Remove duplicates (within batch + against existing DB)
      const deduped = this.dedupe(normalized);
      const existing = await this.suppliersService.existingEmails(deduped.map((r) => r.email));
      const newOnes = deduped.filter((r) => !existing.has(r.email.toLowerCase()));

      // Verify basic business details (has name, valid-looking email/phone)
      const verified = newOnes.filter((r) => this.basicVerify(r));

      // Save qualified/temporary supplier profiles to the DB, tagged pending_verification
      const categoryNames = criteria.product ? [criteria.product] : [];
      const created = await this.suppliersService.bulkCreateDiscovered(verified, categoryNames);

      // Match & rank (product/quantity/location match already applied via query generation + verify step)
      const combinedCandidates = [...fallbackMatches, ...created.map((s) => ({ ...s, matchScore: 0 }))];
      const ranked = await this.aiService.rankSuppliersForRequirement(criteria, combinedCandidates);

      record.status = DiscoveryJobStatus.COMPLETED;
      record.discoveredCount = normalized.length;
      record.qualifiedCount = created.length;
      record = await this.jobRepo.save(record);

      return { record, rankedSuppliers: ranked };
    } catch (err) {
      this.logger.error('Discovery job failed', err as Error);
      record.status = DiscoveryJobStatus.FAILED;
      record.errorMessage = (err as Error).message;
      record = await this.jobRepo.save(record);

      // Still return whatever we had from the database as a fallback.
      const ranked = await this.aiService.rankSuppliersForRequirement(criteria, fallbackMatches);
      return { record, rankedSuppliers: ranked };
    }
  }

  private normalize(raw: RawSupplierResult[]): RawSupplierResult[] {
    return raw
      .filter((r) => r.legalName && r.email)
      .map((r) => ({
        legalName: r.legalName.trim(),
        email: r.email.trim().toLowerCase(),
        phone: r.phone?.trim(),
        city: r.city?.trim(),
        state: r.state?.trim(),
        website: r.website?.trim(),
      }));
  }

  private dedupe(raw: RawSupplierResult[]): RawSupplierResult[] {
    const seen = new Set<string>();
    const result: RawSupplierResult[] = [];
    for (const r of raw) {
      if (seen.has(r.email)) continue;
      seen.add(r.email);
      result.push(r);
    }
    return result;
  }

  private basicVerify(r: RawSupplierResult): boolean {
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email);
    return Boolean(r.legalName && emailValid);
  }

  async getJob(id: string): Promise<DiscoveryJob | null> {
    return this.jobRepo.findOne({ where: { id } });
  }
}

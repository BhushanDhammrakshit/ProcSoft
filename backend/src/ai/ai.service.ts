import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { Rfq } from '../rfq/entities/rfq.entity';

export interface RfqDraft {
  title: string;
  description: string;
  category: string;
  items: { itemName: string; quantity: number; uom: string; specifications: string }[];
}

export interface SupplierSuggestion {
  supplierId: string;
  legalName: string;
  score: number;
  reason: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  website?: string;
  verificationStatus?: string;
  source?: string;
}

export interface SupplierRequirement {
  product: string;
  quantity?: string;
  location?: string;
  budget?: string;
  specifications?: string;
}

/** Strict-JSON AI supplier profile extracted from cleaned website text - never invents missing fields. */
export interface AiSupplierProfile {
  companyName: string | null;
  businessType: string | null;
  products: string[];
  productCategories: string[];
  industries: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  manufacturingCapabilities: string[];
  productionCapacity: string | null;
  certifications: string[];
  serviceAreas: string[];
}

const EMPTY_SUPPLIER_PROFILE: AiSupplierProfile = {
  companyName: null,
  businessType: null,
  products: [],
  productCategories: [],
  industries: [],
  city: null,
  state: null,
  country: null,
  manufacturingCapabilities: [],
  productionCapacity: null,
  certifications: [],
  serviceAreas: [],
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  // Azure requires embeddings to hit their own deployment (a chat deployment like gpt-4o can't serve them).
  private readonly embeddingClient: OpenAI | null;
  private readonly embeddingModel: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    // Azure OpenAI needs a deployment-scoped baseURL + api-version query + api-key header, not the
    // plain OpenAI SDK defaults (Authorization: Bearer + /chat/completions with no deployment path).
    const azureMatch = baseURL?.match(/^(https:\/\/[^/]+)\/openai\/deployments\/([^/?]+)/);

    if (apiKey && azureMatch) {
      const [, azureEndpoint, deployment] = azureMatch;
      const apiVersion = new URL(baseURL!).searchParams.get('api-version') ?? '2024-02-15-preview';
      this.model = deployment;
      this.client = new OpenAI({
        apiKey,
        baseURL: `${azureEndpoint}/openai/deployments/${deployment}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: { 'api-key': apiKey },
      });

      const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
      if (embeddingDeployment) {
        this.embeddingModel = embeddingDeployment;
        this.embeddingClient = new OpenAI({
          apiKey,
          baseURL: `${azureEndpoint}/openai/deployments/${embeddingDeployment}`,
          defaultQuery: { 'api-version': apiVersion },
          defaultHeaders: { 'api-key': apiKey },
        });
      } else {
        this.embeddingModel = '';
        this.embeddingClient = null;
        this.logger.warn(
          'AZURE_OPENAI_EMBEDDING_DEPLOYMENT not set — embeddings will use the local hashing fallback.',
        );
      }
    } else {
      this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
      this.client = apiKey ? new OpenAI({ apiKey, baseURL: baseURL || undefined }) : null;
      this.embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
      this.embeddingClient = this.client;
    }
    if (!this.client) {
      this.logger.warn('OPENAI_API_KEY not set — AI features will use fallback heuristics.');
    }
  }

  private get enabled(): boolean {
    return this.client !== null;
  }

  /** Turns a short buyer prompt (e.g. "need 500 cardboard boxes for shipping") into a structured RFQ draft. */
  async generateRfqDraft(prompt: string): Promise<RfqDraft> {
    if (!this.enabled) {
      return {
        title: prompt.slice(0, 80),
        description: prompt,
        category: 'General',
        items: [{ itemName: prompt.slice(0, 50), quantity: 1, uom: 'unit', specifications: '' }],
      };
    }

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a procurement assistant. Convert the buyer\'s request into a structured RFQ JSON object ' +
              'with fields: title, description, category, items (array of {itemName, quantity, uom, specifications}). ' +
              'Respond with JSON only.',
          },
          { role: 'user', content: prompt },
        ],
      });
      const content = completion.choices[0]?.message?.content ?? '{}';
      return JSON.parse(content) as RfqDraft;
    } catch (err) {
      this.logger.error('AI RFQ draft generation failed, falling back to heuristic', err as Error);
      return {
        title: prompt.slice(0, 80),
        description: prompt,
        category: 'General',
        items: [{ itemName: prompt.slice(0, 50), quantity: 1, uom: 'unit', specifications: '' }],
      };
    }
  }

  /** Ranks a RFQ's already-invited/candidate suppliers; falls back to a rating+category heuristic without AI. */
  async suggestSuppliersForRfq(rfq: Rfq): Promise<SupplierSuggestion[]> {
    const candidates = rfq.supplierInvites?.map((inv) => inv.supplier) ?? [];

    if (!candidates.length) return [];

    // Heuristic fallback: rating + category match, used when AI is disabled or as a baseline.
    const heuristic = candidates.map((s) => {
      const categoryMatch = s.categories?.some(
        (c) => c.name.toLowerCase() === (rfq.category ?? '').toLowerCase(),
      );
      const score = (s.rating ?? 0) * 0.7 + (categoryMatch ? 3 : 0);
      return {
        supplierId: s.id,
        legalName: s.legalName,
        score: Number(score.toFixed(2)),
        reason: categoryMatch
          ? 'Category match and historical rating'
          : 'Ranked by historical performance rating',
      };
    });

    if (!this.enabled) {
      return heuristic.sort((a, b) => b.score - a.score);
    }

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a procurement analyst. Given an RFQ and candidate suppliers with baseline scores, ' +
              'return a JSON object {"suggestions": [{supplierId, legalName, score, reason}]} re-ranked by fit ' +
              'for the RFQ category/items. Keep supplierId values unchanged.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              rfq: { title: rfq.title, category: rfq.category, description: rfq.description },
              candidates: heuristic,
            }),
          },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return parsed.suggestions ?? heuristic;
    } catch (err) {
      this.logger.error('AI supplier ranking failed, falling back to heuristic', err as Error);
      return heuristic.sort((a, b) => b.score - a.score);
    }
  }

  /** Parses a free-text buyer requirement into structured search criteria. */
  async extractRequirement(prompt: string): Promise<SupplierRequirement> {
    if (!this.enabled) {
      // Fallback: treat the whole prompt as the product description.
      return { product: prompt };
    }

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract procurement search criteria from the buyer\'s message as JSON: ' +
              '{product, quantity, location, budget, specifications}. Use empty string for fields not mentioned. JSON only.',
          },
          { role: 'user', content: prompt },
        ],
      });
      return JSON.parse(completion.choices[0]?.message?.content ?? '{}') as SupplierRequirement;
    } catch (err) {
      this.logger.error('AI requirement extraction failed, falling back to raw prompt', err as Error);
      return { product: prompt };
    }
  }

  /** Generates a handful of external search-engine style queries to discover new suppliers matching criteria. */
  async generateSearchQueries(criteria: SupplierRequirement): Promise<string[]> {
    if (!this.enabled) {
      const base = [criteria.product, criteria.location].filter(Boolean).join(' ');
      return [`${base} supplier`, `${base} manufacturer`].filter((q) => q.trim().length > 0);
    }

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Given procurement search criteria, produce 3-5 short web-search queries to find suppliers/manufacturers ' +
              'matching the product, location and specifications. Respond as JSON {"queries": ["...", ...]}.',
          },
          { role: 'user', content: JSON.stringify(criteria) },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return Array.isArray(parsed.queries) ? parsed.queries : [];
    } catch (err) {
      this.logger.error('AI search-query generation failed, falling back to heuristic', err as Error);
      const base = [criteria.product, criteria.location].filter(Boolean).join(' ');
      return [`${base} supplier`, `${base} manufacturer`].filter((q) => q.trim().length > 0);
    }
  }

  /** Ranks arbitrary candidate suppliers against free-text criteria (used by the AI supplier-search flow). */
  async rankSuppliersForRequirement(
    criteria: SupplierRequirement,
    candidates: {
      id: string;
      legalName: string;
      rating: number;
      categories?: { name: string }[];
      matchScore?: number; // pre-computed capability-matching-table total (0-100), used as the base score when present
      email?: string;
      phone?: string;
      city?: string;
      state?: string;
      website?: string;
      verificationStatus?: string;
      source?: string;
    }[],
  ): Promise<SupplierSuggestion[]> {
    if (!candidates.length) return [];

    const contactById = new Map(
      candidates.map((s) => [
        s.id,
        {
          email: s.email,
          phone: s.phone,
          city: s.city,
          state: s.state,
          website: s.website,
          verificationStatus: s.verificationStatus,
          source: s.source,
        },
      ]),
    );

    const heuristic: SupplierSuggestion[] = candidates.map((s) => {
      if (s.matchScore) {
        return {
          supplierId: s.id,
          legalName: s.legalName,
          score: s.matchScore,
          reason: 'Ranked via capability-matching table (product/quantity/location/verification/rating)',
          ...contactById.get(s.id),
        };
      }
      const categoryMatch = s.categories?.some((c) =>
        c.name.toLowerCase().includes((criteria.product ?? '').toLowerCase().slice(0, 20)),
      );
      const score = (s.rating ?? 0) * 0.7 + (categoryMatch ? 3 : 0);
      return {
        supplierId: s.id,
        legalName: s.legalName,
        score: Number(score.toFixed(2)),
        reason: categoryMatch ? 'Product/category match and rating' : 'Ranked by rating only',
        ...contactById.get(s.id),
      };
    });

    // Re-attaches contact/profile fields onto the model's response by supplierId, since the model
    // is only asked to re-rank {supplierId, legalName, score, reason} and doesn't echo the rest back.
    const enrich = (suggestions: SupplierSuggestion[]) =>
      suggestions.map((s) => ({ ...s, ...contactById.get(s.supplierId) }));

    if (!this.enabled) return heuristic.sort((a, b) => b.score - a.score);

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a procurement analyst re-ranking candidate suppliers for a buyer requirement. ' +
              'Weigh criteria.location against each candidate\'s city/state - penalize suppliers outside ' +
              'the requested geography relative to ones inside it. ' +
              'Return JSON {"suggestions": [{supplierId, legalName, score, reason}]}, keep supplierId unchanged.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              criteria,
              candidates: heuristic.map(({ supplierId, legalName, score, reason }) => ({
                supplierId,
                legalName,
                score,
                reason,
                city: contactById.get(supplierId)?.city,
                state: contactById.get(supplierId)?.state,
              })),
            }),
          },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return parsed.suggestions ? enrich(parsed.suggestions) : heuristic.sort((a, b) => b.score - a.score);
    } catch (err) {
      this.logger.error('AI supplier ranking for requirement failed, falling back to heuristic', err as Error);
      return heuristic.sort((a, b) => b.score - a.score);
    }
  }

  /**
   * Generates a text embedding for semantic similarity search. Falls back to a small
   * deterministic hashing-based pseudo-embedding when AI is disabled, so previously-
   * discovered-but-unmatched suppliers can still be re-matched without pgvector/OpenAI.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingClient) {
      return this.hashEmbedding(text);
    }

    try {
      const res = await this.embeddingClient.embeddings.create({
        model: this.embeddingModel,
        input: text,
      });
      return res.data[0]?.embedding ?? this.hashEmbedding(text);
    } catch (err) {
      this.logger.error('Embedding generation failed, falling back to hashing', err as Error);
      return this.hashEmbedding(text);
    }
  }

  /** Deterministic bag-of-words hashing embedding (fixed 64 dims) — no external calls required. */
  private hashEmbedding(text: string, dims = 64): number[] {
    const vector = new Array(dims).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      }
      vector[hash % dims] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  /** Drafts a personalized bulk-mail body per supplier for a campaign (RFQ invite, general outreach, etc.). */
  async draftSupplierEmail(context: {
    supplierName: string;
    purpose: string;
    keyPoints?: string;
  }): Promise<string> {
    if (!this.enabled) {
      return `Dear ${context.supplierName},\n\n${context.purpose}\n\n${context.keyPoints ?? ''}\n\nRegards,\nProcurement Team`;
    }

    const completion = await this.client!.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a procurement officer writing a concise, professional business email to a supplier. ' +
            'Keep it under 150 words. Plain text only, no markdown.',
        },
        {
          role: 'user',
          content: `Supplier: ${context.supplierName}\nPurpose: ${context.purpose}\nKey points: ${context.keyPoints ?? 'N/A'}`,
        },
      ],
    });

    return completion.choices[0]?.message?.content ?? '';
  }

  /**
   * Extracts a structured supplier profile from cleaned (tag-stripped) website text, for the supplier
   * enrichment pipeline's AI step. Only ever reports explicitly-stated information: missing scalar
   * fields are null and missing list fields are [] - the model is instructed never to guess/invent
   * (especially productionCapacity/certifications), and deterministic HTML-extracted fields always
   * take precedence over this output if the two conflict.
   */
  async extractSupplierProfile(cleanedText: string): Promise<AiSupplierProfile> {
    if (!this.enabled || !cleanedText.trim()) return { ...EMPTY_SUPPLIER_PROFILE };

    try {
      const completion = await this.client!.chat.completions.create({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You extract a supplier profile from a company website\'s text for a B2B procurement platform. ' +
              'Return strict JSON with exactly these fields: companyName, businessType, products, productCategories, ' +
              'industries, city, state, country, manufacturingCapabilities, productionCapacity, certifications, ' +
              'serviceAreas. Rules: extract ONLY explicitly stated information; use null for a missing scalar field ' +
              'and [] for a missing list field; never invent, guess or infer data - this is especially critical for ' +
              'productionCapacity and certifications; businessType must be one of Manufacturer, Distributor, Trader, ' +
              'Wholesaler, Service Provider, or Unknown. Respond with JSON only.',
          },
          { role: 'user', content: cleanedText.slice(0, 6000) },
        ],
      });
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return { ...EMPTY_SUPPLIER_PROFILE, ...parsed };
    } catch (err) {
      this.logger.error('AI supplier profile extraction failed, returning an empty profile', err as Error);
      return { ...EMPTY_SUPPLIER_PROFILE };
    }
  }
}

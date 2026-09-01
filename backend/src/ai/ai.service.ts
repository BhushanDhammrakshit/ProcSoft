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
}

export interface SupplierRequirement {
  product: string;
  quantity?: string;
  location?: string;
  budget?: string;
  specifications?: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
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
    try {
      return JSON.parse(content) as RfqDraft;
    } catch {
      this.logger.error('Failed to parse AI RFQ draft response');
      return { title: prompt.slice(0, 80), description: prompt, category: 'General', items: [] };
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

    try {
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return parsed.suggestions ?? heuristic;
    } catch {
      return heuristic.sort((a, b) => b.score - a.score);
    }
  }

  /** Parses a free-text buyer requirement into structured search criteria. */
  async extractRequirement(prompt: string): Promise<SupplierRequirement> {
    if (!this.enabled) {
      // Fallback: treat the whole prompt as the product description.
      return { product: prompt };
    }

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

    try {
      return JSON.parse(completion.choices[0]?.message?.content ?? '{}') as SupplierRequirement;
    } catch {
      this.logger.error('Failed to parse AI requirement extraction response');
      return { product: prompt };
    }
  }

  /** Generates a handful of external search-engine style queries to discover new suppliers matching criteria. */
  async generateSearchQueries(criteria: SupplierRequirement): Promise<string[]> {
    if (!this.enabled) {
      const base = [criteria.product, criteria.location].filter(Boolean).join(' ');
      return [`${base} supplier`, `${base} manufacturer`].filter((q) => q.trim().length > 0);
    }

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

    try {
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return Array.isArray(parsed.queries) ? parsed.queries : [];
    } catch {
      return [];
    }
  }

  /** Ranks arbitrary candidate suppliers against free-text criteria (used by the AI supplier-search flow). */
  async rankSuppliersForRequirement(
    criteria: SupplierRequirement,
    candidates: { id: string; legalName: string; rating: number; categories?: { name: string }[] }[],
  ): Promise<SupplierSuggestion[]> {
    if (!candidates.length) return [];

    const heuristic = candidates.map((s) => {
      const categoryMatch = s.categories?.some((c) =>
        c.name.toLowerCase().includes((criteria.product ?? '').toLowerCase().slice(0, 20)),
      );
      const score = (s.rating ?? 0) * 0.7 + (categoryMatch ? 3 : 0);
      return {
        supplierId: s.id,
        legalName: s.legalName,
        score: Number(score.toFixed(2)),
        reason: categoryMatch ? 'Product/category match and rating' : 'Ranked by rating only',
      };
    });

    if (!this.enabled) return heuristic.sort((a, b) => b.score - a.score);

    const completion = await this.client!.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a procurement analyst re-ranking candidate suppliers for a buyer requirement. ' +
            'Return JSON {"suggestions": [{supplierId, legalName, score, reason}]}, keep supplierId unchanged.',
        },
        { role: 'user', content: JSON.stringify({ criteria, candidates: heuristic }) },
      ],
    });

    try {
      const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
      return parsed.suggestions ?? heuristic.sort((a, b) => b.score - a.score);
    } catch {
      return heuristic.sort((a, b) => b.score - a.score);
    }
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
}

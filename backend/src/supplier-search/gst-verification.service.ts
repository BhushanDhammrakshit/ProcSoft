import { Injectable, Logger } from '@nestjs/common';

const FETCH_TIMEOUT_MS = Number(process.env.SUREPASS_TIMEOUT_MS ?? 8000);

export interface GstVerificationResult {
  verified: boolean;
  legalName?: string;
  tradeName?: string;
  status?: string;
  address?: string;
}

/**
 * Authoritative GSTIN verification via Surepass's Business/GST Verification API
 * (https://surepass.io/gst-verification-api/) - a paid, KYC-gated provider, so this is opt-in via
 * env vars and never blocks discovery when unconfigured (same disabled-by-default pattern as the
 * rest of ExternalSourceService/AiService). Requires SUREPASS_API_KEY and the exact endpoint URL
 * from your Surepass dashboard (SUREPASS_GST_VERIFY_URL) - not hardcoded here since the precise
 * path/response shape is only published behind their signup-gated docs. Response parsing is
 * defensive (tries a few common envelope shapes) since the exact schema wasn't publicly available
 * at implementation time - adjust `parseResponse` once you can see a real response from your account.
 */
@Injectable()
export class GstVerificationService {
  private readonly logger = new Logger(GstVerificationService.name);
  private readonly apiKey = process.env.SUREPASS_API_KEY;
  private readonly verifyUrl = process.env.SUREPASS_GST_VERIFY_URL;

  get enabled(): boolean {
    return !!(this.apiKey && this.verifyUrl);
  }

  /** Verifies a GSTIN against Surepass. Returns null (never throws) if unconfigured or the call fails. */
  async verify(gstin: string): Promise<GstVerificationResult | null> {
    if (!this.enabled) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(this.verifyUrl!, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id_number: gstin }),
      });
      if (!res.ok) {
        this.logger.warn(`Surepass GST verification responded with ${res.status} for ${gstin}`);
        return null;
      }
      const json = (await res.json()) as Record<string, unknown>;
      return this.parseResponse(json);
    } catch (err) {
      this.logger.warn(`Surepass GST verification failed for ${gstin}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Tries a few plausible response envelopes (top-level, `.data`, `.data.data`) for common KYC-API shapes. */
  private parseResponse(json: Record<string, unknown>): GstVerificationResult | null {
    const candidates = [json, json.data, (json.data as Record<string, unknown> | undefined)?.data].filter(
      (v): v is Record<string, unknown> => !!v && typeof v === 'object',
    );

    for (const c of candidates) {
      const legalName = this.firstString(c, ['legal_name', 'legalName', 'business_name', 'name']);
      const status = this.firstString(c, ['gstin_status', 'status', 'gst_status']);
      if (legalName || status) {
        return {
          verified: !status || /active/i.test(status),
          legalName,
          tradeName: this.firstString(c, ['trade_name', 'tradeName']),
          status,
          address: this.firstString(c, ['address', 'principal_place_of_business', 'pradr']),
        };
      }
    }
    return null;
  }

  private firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return undefined;
  }
}

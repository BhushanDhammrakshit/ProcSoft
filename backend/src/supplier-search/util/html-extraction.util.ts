/**
 * Deterministic (non-AI) extraction of structured supplier signals from raw HTML: JSON-LD/schema.org
 * data first, then meta/title/visible-text fallbacks. Each extracted field reports its source and a
 * confidence score (0-100) so the enrichment pipeline can prefer structured data over AI-guessed data.
 */

export interface FieldExtraction<T> {
  value: T | null;
  source: string | null;
  confidence: number;
}

const EMPTY_EXTRACTION: FieldExtraction<never> = { value: null, source: null, confidence: 0 };

export function extractJsonLd(html: string): Record<string, any>[] {
  const blocks: Record<string, any>[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        if (Array.isArray(item['@graph'])) blocks.push(...item['@graph']);
        else blocks.push(item);
      }
    } catch {
      // Malformed JSON-LD is common in the wild - skip rather than fail the whole extraction.
    }
  }
  return blocks;
}

function findOrgLike(jsonLd: Record<string, any>[]): Record<string, any> | undefined {
  return jsonLd.find((block) => {
    const type = block?.['@type'];
    const types = Array.isArray(type) ? type : [type];
    return types.some((t) => typeof t === 'string' && /organization|localbusiness/i.test(t));
  });
}

export function extractCompanyName(html: string, jsonLd: Record<string, any>[]): FieldExtraction<string> {
  const org = findOrgLike(jsonLd);
  if (org?.name && typeof org.name === 'string' && org.name.trim()) {
    return { value: org.name.trim(), source: 'json_ld', confidence: 95 };
  }

  const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch?.[1]?.trim()) {
    return { value: ogMatch[1].trim(), source: 'meta', confidence: 80 };
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]?.trim()) {
    const cleaned = titleMatch[1].split(/[-|–]/)[0].trim();
    if (cleaned) return { value: cleaned, source: 'title', confidence: 55 };
  }

  return { ...EMPTY_EXTRACTION };
}

export function extractEmail(html: string, jsonLd: Record<string, any>[]): FieldExtraction<string> {
  const org = findOrgLike(jsonLd);
  if (org?.email && typeof org.email === 'string' && org.email.includes('@')) {
    return { value: org.email.trim().toLowerCase(), source: 'json_ld', confidence: 90 };
  }

  const mailtoMatch = html.match(/href=["']mailto:([^"'?]+)["']/i);
  if (mailtoMatch?.[1]) {
    return { value: mailtoMatch[1].trim().toLowerCase(), source: 'mailto', confidence: 95 };
  }

  const textMatches = html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  for (const m of textMatches) {
    if (!/\.(png|jpe?g|gif|svg|webp)$/i.test(m[0])) {
      return { value: m[0].toLowerCase(), source: 'text', confidence: 55 };
    }
  }

  return { ...EMPTY_EXTRACTION };
}

export function extractPhone(html: string, jsonLd: Record<string, any>[]): FieldExtraction<string> {
  const org = findOrgLike(jsonLd);
  if (org?.telephone && typeof org.telephone === 'string' && org.telephone.trim()) {
    return { value: org.telephone.trim(), source: 'json_ld', confidence: 90 };
  }

  const telMatch = html.match(/href=["']tel:([^"']+)["']/i);
  if (telMatch?.[1]?.trim()) {
    return { value: telMatch[1].trim(), source: 'tel', confidence: 95 };
  }

  const textMatch = html.match(/(\+?\d[\d\s().-]{8,15}\d)/);
  if (textMatch?.[1]) {
    return { value: textMatch[1].trim(), source: 'text', confidence: 50 };
  }

  return { ...EMPTY_EXTRACTION };
}

export interface ExtractedAddress {
  address: string;
  city?: string;
  state?: string;
  country?: string;
}

export function extractAddress(html: string, jsonLd: Record<string, any>[]): FieldExtraction<ExtractedAddress> {
  const org = findOrgLike(jsonLd);
  const addr = org?.address;

  if (addr && typeof addr === 'object') {
    const parts = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode, addr.addressCountry]
      .filter((v) => typeof v === 'string' && v.trim())
      .join(', ');
    if (parts) {
      return {
        value: {
          address: parts,
          city: typeof addr.addressLocality === 'string' ? addr.addressLocality : undefined,
          state: typeof addr.addressRegion === 'string' ? addr.addressRegion : undefined,
          country: typeof addr.addressCountry === 'string' ? addr.addressCountry : undefined,
        },
        source: 'json_ld',
        confidence: 90,
      };
    }
  }
  if (typeof addr === 'string' && addr.trim()) {
    return { value: { address: addr.trim() }, source: 'json_ld', confidence: 75 };
  }

  return { ...EMPTY_EXTRACTION };
}

export interface DiscoveredLink {
  url: string;
  label: string;
  priority: number;
}

// Lower priority number = fetched sooner (contact > about > products > certifications).
const LINK_KEYWORDS: { pattern: RegExp; label: string; priority: number }[] = [
  { pattern: /contact-?us|contact/i, label: 'contact', priority: 1 },
  { pattern: /about-?us|about|company/i, label: 'about', priority: 2 },
  { pattern: /product-?catalog|products?|catalogu?e/i, label: 'products', priority: 3 },
  { pattern: /manufactur|factory|certificat/i, label: 'certifications', priority: 4 },
];

/** Finds same-domain links whose path looks like a contact/about/products/certifications page. */
export function discoverInternalLinks(html: string, baseUrl: string): DiscoveredLink[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const results: DiscoveredLink[] = [];
  const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const href = match[1];
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.hostname !== base.hostname) continue;

    const key = resolved.toString();
    if (seen.has(key)) continue;

    for (const kw of LINK_KEYWORDS) {
      if (kw.pattern.test(resolved.pathname)) {
        seen.add(key);
        results.push({ url: key, label: kw.label, priority: kw.priority });
        break;
      }
    }
  }

  return results.sort((a, b) => a.priority - b.priority);
}

/** Strips scripts/styles/tags down to plain text for feeding cleaned content to the AI extractor. */
export function stripHtmlToText(html: string, maxLength = 4000): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = withoutNoise
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

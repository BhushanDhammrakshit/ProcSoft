/**
 * Deterministic (non-AI) extraction of structured supplier signals from raw HTML: JSON-LD/schema.org
 * data first, then meta/title/visible-text fallbacks. Each extracted field reports its source and a
 * confidence score (0-100) so the enrichment pipeline can prefer structured data over AI-guessed data.
 */

import { isValidGstin } from '../../common/utils/normalization.util';

export interface FieldExtraction<T> {
  value: T | null;
  source: string | null;
  confidence: number;
}

const EMPTY_EXTRACTION: FieldExtraction<never> = { value: null, source: null, confidence: 0 };

// How much cleaned page text to scan for email/phone/address/GSTIN fallbacks - large enough to
// reach footer content on long pages (e.g. blog/buying-guide articles) without scanning forever.
const TEXT_SCAN_LENGTH = 100_000;

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

  // Scan visible text only (not raw HTML) - scripts/styles/analytics tags often contain
  // unrelated placeholder emails that would otherwise be matched before the real one.
  const text = stripHtmlToText(html, TEXT_SCAN_LENGTH);

  // A "Email: foo@bar.com" labeled line is a stronger signal than a bare match found anywhere
  // else on the page (e.g. inside a copyright line or an unrelated mention). Tolerates a
  // qualifier in between the label and colon, e.g. "Email (For Enquiry): foo@bar.com".
  const labeledMatch = text.match(
    /\b(?:email|e-mail|contact(?:\s+us)?|support)\s*(?:\([^)]*\))?\s*:?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  );
  if (labeledMatch?.[1] && !/\.(png|jpe?g|gif|svg|webp)$/i.test(labeledMatch[1])) {
    return { value: labeledMatch[1].toLowerCase(), source: 'text_labeled', confidence: 80 };
  }

  for (const m of text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) {
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

  // Scan visible text only, same rationale as extractEmail above.
  const text = stripHtmlToText(html, TEXT_SCAN_LENGTH);

  // Covers labels like "Toll-Free Number (Mon-Sat 10am-7pm): ..." (qualifier in parentheses
  // between the label and colon, same as the email label pattern) and "(888)511-3375"-style
  // numbers that start with a bracket rather than a digit.
  const labeledMatch = text.match(
    /\b(?:phone|call(?:\s+us)?|tel(?:ephone)?|mobile|whatsapp|toll[\s-]?free(?:\s+number)?|helpline|customer\s*care)\s*(?:\([^)]*\))?\s*:?\s*(\+?\(?\d[\d\s().-]{6,17}\d)/i,
  );
  if (labeledMatch?.[1]) {
    return { value: labeledMatch[1].trim(), source: 'text_labeled', confidence: 80 };
  }

  const textMatch = text.match(/(\+?\(?\d[\d\s().-]{8,15}\d)/);
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

// US-style "City, ST ZIP" tail, used to split a labeled address line into city/state when possible.
const CITY_STATE_ZIP_REGEX = /,\s*([A-Za-z .]+),?\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/;

// Signals the start of a street-address line even without an "Address:" label (Indian and Western
// conventions both covered: shop/floor numbers, road/street names, society/colony/sector names).
const ADDRESS_KEYWORD_REGEX =
  /\b(?:shop\s*no\.?\s*\d*|floor|road|street|st\.|avenue|ave\.|nagar|sector|society|soc\.|colony|building|bldg\.?|opp\.?|near|lane|marg|chowk|complex|hsg|suite|ste\.?)\b/i;
// 5-digit US ZIP or 6-digit Indian PIN code, optionally with a US ZIP+4 suffix.
const PIN_CODE_REGEX = /\b\d{5,6}(?:-\d{4})?\b/;
// Lines that clearly start a new, unrelated contact field - stops the address merge from bleeding
// into the phone/email/hours line that typically follows an address in a footer block.
const NON_ADDRESS_LINE_REGEX =
  /^(?:phone|call|email|e-mail|tel|toll|helpline|customer\s*care|live\s*chat|mon|tue|wed|thu|fri|sat|sun|hours?)\b/i;

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

  // Plain-text fallback: a labeled "Address: ..." line in the page footer/contact section, common
  // on sites with no structured data at all. Uses the line-preserving text so the match can't run
  // on past a following Phone/Email line once whitespace/newlines are collapsed.
  const lines = stripHtmlToLines(html, TEXT_SCAN_LENGTH);
  const joinedLines = lines.join(' \n ');
  const labeledMatch = joinedLines.match(/\baddress\s*:?\s*([^\n]{10,150})/i);
  if (labeledMatch?.[1]?.trim()) {
    const line = labeledMatch[1].trim().replace(/[.,;]+$/, '');
    const cityStateZip = line.match(CITY_STATE_ZIP_REGEX);
    return {
      value: {
        address: line,
        city: cityStateZip?.[1]?.trim(),
        state: cityStateZip?.[2]?.trim(),
      },
      source: 'text_labeled',
      confidence: 60,
    };
  }

  // Unlabeled fallback: many supplier footers list a full postal address (street/floor/locality +
  // PIN/ZIP) with no "Address:" label at all, e.g. "Shop No.4 First Floor, Laxmi Niwas HSG SOC.,
  // 90 Feet Road, Opp Tilak Nagar Gate, Sakinaka, Mumbai - 400072". Find the first line that looks
  // like the start of a street address and merge it with the following lines up to the PIN/ZIP code
  // (or a hard cap of 5 lines / the next unrelated contact line), so the whole address is captured.
  const keywordLineIndex = lines.findIndex(
    (line) => ADDRESS_KEYWORD_REGEX.test(line) && !line.includes('@') && !/^https?:\/\//i.test(line),
  );
  if (keywordLineIndex !== -1) {
    const collected: string[] = [];
    for (let i = keywordLineIndex; i < Math.min(lines.length, keywordLineIndex + 5); i++) {
      const line = lines[i];
      if (i > keywordLineIndex && NON_ADDRESS_LINE_REGEX.test(line)) break;
      collected.push(line);
      if (PIN_CODE_REGEX.test(line)) break;
    }
    const merged = collected.join(', ').replace(/,\s*,/g, ',').trim();
    if (merged.length >= 10) {
      const cityStateZip = merged.match(CITY_STATE_ZIP_REGEX);
      return {
        value: {
          address: merged,
          city: cityStateZip?.[1]?.trim(),
          state: cityStateZip?.[2]?.trim(),
        },
        source: 'text_pattern',
        confidence: 50,
      };
    }
  }

  return { ...EMPTY_EXTRACTION };
}

// Any phrasing a supplier site might use for its GST number, not just the literal word "GSTIN".
const GSTIN_KEYWORD_REGEX =
  /(?:goods and services tax identification number|gst identification number|gst registration number|gst registration no\.?|gst no\.?|gst number|gstin no\.?|gstin number|gstin|gst id|tax[\s-]?id|gst)/gi;
// A GSTIN candidate: 15 alphanumeric chars, matched loosely here (case-insensitive) and validated
// strictly via isValidGstin() before being accepted.
const GSTIN_CANDIDATE_REGEX = /\b[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]\b/g;

function findValidGstinIn(text: string): string | null {
  for (const m of text.matchAll(GSTIN_CANDIDATE_REGEX)) {
    const normalized = m[0].toUpperCase();
    if (isValidGstin(normalized)) return normalized;
  }
  return null;
}

/**
 * Looks for a GSTIN in JSON-LD first (schema.org has no dedicated GSTIN field, so `taxID`/`vatID`/
 * `identifier` are checked opportunistically), then near GST-related keywords in the page text
 * (keyword proximity avoids false positives from unrelated 15-character strings), then falls back
 * to a pattern-only scan of the whole page as a last resort.
 */
export function extractGstin(html: string, jsonLd: Record<string, any>[]): FieldExtraction<string> {
  const org = findOrgLike(jsonLd);
  for (const field of [org?.taxID, org?.vatID, org?.identifier]) {
    if (typeof field === 'string' && isValidGstin(field)) {
      return { value: field.toUpperCase().trim(), source: 'json_ld', confidence: 90 };
    }
  }

  const text = stripHtmlToText(html, TEXT_SCAN_LENGTH);

  for (const match of text.matchAll(GSTIN_KEYWORD_REGEX)) {
    const windowStart = match.index ?? 0;
    const window = text.slice(windowStart, windowStart + (match[0].length + 60));
    const found = findValidGstinIn(window);
    if (found) return { value: found, source: 'text_keyword', confidence: 85 };
  }

  const patternOnly = findValidGstinIn(text);
  if (patternOnly) return { value: patternOnly, source: 'text_pattern', confidence: 55 };

  return { ...EMPTY_EXTRACTION };
}

export interface DiscoveredLink {
  url: string;
  label: string;
  priority: number;
}

// Lower priority number = fetched sooner (contact > about > products > certifications > legal/gst).
const LINK_KEYWORDS: { pattern: RegExp; label: string; priority: number }[] = [
  { pattern: /contact-?us|contact/i, label: 'contact', priority: 1 },
  { pattern: /about-?us|about|company/i, label: 'about', priority: 2 },
  { pattern: /product-?catalog|products?|catalogu?e/i, label: 'products', priority: 3 },
  { pattern: /manufactur|factory|certificat/i, label: 'certifications', priority: 4 },
  // Lowest priority: only fetched if a slot remains within MAX_PAGES_PER_SUPPLIER - GSTIN often
  // only appears on these legal/registration pages, not the homepage/contact/about pages above.
  { pattern: /terms|privacy|legal|\bgst\b|tax|registration/i, label: 'legal', priority: 5 },
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
  const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const href = match[1];
    const anchorText = match[2].replace(/<[^>]+>/g, ' ');
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

    // Anchor text is checked alongside the URL path - some GST/legal links keep a generic path
    // (e.g. "/page3") but reveal their purpose only in the link text.
    for (const kw of LINK_KEYWORDS) {
      if (kw.pattern.test(resolved.pathname) || kw.pattern.test(anchorText)) {
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

/**
 * Same cleanup as stripHtmlToText but preserves line boundaries (block-level tags become newlines
 * instead of being collapsed to spaces), used for multi-line address extraction where knowing
 * where one contact field ends and the next begins matters.
 */
export function stripHtmlToLines(html: string, maxLength = TEXT_SCAN_LENGTH): string[] {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withBreaks = withoutNoise.replace(/<\/?(?:br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .slice(0, maxLength);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

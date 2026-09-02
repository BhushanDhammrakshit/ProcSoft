/** Normalization/matching helpers shared by supplier discovery, dedupe and semantic search. */

const COMPANY_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt\\.? ltd\\.?',
  'limited',
  'ltd\\.?',
  'llp',
  'inc\\.?',
  'llc',
  'corporation',
  'corp\\.?',
  'co\\.?',
  'company',
];

/** Strips common legal-entity suffix variants (Pvt Ltd / Private Limited / Ltd / Inc ...) for name matching. */
export function normalizeCompanyName(name: string): string {
  let n = name.toLowerCase().trim().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  for (const suf of COMPANY_SUFFIXES) {
    n = n.replace(new RegExp(`\\b${suf}\\b\\.?$`, 'i'), '').trim();
  }
  return n.replace(/\s+/g, ' ').trim();
}

/** Strips formatting and country code, keeping the last 10 digits (India-style local number). */
export function normalizePhone(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Extracts a lowercased, "www."-stripped hostname from a website URL for domain-based dedupe. */
export function extractDomain(website?: string): string | undefined {
  if (!website) return undefined;
  try {
    const url = website.trim().startsWith('http') ? website.trim() : `https://${website.trim()}`;
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

/** Lowercase, hyphenated slug - used to synthesize a unique placeholder email when a source has no contact email. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function isValidGstin(gstin?: string): boolean {
  return !!gstin && GSTIN_REGEX.test(gstin.toUpperCase().trim());
}

/** Levenshtein-distance-based similarity ratio in [0, 1] (1 = identical). */
export function stringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const dp: number[][] = Array.from({ length: s1.length + 1 }, () => new Array(s2.length + 1).fill(0));
  for (let i = 0; i <= s1.length; i++) dp[i][0] = i;
  for (let j = 0; j <= s2.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      dp[i][j] =
        s1[i - 1] === s2[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const dist = dp[s1.length][s2.length];
  return 1 - dist / Math.max(s1.length, s2.length);
}

/** Cosine similarity between two equal-length embedding vectors, in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

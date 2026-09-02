/** Classifies a discovered supplier-lead URL so the enrichment pipeline knows how (or whether) to fetch it. */

export type UrlClassification =
  | 'official_website'
  | 'marketplace'
  | 'business_directory'
  | 'government_source'
  | 'social_media'
  | 'irrelevant';

// Third-party marketplaces - leads only, never scraped directly (no authorized/licensed connector here).
const MARKETPLACE_HOSTS = [
  'indiamart.com',
  'tradeindia.com',
  'alibaba.com',
  'made-in-china.com',
  'exportersindia.com',
  'amazon.',
  'flipkart.com',
  'etsy.com',
];

const DIRECTORY_HOSTS = ['justdial.com', 'sulekha.com', 'yellowpages.', 'crunchbase.com', 'clutch.co', 'glassdoor.'];

const GOVERNMENT_HOSTS = ['msme.gov.in', 'udyamregistration.gov.in', 'mca.gov.in', '.gov.in', '.nic.in'];

const SOCIAL_HOSTS = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'pinterest.com',
];

// News/blog/document/job pages - not a supplier profile, regardless of host.
const IRRELEVANT_PATTERNS = [
  /\/news\//i,
  /\/blog(\/|$)/i,
  /\.pdf(\?|$)/i,
  /\/jobs?(\/|$)/i,
  /\/careers?(\/|$)/i,
  /wikipedia\.org/i,
  /medium\.com/i,
  /\/press-release/i,
];

function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
}

export function classifyUrl(url?: string | null): UrlClassification {
  if (!url || !url.trim()) return 'irrelevant';
  const trimmed = url.trim();

  if (IRRELEVANT_PATTERNS.some((p) => p.test(trimmed))) return 'irrelevant';

  let host: string;
  try {
    host = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return 'irrelevant';
  }

  if (hostMatches(host, SOCIAL_HOSTS)) return 'social_media';
  if (hostMatches(host, GOVERNMENT_HOSTS)) return 'government_source';
  if (hostMatches(host, MARKETPLACE_HOSTS)) return 'marketplace';
  if (hostMatches(host, DIRECTORY_HOSTS)) return 'business_directory';

  return 'official_website';
}

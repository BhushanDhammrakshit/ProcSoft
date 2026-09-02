import {
  discoverInternalLinks,
  extractAddress,
  extractCompanyName,
  extractEmail,
  extractJsonLd,
  extractPhone,
  stripHtmlToText,
} from './html-extraction.util';

const JSON_LD_HTML = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "ABC Packaging Pvt Ltd",
  "email": "sales@abcpackaging.com",
  "telephone": "+91-9876543210",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Plot 12, MIDC",
    "addressLocality": "Pune",
    "addressRegion": "Maharashtra",
    "addressCountry": "India"
  }
}
</script>
</head><body>Contact us</body></html>
`;

const NO_JSON_LD_HTML = `
<html><head><title>ABC Packaging - Corrugated Box Manufacturer</title>
<meta property="og:site_name" content="ABC Packaging" />
</head>
<body>
  <p>Reach us at <a href="mailto:info@abcpackaging.com">info@abcpackaging.com</a> or call
  <a href="tel:+919876543210">+91 98765 43210</a>.</p>
  <a href="/contact-us">Contact Us</a>
  <a href="/about-us">About Us</a>
  <a href="/products">Our Products</a>
  <a href="https://linkedin.com/company/abc">LinkedIn</a>
  <a href="/careers">Careers</a>
</body></html>
`;

const EMPTY_HTML = '<html><head><title></title></head><body>No contact information here.</body></html>';

describe('extractJsonLd', () => {
  it('parses a valid Organization JSON-LD block', () => {
    const blocks = extractJsonLd(JSON_LD_HTML);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].name).toBe('ABC Packaging Pvt Ltd');
  });

  it('returns an empty array for malformed JSON-LD instead of throwing', () => {
    const html = '<script type="application/ld+json">{ not valid json </script>';
    expect(extractJsonLd(html)).toEqual([]);
  });

  it('returns an empty array when there is no JSON-LD at all', () => {
    expect(extractJsonLd(EMPTY_HTML)).toEqual([]);
  });
});

describe('extractCompanyName', () => {
  it('prefers JSON-LD organization name', () => {
    const jsonLd = extractJsonLd(JSON_LD_HTML);
    const result = extractCompanyName(JSON_LD_HTML, jsonLd);
    expect(result).toEqual({ value: 'ABC Packaging Pvt Ltd', source: 'json_ld', confidence: 95 });
  });

  it('falls back to og:site_name when there is no JSON-LD', () => {
    const result = extractCompanyName(NO_JSON_LD_HTML, []);
    expect(result.value).toBe('ABC Packaging');
    expect(result.source).toBe('meta');
  });

  it('falls back to the page title when nothing else is available', () => {
    const html = '<html><head><title>Some Co - Home</title></head><body></body></html>';
    const result = extractCompanyName(html, []);
    expect(result.value).toBe('Some Co');
    expect(result.source).toBe('title');
  });

  it('returns null when no name can be found', () => {
    expect(extractCompanyName(EMPTY_HTML, [])).toEqual({ value: null, source: null, confidence: 0 });
  });
});

describe('extractEmail', () => {
  it('prefers JSON-LD email', () => {
    const jsonLd = extractJsonLd(JSON_LD_HTML);
    expect(extractEmail(JSON_LD_HTML, jsonLd)).toEqual({
      value: 'sales@abcpackaging.com',
      source: 'json_ld',
      confidence: 90,
    });
  });

  it('extracts a mailto link when there is no JSON-LD', () => {
    const result = extractEmail(NO_JSON_LD_HTML, []);
    expect(result.value).toBe('info@abcpackaging.com');
    expect(result.source).toBe('mailto');
  });

  it('falls back to plain visible text and ignores image-like matches', () => {
    const html = '<body>logo@2x.png and reach sales@example.com for more info</body>';
    const result = extractEmail(html, []);
    expect(result.value).toBe('sales@example.com');
    expect(result.source).toBe('text');
  });

  it('returns null when no email is present anywhere', () => {
    expect(extractEmail(EMPTY_HTML, [])).toEqual({ value: null, source: null, confidence: 0 });
  });
});

describe('extractPhone', () => {
  it('prefers JSON-LD telephone', () => {
    const jsonLd = extractJsonLd(JSON_LD_HTML);
    expect(extractPhone(JSON_LD_HTML, jsonLd)).toEqual({ value: '+91-9876543210', source: 'json_ld', confidence: 90 });
  });

  it('extracts a tel: link when there is no JSON-LD', () => {
    const result = extractPhone(NO_JSON_LD_HTML, []);
    expect(result.value).toBe('+919876543210');
    expect(result.source).toBe('tel');
  });

  it('returns null when no phone is present anywhere', () => {
    expect(extractPhone(EMPTY_HTML, [])).toEqual({ value: null, source: null, confidence: 0 });
  });
});

describe('extractAddress', () => {
  it('builds a joined address string from JSON-LD PostalAddress', () => {
    const jsonLd = extractJsonLd(JSON_LD_HTML);
    const result = extractAddress(JSON_LD_HTML, jsonLd);
    expect(result.source).toBe('json_ld');
    expect(result.value?.address).toContain('Pune');
    expect(result.value?.city).toBe('Pune');
    expect(result.value?.state).toBe('Maharashtra');
  });

  it('returns null when there is no address data', () => {
    expect(extractAddress(EMPTY_HTML, [])).toEqual({ value: null, source: null, confidence: 0 });
  });
});

describe('discoverInternalLinks', () => {
  it('finds and prioritizes contact/about/products pages over unrelated links', () => {
    const links = discoverInternalLinks(NO_JSON_LD_HTML, 'https://abcpackaging.com');
    const labels = links.map((l) => l.label);
    expect(labels).toEqual(['contact', 'about', 'products']);
  });

  it('excludes cross-domain links (e.g. social media) and mailto/tel hrefs', () => {
    const links = discoverInternalLinks(NO_JSON_LD_HTML, 'https://abcpackaging.com');
    expect(links.some((l) => l.url.includes('linkedin.com'))).toBe(false);
  });

  it('returns an empty array for an invalid base URL', () => {
    expect(discoverInternalLinks(NO_JSON_LD_HTML, 'not-a-url')).toEqual([]);
  });
});

describe('stripHtmlToText', () => {
  it('removes scripts, styles and tags, collapsing whitespace', () => {
    const html = '<html><head><style>.a{}</style><script>var x=1;</script></head><body>  Hello   World  </body></html>';
    expect(stripHtmlToText(html)).toBe('Hello World');
  });

  it('truncates to the requested max length', () => {
    const html = `<p>${'a'.repeat(100)}</p>`;
    expect(stripHtmlToText(html, 10)).toHaveLength(10);
  });
});

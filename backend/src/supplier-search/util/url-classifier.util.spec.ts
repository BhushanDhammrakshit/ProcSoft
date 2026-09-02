import { classifyUrl } from './url-classifier.util';

describe('classifyUrl', () => {
  it('classifies a plain company domain as official_website', () => {
    expect(classifyUrl('https://abcpackaging.com')).toBe('official_website');
    expect(classifyUrl('abcpackaging.com')).toBe('official_website');
  });

  it('classifies known marketplace domains as marketplace', () => {
    expect(classifyUrl('https://www.indiamart.com/proddetail/corrugated-boxes-12345.html')).toBe('marketplace');
    expect(classifyUrl('https://tradeindia.com/company/abc-packaging')).toBe('marketplace');
  });

  it('classifies business directories', () => {
    expect(classifyUrl('https://www.justdial.com/Pune/ABC-Packaging')).toBe('business_directory');
  });

  it('classifies government/MSME sources', () => {
    expect(classifyUrl('https://udyamregistration.gov.in/some-profile')).toBe('government_source');
    expect(classifyUrl('https://msme.gov.in/directory/abc')).toBe('government_source');
  });

  it('classifies social media links', () => {
    expect(classifyUrl('https://www.linkedin.com/company/abc-packaging')).toBe('social_media');
    expect(classifyUrl('https://facebook.com/abcpackaging')).toBe('social_media');
  });

  it('classifies news/blog/pdf/job pages as irrelevant', () => {
    expect(classifyUrl('https://example.com/blog/top-10-packaging-tips')).toBe('irrelevant');
    expect(classifyUrl('https://example.com/news/company-wins-award')).toBe('irrelevant');
    expect(classifyUrl('https://example.com/careers/openings')).toBe('irrelevant');
    expect(classifyUrl('https://example.com/brochure.pdf')).toBe('irrelevant');
  });

  it('handles null/undefined/empty/malformed URLs as irrelevant', () => {
    expect(classifyUrl(undefined)).toBe('irrelevant');
    expect(classifyUrl(null)).toBe('irrelevant');
    expect(classifyUrl('')).toBe('irrelevant');
    expect(classifyUrl('not a url at all ://')).toBe('irrelevant');
  });
});

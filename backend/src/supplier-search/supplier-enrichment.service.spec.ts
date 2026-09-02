import { SupplierEnrichmentService } from './supplier-enrichment.service';
import { AiService } from '../ai/ai.service';

function mockAiService(): jest.Mocked<Pick<AiService, 'extractSupplierProfile'>> {
  return {
    extractSupplierProfile: jest.fn().mockResolvedValue({
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
    }),
  };
}

function htmlResponse(body: string) {
  return {
    ok: true,
    headers: { get: () => 'text/html' },
    body: undefined,
    text: async () => body,
  } as unknown as Response;
}

describe('SupplierEnrichmentService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('never fetches marketplace/social leads and reports contactStatus based only on the lead data', async () => {
    const ai = mockAiService();
    const service = new SupplierEnrichmentService(ai as unknown as AiService);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { candidate, urlClassification } = await service.enrichLead({
      legalName: 'ABC Packaging',
      website: 'https://www.indiamart.com/proddetail/abc-packaging.html',
    });

    expect(urlClassification).toBe('marketplace');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(candidate.enrichmentStatus).toBe('skipped');
    expect(candidate.email).toBeNull();
    expect(candidate.contactStatus).toBe('missing');
  });

  it('never invents an email/phone - null stays null end-to-end when a lead has no contact info', async () => {
    const ai = mockAiService();
    const service = new SupplierEnrichmentService(ai as unknown as AiService);
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

    const { candidate } = await service.enrichLead({ legalName: 'Some Co', website: 'https://some-co.example' });

    expect(candidate.email).toBeNull();
    expect(candidate.phone).toBeNull();
    expect(candidate.contactStatus).toBe('missing');
    expect(candidate.enrichmentStatus).toBe('failed');
  });

  it('extracts structured contact data from the fetched homepage and marks contactStatus available', async () => {
    const ai = mockAiService();
    const service = new SupplierEnrichmentService(ai as unknown as AiService);
    const homepageHtml = `
      <html><head>
      <script type="application/ld+json">
      {"@type":"Organization","name":"ABC Packaging Pvt Ltd","email":"sales@abcpackaging.com","telephone":"+911234567890"}
      </script>
      </head><body>No internal links here.</body></html>
    `;
    global.fetch = jest.fn().mockResolvedValue(htmlResponse(homepageHtml)) as unknown as typeof fetch;

    const { candidate } = await service.enrichLead({ legalName: 'ABC Packaging', website: 'https://abcpackaging.com' });

    expect(candidate.legalName).toBe('ABC Packaging Pvt Ltd');
    expect(candidate.email).toBe('sales@abcpackaging.com');
    expect(candidate.phone).toBe('+911234567890');
    expect(candidate.contactStatus).toBe('available');
    expect(candidate.enrichmentStatus).toBe('enriched');
    expect(candidate.extractionMetadata.emailSource).toBe('json_ld');
  });
});

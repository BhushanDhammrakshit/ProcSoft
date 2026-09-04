import { Injectable, Logger } from '@nestjs/common';
import { RawSupplierResult } from '../dto/search-requirement.dto';

const FETCH_TIMEOUT_MS = Number(process.env.GOOGLE_MAPS_TIMEOUT_MS ?? 8000);
const MAX_RESULTS = Number(process.env.GOOGLE_MAPS_MAX_RESULTS ?? 10);
// Bias-only radius (meters) applied when the requester's own coordinates are used because the
// query text carries no explicit location - Text Search still returns matches outside this radius,
// it's a ranking preference, not a hard filter.
const LOCATION_BIAS_RADIUS_M = Number(process.env.GOOGLE_MAPS_BIAS_RADIUS_M ?? 50000);
// Only request the fields SupplierCandidate actually uses - Places API (New) bills by field tier,
// so a narrower field mask costs less per call.
const FIELD_MASK = 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.id';

export interface GoogleMapsCoords {
  latitude: number;
  longitude: number;
}

/**
 * Real business-listing search via the Places API (New) Text Search endpoint
 * (https://places.googleapis.com/v1/places:searchText). Unlike a generic web-search SERP, this
 * returns structured business data directly (phone/address/website) - no scraping needed for those
 * fields, only the website itself still needs to be visited for products/certifications/email
 * (done by SupplierEnrichmentService). Requires a Google Cloud project with the Places API (New)
 * enabled and billing configured (see https://mapsplatform.google.com - a $200/month recurring free
 * credit applies). Disabled (returns []) when GOOGLE_MAPS_API_KEY is unset.
 *
 * Location precedence: if the caller supplies explicit `location` text (e.g. extracted from the
 * user's own prompt), it's appended to the query and takes priority over `coords` - `coords`
 * (the requester's own browser geolocation) is only used as a soft ranking bias when no explicit
 * location was mentioned.
 */
@Injectable()
export class GoogleMapsAdapter {
  private readonly logger = new Logger(GoogleMapsAdapter.name);
  private readonly apiKey = process.env.GOOGLE_MAPS_API_KEY;

  get enabled(): boolean {
    return !!this.apiKey;
  }

  async search(query: string, location?: string, coords?: GoogleMapsCoords): Promise<RawSupplierResult[]> {
    if (!this.enabled) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const textQuery = location ? `${query} in ${location}` : query;
      const body: Record<string, unknown> = { textQuery, pageSize: MAX_RESULTS };
      // Only bias by the requester's coordinates when the query has no explicit location of its own.
      if (!location && coords) {
        body.locationBias = {
          circle: {
            center: { latitude: coords.latitude, longitude: coords.longitude },
            radius: LOCATION_BIAS_RADIUS_M,
          },
        };
      }

      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey!,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Places API responded with ${res.status}`);

      const data = (await res.json()) as {
        places?: {
          displayName?: { text?: string };
          formattedAddress?: string;
          nationalPhoneNumber?: string;
          websiteUri?: string;
        }[];
      };

      return (data.places ?? [])
        .filter((p) => !!p.displayName?.text)
        .map(
          (p): RawSupplierResult => ({
            legalName: p.displayName!.text!,
            phone: p.nationalPhoneNumber,
            website: p.websiteUri,
            city: extractCityFromAddress(p.formattedAddress),
            sourceTier: 4,
          }),
        );
    } catch (err) {
      this.logger.error(`Places API search failed for "${query}"`, err as Error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Best-effort city guess from a Places `formattedAddress` string (no structured components requested). */
function extractCityFromAddress(formattedAddress?: string): string | undefined {
  if (!formattedAddress) return undefined;
  const parts = formattedAddress.split(',').map((p) => p.trim());
  // Typical shape: "Street, City, State PIN, Country" - second segment is usually the city.
  return parts.length >= 2 ? parts[1] : undefined;
}

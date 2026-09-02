/** Explicit, individually-scored capability-matching table for ranking suppliers against a requirement. */

export interface CapabilityBreakdown {
  productMatch: number;
  quantityMatch: number;
  locationMatch: number;
  deliveryAbility: number;
  priceCompatibility: number;
  verificationScore: number;
  pastPerformance: number;
  total: number; // 0-100
}

export interface ScorableSupplier {
  legalName: string;
  city?: string;
  state?: string;
  rating?: number;
  categories?: { name: string }[];
  verificationStatus?: string;
}

export interface ScorableCriteria {
  product: string;
  quantity?: string;
  location?: string;
  budget?: string;
}

// Weights sum to 100.
const WEIGHTS = {
  productMatch: 30,
  quantityMatch: 10,
  locationMatch: 15,
  deliveryAbility: 10,
  priceCompatibility: 10,
  verificationScore: 15,
  pastPerformance: 10,
};

export function scoreCapabilityMatch(
  criteria: ScorableCriteria,
  supplier: ScorableSupplier,
): CapabilityBreakdown {
  const product = (criteria.product ?? '').toLowerCase().trim();
  const hasProductMatch =
    !!product &&
    (supplier.categories?.some(
      (c) => c.name.toLowerCase().includes(product) || product.includes(c.name.toLowerCase()),
    ) ||
      supplier.legalName.toLowerCase().includes(product));
  const productMatch = hasProductMatch ? WEIGHTS.productMatch : product ? WEIGHTS.productMatch * 0.3 : WEIGHTS.productMatch * 0.5;

  const quantityMatch = criteria.quantity ? WEIGHTS.quantityMatch * 0.7 : WEIGHTS.quantityMatch * 0.5;

  const location = (criteria.location ?? '').toLowerCase().trim();
  const hasLocationMatch =
    !!location && (supplier.city?.toLowerCase().includes(location) || supplier.state?.toLowerCase().includes(location));
  const locationMatch = location ? (hasLocationMatch ? WEIGHTS.locationMatch : WEIGHTS.locationMatch * 0.2) : WEIGHTS.locationMatch * 0.5;

  // No dedicated delivery-capacity field on supplier profiles yet; approximate via an established rating.
  const deliveryAbility = (supplier.rating ?? 0) > 0 ? WEIGHTS.deliveryAbility : WEIGHTS.deliveryAbility * 0.5;

  // No price/quote field on supplier profiles yet; treated as neutral, slightly favoring a stated budget.
  const priceCompatibility = criteria.budget ? WEIGHTS.priceCompatibility * 0.6 : WEIGHTS.priceCompatibility * 0.5;

  const verificationScore =
    supplier.verificationStatus === 'verified'
      ? WEIGHTS.verificationScore
      : supplier.verificationStatus === 'verification_pending'
        ? WEIGHTS.verificationScore * 0.8
        : supplier.verificationStatus === 'partially_verified'
          ? WEIGHTS.verificationScore * 0.6
          : WEIGHTS.verificationScore * 0.2;

  const pastPerformance = Math.min(1, (supplier.rating ?? 0) / 5) * WEIGHTS.pastPerformance;

  const total =
    productMatch + quantityMatch + locationMatch + deliveryAbility + priceCompatibility + verificationScore + pastPerformance;

  return {
    productMatch: round(productMatch),
    quantityMatch: round(quantityMatch),
    locationMatch: round(locationMatch),
    deliveryAbility: round(deliveryAbility),
    priceCompatibility: round(priceCompatibility),
    verificationScore: round(verificationScore),
    pastPerformance: round(pastPerformance),
    total: round(total),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

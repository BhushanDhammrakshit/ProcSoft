import { apiClient } from './client';

export interface Buyer {
  id: string;
  legalName: string;
  tradeName?: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  country: string;
  website?: string;
  logoUrl?: string;
  description?: string;
  procurementCategories?: string[];
  status: string;
  verificationStatus: string;
}

export interface BuyerSearchParams {
  q?: string;
  city?: string;
  state?: string;
  status?: string;
}

export async function searchBuyers(params: BuyerSearchParams) {
  const { data } = await apiClient.get<{ data: Buyer[]; total: number }>('/buyers', { params });
  return data;
}

export async function createBuyer(payload: Partial<Buyer> & { procurementCategories?: string[] }) {
  const { data } = await apiClient.post('/buyers', payload);
  return data;
}

import { apiClient } from './client';

export interface SupplierRequirement {
  product: string;
  quantity?: string;
  location?: string;
  budget?: string;
  specifications?: string;
}

export interface SupplierSuggestion {
  supplierId: string;
  legalName: string;
  score: number;
  reason: string;
}

export interface DiscoveryJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  queries?: string[];
  discoveredCount: number;
  qualifiedCount: number;
  errorMessage?: string;
}

export interface AiSupplierSearchResult {
  criteria: SupplierRequirement;
  source: 'database' | 'discovery';
  suppliers: SupplierSuggestion[];
  job: DiscoveryJob | null;
}

export async function searchSuppliersWithAi(prompt: string) {
  const { data } = await apiClient.post<AiSupplierSearchResult>('/suppliers/search/ai', { prompt });
  return data;
}

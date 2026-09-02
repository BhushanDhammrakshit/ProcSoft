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
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  website?: string;
  verificationStatus?: string;
  source?: string;
}

export interface DiscoveryJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  queries?: string[];
  targetCount: number;
  minScore: number;
  progressStage?: string;
  progressMessage?: string;
  tiersUsed?: number[];
  resultsPreview?: SupplierSuggestion[];
  finalResults?: SupplierSuggestion[];
  discoveredCount: number;
  qualifiedCount: number;
  errorMessage?: string;
}

export interface AiSupplierSearchResult {
  criteria: SupplierRequirement;
  source: 'database' | 'discovery-pending';
  suppliers: SupplierSuggestion[];
  job: DiscoveryJob | null;
}

export async function searchSuppliersWithAi(prompt: string, targetCount?: number, minScore?: number) {
  const { data } = await apiClient.post<AiSupplierSearchResult>('/suppliers/search/ai', {
    prompt,
    targetCount,
    minScore,
  });
  return data;
}

export async function getDiscoveryJob(id: string) {
  const { data } = await apiClient.get<DiscoveryJob>(`/suppliers/search/jobs/${id}`);
  return data;
}

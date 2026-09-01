import { apiClient } from './client';

export interface RfqItemInput {
  itemName: string;
  quantity: number;
  uom?: string;
  specifications?: string;
}

export interface CreateRfqPayload {
  title: string;
  description?: string;
  category?: string;
  dueDate: string;
  deliveryLocation?: string;
  paymentTerms?: string;
  items: RfqItemInput[];
  supplierIds?: string[];
}

export async function createRfq(payload: CreateRfqPayload) {
  const { data } = await apiClient.post('/rfqs', payload);
  return data;
}

export async function listRfqs() {
  const { data } = await apiClient.get('/rfqs');
  return data;
}

export async function getRfq(id: string) {
  const { data } = await apiClient.get(`/rfqs/${id}`);
  return data;
}

export async function inviteSuppliers(rfqId: string, supplierIds: string[]) {
  const { data } = await apiClient.post(`/rfqs/${rfqId}/invite`, { supplierIds });
  return data;
}

export async function suggestSuppliers(rfqId: string) {
  const { data } = await apiClient.get(`/rfqs/${rfqId}/suggest-suppliers`);
  return data;
}

export async function draftRfqFromPrompt(prompt: string) {
  const { data } = await apiClient.post('/rfqs/ai/draft', { prompt });
  return data;
}

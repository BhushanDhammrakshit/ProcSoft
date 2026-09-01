import { apiClient } from './client';

export interface PoItemInput {
  itemName: string;
  quantity: number;
  uom?: string;
  unitPrice: number;
}

export interface CreatePoPayload {
  supplierId: string;
  rfqId?: string;
  deliveryDate?: string;
  deliveryAddress?: string;
  paymentTerms?: string;
  incoterms?: string;
  termsAndConditions?: string;
  currency?: string;
  items: PoItemInput[];
}

export async function createPurchaseOrder(payload: CreatePoPayload) {
  const { data } = await apiClient.post('/purchase-orders', payload);
  return data;
}

export async function listPurchaseOrders() {
  const { data } = await apiClient.get('/purchase-orders');
  return data;
}

export async function getPurchaseOrder(id: string) {
  const { data } = await apiClient.get(`/purchase-orders/${id}`);
  return data;
}

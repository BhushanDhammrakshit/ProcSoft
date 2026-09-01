import { apiClient } from './client';

export interface Supplier {
  id: string;
  legalName: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  status: string;
  rating: number;
  categories: { id: string; name: string }[];
}

export interface SearchParams {
  q?: string;
  category?: string;
  city?: string;
  state?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export async function searchSuppliers(params: SearchParams) {
  const { data } = await apiClient.get<{ data: Supplier[]; total: number }>('/suppliers', { params });
  return data;
}

export async function createSupplier(payload: Partial<Supplier> & { categoryNames?: string[] }) {
  const { data } = await apiClient.post('/suppliers', payload);
  return data;
}

export async function importSuppliersCsv(file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await apiClient.post('/suppliers/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function listCategories() {
  const { data } = await apiClient.get('/suppliers/categories');
  return data as { id: string; name: string }[];
}

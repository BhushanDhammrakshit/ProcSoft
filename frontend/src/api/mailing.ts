import { apiClient } from './client';

export interface CreateCampaignPayload {
  subject: string;
  bodyTemplate: string;
  rfqId?: string;
  useAiPersonalization?: boolean;
  supplierIds: string[];
}

export async function createCampaign(payload: CreateCampaignPayload) {
  const { data } = await apiClient.post('/mailing/campaigns', payload);
  return data;
}

export async function listCampaigns() {
  const { data } = await apiClient.get('/mailing/campaigns');
  return data;
}

export async function sendCampaign(id: string) {
  const { data } = await apiClient.post(`/mailing/campaigns/${id}/send`);
  return data;
}

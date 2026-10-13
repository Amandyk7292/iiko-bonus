import { request } from '../../lib/api';
import type { Campaign, CampaignInput, Dashboard, Winner, Winners, Voucher } from './model';

export const loadFortune = (signal?: AbortSignal) =>
  request<Dashboard>('/fortune', { signal }, { branchScope: '' });
export const saveCampaign = (id: string, data: CampaignInput, signal?: AbortSignal) =>
  request<{ campaign: Campaign }>(
    `/fortune/campaigns${id ? `/${id}` : ''}`,
    {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(data),
      signal,
    },
    { branchScope: '' },
  );
export const loadWinners = (
  campaignId: string,
  page: number,
  status: string,
  signal?: AbortSignal,
) =>
  request<Winners>(
    `/fortune/campaigns/${campaignId}/winners?${new URLSearchParams({ page: String(page), ...(status ? { status } : {}) })}`,
    { signal },
    { branchScope: '' },
  );
export const redeemWinner = (id: string) =>
  request<{ winner: Winner }>(
    `/fortune/winners/${id}/redeem`,
    {
      method: 'POST',
      body: '{}',
    },
    { branchScope: '' },
  );
export const loadQr = (campaignId: string, branchId: string, signal?: AbortSignal) =>
  request<{ url: string }>(
    `/fortune/campaigns/${campaignId}/branches/${branchId}/qr`,
    { signal },
    { branchScope: '' },
  );
export const loadVoucher = (id: string, signal?: AbortSignal) =>
  request<{ voucher: Voucher }>(`/fortune/vouchers/${id}`, { signal }, { branchScope: '' });

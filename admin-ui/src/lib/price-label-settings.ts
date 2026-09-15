import { request } from './api';
export interface PriceLabelSettings {
  profileKey: string;
  background: string;
  includeQr: boolean;
}
export const loadPriceLabelSettings = () =>
  request<PriceLabelSettings>('/menu/price-label-settings');
export const savePriceLabelSettings = (settings: PriceLabelSettings) =>
  request<PriceLabelSettings>('/menu/price-label-settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import LocationsPage from './LocationsPage';

const api = vi.hoisted(() => ({
  getFulfillmentLocations: vi.fn(),
  getLocationCities: vi.fn(),
  updateFulfillmentLocation: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api }));
vi.mock('../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));
vi.mock('../components/BranchPosCredentialPanel', () => ({ default: () => null }));
vi.mock('../components/YandexLocationMap', () => ({
  default: ({ onPointChange }: { onPointChange: (lat: number, lon: number) => void }) => (
    <button type="button" onClick={() => onPointChange(43.7, 51.2)}>
      Move test marker
    </button>
  ),
}));
const branch = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Филиал один',
  address: 'Старый адрес',
  city: 'Актау',
  latitude: 43.65,
  longitude: 51.16,
  active: true,
  pickupEnabled: true,
  preorderEnabled: true,
  deliveryEnabled: false,
  hours: { daily: { open: '08:00', close: '21:00' } },
};
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  api.getFulfillmentLocations.mockResolvedValue({ locations: [branch] });
  api.getLocationCities.mockResolvedValue({ cities: [{ id: 'city', name: 'Актау' }] });
  api.updateFulfillmentLocation.mockReset().mockResolvedValue({ location: branch });
});

it('keeps map collapsed, preserves the typed address when moving its marker and saves both', async () => {
  const user = userEvent.setup();
  render(
    <BrowserRouter>
      <I18nProvider>
        <LocationsPage user={null} />
      </I18nProvider>
    </BrowserRouter>,
  );
  await user.click(await screen.findByRole('button', { name: 'Редактировать' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByText('Move test marker')).not.toBeInTheDocument();
  await user.clear(dialog.getByLabelText('Адрес'));
  await user.type(dialog.getByLabelText('Адрес'), 'Новый полный адрес 17/2');
  await user.clear(dialog.getByLabelText('Название филиала'));
  await user.type(dialog.getByLabelText('Название филиала'), 'Новое название');
  await user.click(dialog.getByRole('button', { name: 'Точка на карте' }));
  await user.click(dialog.getByText('Move test marker'));
  expect(dialog.getByLabelText('Адрес')).toHaveValue('Новый полный адрес 17/2');
  await user.click(dialog.getByRole('button', { name: 'Точка на карте' }));
  expect(dialog.queryByText('Move test marker')).not.toBeInTheDocument();
  await user.click(dialog.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api.updateFulfillmentLocation).toHaveBeenCalledWith(
      branch.id,
      expect.objectContaining({
        name: 'Новое название',
        address: 'Новый полный адрес 17/2',
        latitude: 43.7,
        longitude: 51.2,
      }),
    ),
  );
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import Topbar from './Topbar';

const setSoundEnabled = vi.hoisted(() => vi.fn());

vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtime: () => ({
    summary: null,
    connectionStatus: 'online',
    soundEnabled: true,
    setSoundEnabled,
  }),
}));

vi.mock('./AdminGlobalSearch', () => ({
  default: () => <button type="button">Поиск</button>,
}));

const locations = [
  {
    id: 'astana-2',
    name: 'Bulka — Улы Дала',
    address: 'Улы Дала, 67',
    city: 'Астана',
    active: true,
  },
  {
    id: 'aktau-1',
    name: 'ЖК Дукат',
    address: '17-й микрорайон, 1',
    city: 'Актау',
    active: true,
  },
  {
    id: 'astana-1',
    name: 'Bulka — Кабанбай батыра',
    address: 'Кабанбай батыра, 46а',
    city: 'Астана',
    active: true,
  },
];

function topbar(
  selectedBranchId: string,
  onBranchChange: (branchId: string) => void,
  cashierMode = false,
) {
  return (
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <Topbar
          scopeLocations={locations}
          selectedBranchId={selectedBranchId}
          onBranchChange={onBranchChange}
          cashierMode={cashierMode}
        />
      </I18nProvider>
    </BrowserRouter>
  );
}

describe('Topbar city and branch scope', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    setSoundEnabled.mockClear();
    window.history.replaceState({}, '', '/admin/operations');
  });

  it('asks for a city first and then shows only that city branches', () => {
    const onBranchChange = vi.fn();
    const view = render(topbar('', onBranchChange));

    const citySelect = screen.getByRole('combobox', {
      name: 'Город для фильтрации данных',
    });
    expect(citySelect).toHaveValue('');
    expect(screen.queryByRole('combobox', { name: /Филиал города/ })).not.toBeInTheDocument();

    fireEvent.change(citySelect, { target: { value: 'астана' } });
    const cityScope = onBranchChange.mock.calls[0]?.[0] as string;
    expect(cityScope).toContain('city:');
    expect(cityScope).toContain('astana-1,astana-2');

    view.rerender(topbar(cityScope, onBranchChange));
    const branchSelect = screen.getByRole('combobox', {
      name: 'Филиал города Астана',
    });
    const options = within(branchSelect).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Все филиалы города',
      'Bulka — Кабанбай батыра',
      'Bulka — Улы Дала',
    ]);
    expect(branchSelect).toHaveValue(cityScope);
    expect(within(branchSelect).queryByText('ЖК Дукат')).not.toBeInTheDocument();
  });

  it('returns to all branches only through the all-cities option', () => {
    const onBranchChange = vi.fn();
    render(topbar('aktau-1', onBranchChange));

    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Город для фильтрации данных',
      }),
      { target: { value: '' } },
    );

    expect(onBranchChange).toHaveBeenCalledWith('');
  });

  it('explains the icon-only notification action on hover', () => {
    render(topbar('', vi.fn()));

    expect(screen.getByRole('button', { name: 'Операционные уведомления' })).toHaveAttribute(
      'title',
      'Операционные уведомления',
    );
  });

  it('shows a cashier branch, live connection and labelled sound control without selectors', () => {
    render(topbar('aktau-1', vi.fn(), true));

    expect(screen.getByText('ЖК Дукат')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Связь с заказами: Онлайн' })).toHaveTextContent(
      'Онлайн',
    );
    const sound = screen.getByRole('button', { name: 'Звук включён' });
    expect(sound).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(sound);
    expect(setSoundEnabled).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

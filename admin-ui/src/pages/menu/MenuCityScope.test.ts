import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MenuCityScope, { branchCountLabel, groupMenuLocationsByCity } from './MenuCityScope';

describe('MenuCityScope helpers', () => {
  it('groups active branches by normalized city and sorts them', () => {
    const groups = groupMenuLocationsByCity([
      { id: '3', name: 'Дукат', address: '', city: ' Актау ', active: true },
      { id: '2', name: 'Улы Дала', address: '', city: 'Астана', active: true },
      { id: '1', name: 'Кабанбай', address: '', city: 'астана', active: true },
      { id: '4', name: 'Закрыт', address: '', city: 'Актау', active: false },
    ]);

    expect(
      groups.map((group) => [group.name, group.branches.map((branch) => branch.name)]),
    ).toEqual([
      ['Актау', ['Дукат']],
      ['Астана', ['Кабанбай', 'Улы Дала']],
    ]);
  });

  it('uses correct Russian branch count labels', () => {
    expect(branchCountLabel(1)).toBe('1 филиал');
    expect(branchCountLabel(2)).toBe('2 филиала');
    expect(branchCountLabel(5)).toBe('5 филиалов');
    expect(branchCountLabel(11)).toBe('11 филиалов');
    expect(branchCountLabel(22)).toBe('22 филиала');
  });

  it('opens the selected city through one of its accessible branches', async () => {
    window.localStorage.clear();
    const onBranchChange = vi.fn();
    render(
      createElement(MenuCityScope, {
        locations: [
          { id: 'aktau-1', name: 'Дукат', address: '', city: 'Актау', active: true },
          { id: 'astana-1', name: 'Кабанбай', address: '', city: 'Астана', active: true },
          { id: 'astana-2', name: 'Улы Дала', address: '', city: 'Астана', active: true },
        ],
        selectedBranchId: '',
        onBranchChange,
        profiles: {},
        loading: false,
        hasError: false,
        productsCount: 0,
        categoriesCount: 0,
      }),
    );

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Редактировать меню города Астана, 2 филиала',
      }),
    );
    expect(onBranchChange).toHaveBeenCalledWith('astana-1');
  });

  it('shows city-wide coverage without a branch selector', () => {
    render(
      createElement(MenuCityScope, {
        locations: [
          { id: 'astana-1', name: 'Кабанбай', address: '', city: 'Астана', active: true },
          { id: 'astana-2', name: 'Улы Дала', address: '', city: 'Астана', active: true },
        ],
        selectedBranchId: 'astana-1',
        onBranchChange: vi.fn(),
        activeProfileKey: 'astana',
        profiles: { astana: { key: 'astana', configured: true, city: 'Астана' } },
        loading: false,
        hasError: false,
        productsCount: 173,
        categoriesCount: 16,
      }),
    );

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Все филиалы города')).toBeTruthy();
    expect(screen.getAllByText('2 филиала')).toHaveLength(2);
  });
});

import { useCallback, useEffect } from 'react';
import type { AdminScopeLocation } from '../../lib/api';

interface ConfirmationOptions {
  title: string;
  body: string;
  confirmLabel?: string;
}

export function useMenuCitySelection({
  locations,
  selectedBranchId,
  setSearchParams,
  onBranchChange,
  hasOpenEditor,
  confirm,
}: {
  locations: AdminScopeLocation[];
  selectedBranchId: string;
  setSearchParams: (next: URLSearchParams, options?: { replace?: boolean }) => void;
  onBranchChange: (branchId: string) => void;
  hasOpenEditor: boolean;
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}) {
  useEffect(() => {
    const selectedLocation = locations.find((location) => location.id === selectedBranchId);
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(current);
    if (selectedLocation) {
      next.set('city', selectedLocation.city);
      next.set('branch', selectedLocation.id);
    } else {
      next.delete('city');
      next.delete('branch');
    }
    if (next.toString() !== current.toString()) setSearchParams(next, { replace: true });
  }, [locations, selectedBranchId, setSearchParams]);

  return useCallback(
    async (branchId: string) => {
      if (!branchId || branchId === selectedBranchId) return;
      if (
        hasOpenEditor &&
        !(await confirm({
          title: 'Переключить город?',
          body: 'Несохранённые изменения в открытой карточке будут потеряны.',
          confirmLabel: 'Переключить',
        }))
      ) {
        return;
      }
      onBranchChange(branchId);
    },
    [confirm, hasOpenEditor, onBranchChange, selectedBranchId],
  );
}

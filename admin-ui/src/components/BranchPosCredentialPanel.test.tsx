import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { I18nProvider } from '../lib/i18n';
import BranchPosCredentialPanel from './BranchPosCredentialPanel';
import { FeedbackProvider } from './Feedback';

const renderPanel = () =>
  render(
    <I18nProvider>
      <FeedbackProvider>
        <BranchPosCredentialPanel locationId="11111111-1111-4111-8111-111111111111" canRotate />
      </FeedbackProvider>
    </I18nProvider>,
  );

describe('branch POS credential panel', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('adminLocale', 'ru');
    vi.restoreAllMocks();
  });

  it('requires destructive confirmation and reveals a new token only once', async () => {
    vi.spyOn(api, 'getBranchPosCredential').mockResolvedValue({
      success: true,
      credential: {
        branchId: '11111111-1111-4111-8111-111111111111',
        branchName: 'ЖК Дукат',
        branchActive: true,
        configured: false,
        version: null,
        rotatedBy: null,
        rotatedAt: null,
      },
    });
    const rotate = vi.spyOn(api, 'rotateBranchPosCredential').mockResolvedValue({
      success: true,
      credential: {
        branchId: '11111111-1111-4111-8111-111111111111',
        token: 'bp1_one_time_test_token',
        version: 1,
        rotatedAt: '2026-07-29T12:00:00.000Z',
        headers: {
          branch: 'X-Bulka-Branch-Id',
          token: 'X-Bulka-POS-Token',
        },
      },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Создать ключ кассы' }));

    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Создать ключ кассы?',
    });
    expect(rotate).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Создать ключ кассы' }));

    const oneTimeDialog = await screen.findByRole('dialog', { name: 'Новый ключ кассы' });
    const configuration = within(oneTimeDialog).getByLabelText('Настройки плагина iiko');
    expect(configuration).toHaveValue(
      'IIKO_BRANCH_ID=11111111-1111-4111-8111-111111111111\n' +
        'IIKO_BRANCH_POS_TOKEN=bp1_one_time_test_token',
    );

    fireEvent.click(within(oneTimeDialog).getByRole('button', { name: 'Скопировать настройки' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'IIKO_BRANCH_ID=11111111-1111-4111-8111-111111111111\n' +
          'IIKO_BRANCH_POS_TOKEN=bp1_one_time_test_token',
      ),
    );
    const storedValues = Object.keys(localStorage).map((key) => localStorage.getItem(key));
    expect(storedValues).not.toContain('bp1_one_time_test_token');
  });

  it('labels an existing key as replacement and never receives its old secret', async () => {
    vi.spyOn(api, 'getBranchPosCredential').mockResolvedValue({
      success: true,
      credential: {
        branchId: '11111111-1111-4111-8111-111111111111',
        branchName: 'ЖК Дукат',
        branchActive: true,
        configured: true,
        version: 3,
        rotatedBy: 'admin',
        rotatedAt: '2026-07-29T12:00:00.000Z',
      },
    });

    renderPanel();

    expect(await screen.findByText('Кассовый плагин настроен')).toBeInTheDocument();
    expect(screen.getByText(/Версия ключа: 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Заменить ключ кассы' })).toBeInTheDocument();
    expect(screen.queryByText(/IIKO_BRANCH_POS_TOKEN=/)).not.toBeInTheDocument();
  });
});

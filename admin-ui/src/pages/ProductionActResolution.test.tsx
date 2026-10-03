import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import ProductionActResolution from './ProductionActResolution';
const request = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({ request }));
const act = {
  id: 'act-1',
  date: '2026-10-03',
  status: 'unknown',
  requestedDocumentNumber: 'BLK-REFERENCE',
  serverId: 'old-server',
  departmentId: 'original-branch',
  sourceStoreId: 'original-ingredients',
  targetStoreId: 'original-prepared',
  postImmediately: false,
  items: [{ productId: 'dish', productName: 'Пончик', quantity: 5, unit: 'шт' }],
};
const start = (onBusy = vi.fn(), disabled = false) =>
  render(
    <I18nProvider>
      <ProductionActResolution locationId="point" onBusy={onBusy} disabled={disabled} />
    </I18nProvider>,
  );
beforeEach(() => {
  localStorage.setItem('adminLocale', 'ru');
  request.mockReset().mockResolvedValue({ acts: [act] });
});
it('shows exact frozen dishes and requires explicit check and document number for confirmation', async () => {
  const user = userEvent.setup();
  start();
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  expect(screen.getByText('Пончик — 5 шт')).toBeVisible();
  expect(screen.getByText('old-server')).toBeVisible();
  expect(screen.getByText('original-ingredients')).toBeVisible();
  expect(screen.getByText('original-prepared')).toBeVisible();
  expect(screen.getByText('Сохранить черновиком')).toBeVisible();
  const button = screen.getByRole('button', { name: 'Подтвердить проверку' });
  expect(button).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Результат проверки'), 'created');
  await user.click(screen.getByRole('checkbox'));
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('Номер документа в iiko'), '  BLK-REFERENCE  ');
  request.mockResolvedValueOnce({ act: { ...act, status: 'created' } });
  await user.click(button);
  expect(request).toHaveBeenLastCalledWith('/locations/point/production-acts/act-1/resolve', {
    method: 'POST',
    body: JSON.stringify({ action: 'created', confirmed: true, documentNumber: 'BLK-REFERENCE' }),
  });
  await waitFor(() => expect(screen.queryByText('2026-10-03 · BLK-REFERENCE')).toBeNull());
});
it('failed absence verification preserves the act and never sends another import', async () => {
  const user = userEvent.setup();
  const onBusy = vi.fn();
  start(onBusy);
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  await user.selectOptions(screen.getByLabelText('Результат проверки'), 'not_created');
  await user.click(screen.getByRole('checkbox'));
  request.mockRejectedValueOnce(new Error('Дождитесь завершения обработки'));
  await user.click(screen.getByRole('button', { name: 'Подтвердить проверку' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Дождитесь завершения обработки');
  expect(screen.getByText('2026-10-03 · BLK-REFERENCE')).toBeInTheDocument();
  expect(request).toHaveBeenLastCalledWith('/locations/point/production-acts/act-1/resolve', {
    method: 'POST',
    body: JSON.stringify({ action: 'not_created', confirmed: true }),
  });
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});
it('sending acts cannot be manually released', async () => {
  request.mockResolvedValueOnce({ acts: [{ ...act, status: 'sending' }] });
  const user = userEvent.setup();
  start();
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  expect(screen.getByRole('status')).toHaveTextContent('Отправка ещё обрабатывается');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Подтвердить проверку' })).toBeNull();
});
it('localizes manual verification in Kazakh', async () => {
  localStorage.setItem('adminLocale', 'kk');
  const user = userEvent.setup();
  start();
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  await user.selectOptions(screen.getByLabelText('Тексеру нәтижесі'), 'created');
  expect(screen.getByLabelText('iiko құжатының нөмірі')).toBeInTheDocument();
  expect(screen.getByRole('checkbox')).toHaveAccessibleName(
    'Жіберілген серверде өңдеу аяқталды. Тағамдар мен мөлшерлері сәйкес келеді.',
  );
});
it('settings save blocks manual verification until the parent operation finishes', async () => {
  const user = userEvent.setup();
  start(vi.fn(), true);
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Обновить' })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});
it('blocks a second resolution while the first one is awaiting confirmation', async () => {
  request.mockResolvedValueOnce({
    acts: [act, { ...act, id: 'act-2', requestedDocumentNumber: 'BLK-SECOND' }],
  });
  const user = userEvent.setup();
  start();
  await user.click(await screen.findByText('2026-10-03 · BLK-REFERENCE'));
  await user.click(screen.getByText('2026-10-03 · BLK-SECOND'));
  const details = screen.getByText('2026-10-03 · BLK-REFERENCE').closest('details')!;
  await user.selectOptions(within(details).getByRole('combobox'), 'not_created');
  await user.click(within(details).getByRole('checkbox'));
  let done!: (value: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  await user.click(within(details).getByRole('button', { name: 'Подтвердить проверку' }));
  expect(
    screen.getAllByRole('combobox').every((element) => (element as HTMLSelectElement).disabled),
  ).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  done({ act: { ...act, status: 'failed' } });
  await waitFor(() => expect(screen.getByText('2026-10-03 · BLK-SECOND')).toBeInTheDocument());
});

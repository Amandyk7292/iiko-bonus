import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustomProductEditor, IikoProductEditor } from './ProductEditorForms';
import { useMenuPageController } from './use-menu-page-controller';

const mocks = vi.hoisted(() => ({
  getAdminMenu: vi.fn(),
  setProductOverride: vi.fn(),
  request: vi.fn(),
  upsertCustomProduct: vi.fn(),
  t: (key: string) => key,
  toast: vi.fn(),
  confirm: vi.fn(),
  setParams: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api: mocks, request: mocks.request }));
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('../../components/Feedback', () => ({ useFeedback: () => mocks }));
vi.mock('../../components/MenuPhotoUploads', () => ({
  useMenuPhotoUploads: () => ({ jobs: [], enqueue: vi.fn() }),
}));
vi.mock('../../lib/admin-realtime', () => ({ useAdminRealtimeEvents: vi.fn() }));
vi.mock('../../lib/router', () => ({
  useSearchParams: () => [new URLSearchParams(), mocks.setParams],
  useNavigate: () => vi.fn(),
  useNavigationBlocker: vi.fn(),
}));

const product = { id: 'donuts', name: 'Мини пончики', price: 800, description: 'Состав: мука' };
function Editor() {
  const controller = useMenuPageController({
    scopeLocations: [],
    selectedBranchId: 'aktau',
    onBranchChange: vi.fn(),
  });
  return (
    <>
      <button onClick={() => controller.openEditModal(product)}>Открыть товар</button>
      <button onClick={() => controller.setModalOpen(true)}>Новое блюдо</button>
      {controller.editModalOpen && <IikoProductEditor controller={controller} />}
      {controller.modalOpen && <CustomProductEditor controller={controller} />}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminMenu.mockResolvedValue({
    rawMenu: { products: [product], groups: [] },
    overrides: { products: [] },
  });
  mocks.setProductOverride.mockResolvedValue({ success: true });
  mocks.upsertCustomProduct.mockResolvedValue({ success: true });
  mocks.request.mockImplementation(async (_path, options) =>
    options?.method === 'PUT'
      ? { success: true }
      : {
          badges: [
            { id: 'hit', label: 'Хит', background: '#782b0e', foreground: '#ffffff' },
            {
              id: 'heart',
              label: 'Менің таңдауым (сердце)',
              imageUrl: '/heart.png',
              background: '#782b0e',
              foreground: '#ffffff',
            },
          ],
          selected: ['hit'],
          stickerId: null,
        },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

async function openEditor() {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole('button', { name: 'Открыть товар' }));
  return user;
}

it('keeps both translations, facts and sticker drafts across tabs and saves them with one action', async () => {
  const user = await openEditor();
  expect(screen.queryByText('Яндекс Переводчик')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Сохранить оформление товара' }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Название (RU)'));
  await user.type(screen.getByLabelText('Название (RU)'), 'Пончики в стакане');
  await user.click(screen.getByRole('button', { name: 'Қазақша' }));
  await user.type(screen.getByLabelText('Название (KK)'), 'Стақандағы пончиктер');
  await user.click(screen.getByRole('tab', { name: 'Сведения' }));
  await user.click(screen.getByText('Вес и пищевая ценность'));
  await user.type(screen.getByLabelText('Вес, г'), '250');
  await user.click(screen.getByRole('tab', { name: 'Оформление' }));
  await user.click(await screen.findByRole('button', { name: 'Менің таңдауым (сердце)' }));
  await user.click(screen.getByRole('tab', { name: 'Основное' }));
  expect(screen.getByLabelText('Название (KK)')).toHaveValue('Стақандағы пончиктер');
  await user.click(screen.getByRole('button', { name: 'Русский' }));
  expect(screen.getByLabelText('Название (RU)')).toHaveValue('Пончики в стакане');
  await user.click(screen.getByRole('tab', { name: 'Оформление' }));
  expect(screen.getByRole('button', { name: 'Менің таңдауым (сердце)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.request).toHaveBeenCalledWith(
    '/menu/badges/assignment',
    expect.objectContaining({
      body: JSON.stringify({ productId: 'donuts', badgeIds: ['hit'], stickerId: 'heart' }),
    }),
  );
  expect(mocks.setProductOverride).toHaveBeenCalledWith(
    'donuts',
    expect.objectContaining({
      custom_name: 'Пончики в стакане',
      name_translations: expect.objectContaining({ kk: 'Стақандағы пончиктер' }),
      weight_grams: 250,
    }),
  );
});

it('does not fetch or overwrite appearance when only changing the price', async () => {
  const user = await openEditor();
  await user.clear(screen.getByLabelText('Цена (₸)'));
  await user.type(screen.getByLabelText('Цена (₸)'), '900');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(mocks.setProductOverride).toHaveBeenCalledWith('donuts', { custom_price: 900 }),
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it('guards appearance-only drafts on Escape and footer cancel until the user discards', async () => {
  const user = await openEditor();
  await user.click(screen.getByRole('tab', { name: 'Оформление' }));
  await user.click(await screen.findByRole('button', { name: 'Менің таңдауым (сердце)' }));
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'common.unsavedTitle' })).toBeVisible();
  await user.click(
    screen
      .getByRole('dialog', { name: 'common.unsavedTitle' })
      .querySelector('button.btn-outline')!,
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'common.unsavedTitle' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Менің таңдауым (сердце)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Отмена' }));
  await user.click(screen.getByRole('button', { name: 'inventory.discardAndContinue' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.setProductOverride).not.toHaveBeenCalled();
  expect(mocks.request.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false);
});

it('creates a custom product from the compact editor and reveals required fields before saving', async () => {
  const user = userEvent.setup();
  render(<Editor />);
  await user.click(screen.getByRole('button', { name: 'Новое блюдо' }));
  await user.click(screen.getByRole('tab', { name: 'Сведения' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.getByRole('tab', { name: 'Основное' })).toHaveAttribute('aria-selected', 'true');
  expect(mocks.upsertCustomProduct).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Название блюда *'), 'Новое комбо');
  await user.type(screen.getByLabelText('Цена (₸) *'), '1500');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.upsertCustomProduct).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Новое комбо', price: 1500 }),
  );
  expect(mocks.request).not.toHaveBeenCalled();
});

it('does not rewrite an unchanged sticker assignment after visiting appearance', async () => {
  const user = await openEditor();
  await user.click(screen.getByRole('tab', { name: 'Оформление' }));
  await screen.findByRole('button', { name: 'Хит' });
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.request.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false);
});

it('keeps the editor open on an assignment failure and permits retrying the same draft', async () => {
  const original = mocks.request.getMockImplementation()!;
  let fail = true;
  mocks.request.mockImplementation(async (path, options) => {
    if (fail && options?.method === 'PUT') throw new Error('Не удалось сохранить стикер');
    return original(path, options);
  });
  const user = await openEditor();
  await user.click(screen.getByRole('tab', { name: 'Оформление' }));
  await user.click(await screen.findByRole('button', { name: 'Менің таңдауым (сердце)' }));
  await user.click(screen.getByRole('tab', { name: 'Основное' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Не удалось сохранить стикер');
  expect(screen.getByRole('tab', { name: 'Оформление' })).toHaveAttribute('aria-selected', 'true');
  expect(mocks.setProductOverride).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalledWith('Изменения сохранены', 'success');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('reveals an invalid field on a hidden tab instead of losing the draft', async () => {
  const user = await openEditor();
  await user.click(screen.getByRole('tab', { name: 'Сведения' }));
  await user.click(screen.getByText('Вес и пищевая ценность'));
  await user.type(screen.getByLabelText('Вес, г'), '-1');
  await user.click(screen.getByRole('tab', { name: 'Основное' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.getByRole('tab', { name: 'Сведения' })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(screen.getByLabelText('Вес, г')).toHaveFocus());
  expect(screen.getByRole('alert')).toBeVisible();
  expect(mocks.setProductOverride).not.toHaveBeenCalled();
});

it('supports keyboard tab navigation and reveals missing order catalogs', async () => {
  const user = await openEditor();
  const main = screen.getByRole('tab', { name: 'Основное' });
  main.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Оформление' })).toHaveFocus();
  await user.keyboard('{Home}');
  await user.click(screen.getByText('Где продавать'));
  for (const name of ['Самовывоз', 'Доставка', 'Предзаказ'])
    await user.click(screen.getByRole('checkbox', { name }));
  await user.click(screen.getByText('Где продавать'));
  await user.click(screen.getByRole('tab', { name: 'Сведения' }));
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(screen.getByRole('tab', { name: 'Основное' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('checkbox', { name: 'Самовывоз' })).toBeVisible();
  expect(mocks.setProductOverride).not.toHaveBeenCalled();
});

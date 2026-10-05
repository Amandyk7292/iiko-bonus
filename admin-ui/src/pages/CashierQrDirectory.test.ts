import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const token = 'a'.repeat(64);
const row = (overrides = {}) => ({
  id: 'cashier-1', name: 'Алия Рублева', branchName: 'Жасыл дала', city: 'Актау', pointId: '10',
  inviteToken: token, ...overrides,
});

it('enables point selection after city, filters by ID and resets point when the city changes', async () => {
  fetchMock.mockResolvedValue(result([
    row(), row({ id: 'same-name', name: 'Другая точка', pointId: '11' }),
    row({ id: 'astana', name: 'Астана кассир', city: 'Астана', pointId: '20' }),
  ]));
  await mount();
  expect(element('point')).toBeDisabled();
  element<HTMLSelectElement>('city').value = 'Актау';
  element('city').dispatchEvent(new Event('change'));
  expect(element('point')).not.toBeDisabled();
  expect([...element<HTMLSelectElement>('point').options].map((option) => option.value)).toEqual(['', '10', '11']);
  expect([...element<HTMLSelectElement>('point').options].map((option) => option.textContent)).toEqual(['Все точки', 'Жасыл дала · № 10', 'Жасыл дала · № 11']);
  element<HTMLSelectElement>('point').value = '11';
  element('point').dispatchEvent(new Event('change'));
  expect(element('list')).toHaveTextContent('Другая точка');
  expect(element('list')).not.toHaveTextContent('Алия Рублева');
  element<HTMLSelectElement>('city').value = 'Астана';
  element('city').dispatchEvent(new Event('change'));
  expect(element('point')).toHaveValue('');
  expect([...element<HTMLSelectElement>('point').options].map((option) => option.value)).toEqual(['', '20']);
  expect(element('list')).toHaveTextContent('Астана кассир');
  element<HTMLSelectElement>('city').value = '';
  element('city').dispatchEvent(new Event('change'));
  expect(element('point')).toBeDisabled();
});

it('preserves the selected point after a background refresh removes its last cashier', async () => {
  await mount();
  element<HTMLSelectElement>('city').value = 'Актау';
  element('city').dispatchEvent(new Event('change'));
  element<HTMLSelectElement>('point').value = '10';
  element('point').dispatchEvent(new Event('change'));
  fetchMock.mockResolvedValueOnce(result([row({ id: 'other', name: 'Другой кассир', pointId: '11' })]));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(element('point')).toHaveValue('10');
  expect(element('list').children).toHaveLength(0);
  expect(element('status')).toHaveTextContent('Никого не нашли');
  expect(element<HTMLSelectElement>('point').selectedOptions[0]).toHaveTextContent('Жасыл дала');
});
const result = (items = [row()]) => ({ ok: true, json: async () => ({ success: true, items }) });
const fetchMock = vi.fn();
let removeListeners = () => {};
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};
async function mount() {
  const readPage = (file: string) => readFileSync(resolve(process.cwd(), '../public/cashier-qr', file), 'utf8');
  const directoryHtml = readPage('index.html');
  document.body.innerHTML = directoryHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)![1];
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value(this: HTMLDialogElement) { this.open = true; },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value(this: HTMLDialogElement) { this.open = false; },
  });
  const windowEvents = vi.spyOn(window, 'addEventListener');
  const documentEvents = vi.spyOn(document, 'addEventListener');
  removeListeners = () => {
    for (const [type, listener] of windowEvents.mock.calls)
      if (['focus', 'online', 'pageshow'].includes(type)) window.removeEventListener(type, listener);
    for (const [type, listener] of documentEvents.mock.calls)
      if (type === 'visibilitychange') document.removeEventListener(type, listener);
  };
  // Execute the real browser modules together; the page is outside Vite's root.
  // Only module binding syntax is removed, preserving the actual DOM/fetch code.
  const parser = readPage('directory.mjs').replace(/\bexport function /g, 'function ');
  const page = readPage('app.mjs').replace(/^import [^\n]+\n/, '');
  new Function(`${parser}\n${page}`)();
  await settle();
}
const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  fetchMock.mockReset().mockResolvedValue(result());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  removeListeners();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('keeps the filtered list and open QR visible while refreshing, then adopts changed HR data', async () => {
  const next = deferred<ReturnType<typeof result>>();
  fetchMock.mockResolvedValueOnce(result()).mockReturnValueOnce(next.promise);
  await mount();
  element<HTMLSelectElement>('city').value = 'Актау';
  element<HTMLInputElement>('search').value = 'Жасыл';
  element('search').dispatchEvent(new Event('input'));
  element('list').querySelector<HTMLButtonElement>('button')!.click();
  const dialog = element<HTMLDialogElement>('qr-dialog');
  expect(dialog.open).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(element('list')).toHaveTextContent('Алия Рублева');
  expect(dialog.open).toBe(true);
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  next.resolve(result([row({ name: 'Новое ФИО', branchName: 'Жасыл — новая точка' }), row({ id: 'new', name: 'Новый кассир' })]));
  await settle();
  expect(element('list')).toHaveTextContent('Новое ФИО');
  expect(element('list')).toHaveTextContent('Новый кассир');
  expect(element('list')).not.toHaveTextContent('Алия Рублева');
  expect(element('qr-title')).toHaveTextContent('Новое ФИО');
  expect(element('qr-point')).toHaveTextContent('Жасыл — новая точка');
  expect(dialog.open).toBe(true);
  expect(element('city')).toHaveValue('Актау');
  expect(element('search')).toHaveValue('Жасыл');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'omit' });
  element('close-dialog').click();
  expect(document.activeElement).toHaveAttribute('aria-label', 'Открыть QR: Новое ФИО');
});

it('does not poll a hidden page and closes a deleted or archived cashier QR when returning', async () => {
  await mount();
  element('list').querySelector<HTMLButtonElement>('button')!.click();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await vi.advanceTimersByTimeAsync(120_000);
  window.dispatchEvent(new Event('focus'));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(result([row({ isArchived: true }), row({ id: 'new', name: 'Действующий' })]));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(element<HTMLDialogElement>('qr-dialog').open).toBe(false);
  expect(element('list')).not.toHaveTextContent('Алия Рублева');
  expect(element('list')).toHaveTextContent('Действующий');
  element('list').querySelector<HTMLButtonElement>('button')!.click();
  fetchMock.mockResolvedValueOnce(result([]));
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(element<HTMLDialogElement>('qr-dialog').open).toBe(false);
  expect(element('list').children).toHaveLength(0);
});

it('retains the last list on a failed refresh and recovers online without requiring a button', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await mount();
  expect(element('status')).toHaveTextContent('Не удалось загрузить');
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(element('list')).toHaveTextContent('Алия Рублева');
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  window.dispatchEvent(new Event('focus'));
  await settle();
  expect(element('list')).toHaveTextContent('Алия Рублева');
  expect(element('status')).toHaveTextContent('Не удалось загрузить');
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(element('status')).toHaveTextContent('Кассиры · 1');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('preserves an emptied city filter after the last local cashier is removed, without showing another city', async () => {
  await mount();
  element<HTMLSelectElement>('city').value = 'Актау';
  element('city').dispatchEvent(new Event('change'));
  element('list').querySelector<HTMLButtonElement>('button')!.focus();
  fetchMock.mockResolvedValueOnce(result([row({ id: 'other-city', name: 'Астана кассир', city: 'Астана' })]));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(element('city')).toHaveValue('Актау');
  expect(element('list')).not.toHaveTextContent('Астана кассир');
  expect(element('list').children).toHaveLength(0);
  expect(element('status')).toHaveTextContent('Никого не нашли');
  expect(document.activeElement).toBe(element('search'));
  element<HTMLSelectElement>('city').value = 'Астана';
  element('city').dispatchEvent(new Event('change'));
  expect(element('list')).toHaveTextContent('Астана кассир');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackProvider } from '../components/Feedback';
import { I18nProvider } from '../lib/i18n';
import type { FaqInput, FaqItem } from '../lib/faq';

const faqMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  hide: vi.fn(),
}));
vi.mock('../lib/faq', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/faq')>()),
  faqApi: faqMocks,
}));

import FaqPage from './FaqPage';

const item = (overrides: Partial<FaqItem> = {}): FaqItem => ({
  id: 'faq-1',
  questionRu: 'Как получить бонусы?',
  answerRu: 'Покажите QR-код на кассе.',
  questionKk: 'Бонустарды қалай алуға болады?',
  answerKk: 'Кассада QR-кодты көрсетіңіз.',
  sortOrder: 0,
  isActive: true,
  ...overrides,
});

const renderPage = () =>
  render(
    <I18nProvider>
      <FeedbackProvider>
        <FaqPage />
      </FeedbackProvider>
    </I18nProvider>,
  );
const fillRussian = (question = 'Новый вопрос', answer = 'Новый ответ') => {
  fireEvent.change(screen.getByLabelText('Вопрос · Русский *'), { target: { value: question } });
  fireEvent.change(screen.getByLabelText('Ответ · Русский *'), { target: { value: answer } });
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

describe('FAQ administration', () => {
  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    faqMocks.list.mockReset().mockResolvedValue([item()]);
    faqMocks.create
      .mockReset()
      .mockImplementation((input: FaqInput) => Promise.resolve(item({ ...input, id: 'faq-new' })));
    faqMocks.update
      .mockReset()
      .mockImplementation((id: string, input: FaqInput) => Promise.resolve(item({ ...input, id })));
    faqMocks.hide.mockReset().mockResolvedValue(item({ isActive: false }));
  });

  it('shows questions in deterministic order, including hidden entries', async () => {
    faqMocks.list.mockResolvedValue([
      item({ id: 'z', questionRu: 'Позже', sortOrder: 3 }),
      item({ id: 'b', questionRu: 'Второй', isActive: false }),
      item({ id: 'a', questionRu: 'Первый' }),
    ]);
    renderPage();
    await screen.findByRole('heading', { name: 'Первый' });
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Первый', 'Второй', 'Позже']);
    expect(screen.getByText('Скрыт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показать: Второй' })).toBeInTheDocument();
  });

  it('creates a trimmed bilingual question with order and visibility', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Добавить вопрос' }));
    fillRussian('  Новый вопрос  ', '  Новый ответ  ');
    await user.click(screen.getByRole('button', { name: 'Казахский' }));
    fireEvent.change(screen.getByLabelText('Вопрос · Казахский'), {
      target: { value: '  Жаңа сұрақ  ' },
    });
    fireEvent.change(screen.getByLabelText('Ответ · Казахский'), {
      target: { value: '  Жаңа жауап  ' },
    });
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: '8' } });
    await user.click(screen.getByLabelText('Показывать клиентам'));
    save();
    await waitFor(() =>
      expect(faqMocks.create).toHaveBeenCalledWith({
        questionRu: 'Новый вопрос',
        answerRu: 'Новый ответ',
        questionKk: 'Жаңа сұрақ',
        answerKk: 'Жаңа жауап',
        sortOrder: 8,
        isActive: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Новый вопрос' })).toBeInTheDocument();
  });

  it('edits an existing question and preserves the other language', async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Редактировать: Как получить бонусы?' }),
    );
    fillRussian('Изменённый вопрос', 'Ответ с изменениями');
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: '2' } });
    save();
    await waitFor(() =>
      expect(faqMocks.update).toHaveBeenCalledWith('faq-1', {
        questionRu: 'Изменённый вопрос',
        answerRu: 'Ответ с изменениями',
        questionKk: item().questionKk,
        answerKk: item().answerKk,
        sortOrder: 2,
        isActive: true,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Изменённый вопрос' })).toBeInTheDocument();
  });

  it('validates Russian requirements and switches to the invalid language', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить вопрос' }));
    fireEvent.click(screen.getByRole('button', { name: 'Казахский' }));
    save();
    expect(await screen.findByText('Введите вопрос на русском.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Вопрос · Русский *')).toHaveFocus());
    expect(screen.getByText('Введите ответ на русском.')).toBeInTheDocument();
    expect(faqMocks.create).not.toHaveBeenCalled();
    fillRussian();
    fireEvent.click(screen.getByRole('button', { name: 'Казахский' }));
    fireEvent.change(screen.getByLabelText('Вопрос · Казахский'), {
      target: { value: 'Тек сұрақ' },
    });
    save();
    expect(
      await screen.findByText('Заполните и вопрос, и ответ на казахском.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Ответ · Казахский')).toHaveFocus());
    expect(faqMocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['question', 'Вопрос — не более 240 символов.', 'x'.repeat(241), 'Ответ', '0'],
    ['answer', 'Ответ — не более 4000 символов.', 'Вопрос', 'x'.repeat(4001), '0'],
    ['order', 'Введите целое число от 0 до 2147483647.', 'Вопрос', 'Ответ', '1.5'],
    ['empty order', 'Введите целое число от 0 до 2147483647.', 'Вопрос', 'Ответ', ''],
  ])('validates %s limits without a request', async (_name, message, question, answer, order) => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить вопрос' }));
    fillRussian(question, answer);
    fireEvent.change(screen.getByLabelText('Порядок'), { target: { value: order } });
    save();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(faqMocks.create).not.toHaveBeenCalled();
  });

  it('allows omitted Kazakh text and keeps drafts after a failed save', async () => {
    faqMocks.create.mockRejectedValueOnce(new Error('Нет связи с сервером. Повторите попытку.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить вопрос' }));
    fillRussian();
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Нет связи с сервером. Повторите попытку.',
    );
    expect(screen.getByLabelText('Вопрос · Русский *')).toHaveValue('Новый вопрос');
    expect(screen.getByLabelText('Ответ · Русский *')).toHaveValue('Новый ответ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    save();
    await waitFor(() => expect(faqMocks.create).toHaveBeenCalledTimes(2));
    expect(faqMocks.create.mock.calls[1][0]).toMatchObject({ questionKk: '', answerKk: '' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('blocks duplicate submits and dismissal while a save is pending', async () => {
    let finish!: (value: FaqItem) => void;
    faqMocks.create.mockImplementation(
      () =>
        new Promise<FaqItem>((resolve) => {
          finish = resolve;
        }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить вопрос' }));
    fillRussian();
    const form = document.getElementById('faq-editor-form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(faqMocks.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранение…' })).toBeDisabled();
    await act(async () => finish(item({ id: 'new', questionRu: 'Новый вопрос' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('confirms hiding, keeps the entry, and restores it with full input', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть: Как получить бонусы?' }));
    const confirmation = await screen.findByRole('alertdialog');
    expect(faqMocks.hide).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Скрыть' }));
    await waitFor(() => expect(faqMocks.hide).toHaveBeenCalledWith('faq-1'));
    expect(screen.getByRole('heading', { name: 'Как получить бонусы?' })).toBeInTheDocument();
    expect(screen.getByText('Скрыт')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показать: Как получить бонусы?' }));
    await waitFor(() =>
      expect(faqMocks.update).toHaveBeenCalledWith('faq-1', {
        questionRu: item().questionRu,
        answerRu: item().answerRu,
        questionKk: item().questionKk,
        answerKk: item().answerKk,
        sortOrder: 0,
        isActive: true,
      }),
    );
    expect(screen.getByText('Опубликован')).toBeInTheDocument();
  });

  it('cancels hiding and preserves visibility on a failed mutation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Скрыть: Как получить бонусы?' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }),
    );
    expect(faqMocks.hide).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    faqMocks.hide.mockRejectedValueOnce(new Error('Не удалось скрыть вопрос.'));
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть: Как получить бонусы?' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Скрыть',
      }),
    );
    expect(await screen.findByText('Не удалось скрыть вопрос.')).toBeInTheDocument();
    expect(screen.getByText('Опубликован')).toBeInTheDocument();
  });

  it('retries a failed load and falls back to Russian when Kazakh is absent', async () => {
    localStorage.setItem('adminLocale', 'kk');
    faqMocks.list
      .mockRejectedValueOnce(new Error('Сервис недоступен'))
      .mockResolvedValueOnce([item({ questionKk: '', answerKk: '' })]);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис недоступен');
    fireEvent.click(screen.getByRole('button', { name: 'Қайталау' }));
    expect(
      await screen.findByRole('heading', { name: 'Как получить бонусы?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Покажите QR-код на кассе.')).toBeInTheDocument();
  });
});

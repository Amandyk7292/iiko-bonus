import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../lib/i18n';
import { BrowserRouter } from '../lib/router';
import type { SupportMessage, SupportRequest } from '../lib/api';
import SupportPage from './SupportPage';

const apiMocks = vi.hoisted(() => ({
  getSupportRequests: vi.fn(),
  getSupportRequest: vi.fn(),
  updateSupportRequest: vi.fn(),
  sendSupportMessage: vi.fn(),
}));
const feedback = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api: apiMocks }));
vi.mock('../lib/admin-realtime', () => ({
  useAdminRealtimeEvents: vi.fn(),
}));
vi.mock('../components/Feedback', () => ({
  useFeedback: () => feedback,
}));

const request: SupportRequest = {
  id: 'support-1',
  orderId: 'order-1',
  orderNumber: 100039,
  branchId: 'branch-1',
  branch: 'ЖК Дукат',
  customer: { name: 'Амандық', phone: '77762003590' },
  category: 'refund',
  message: 'Верните оплату',
  preview: 'Верните оплату',
  status: 'new',
  priority: 'high',
  refundRequested: true,
  attachments: [],
  resolution: null,
  assignedTo: null,
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:00:00.000Z',
  resolvedAt: null,
  dueAt: '2026-08-05T09:00:00.000Z',
  firstRespondedAt: null,
  lastMessageAt: '2026-08-05T08:00:00.000Z',
  overdue: false,
};

const customerMessage: SupportMessage = {
  id: 'message-1',
  requestId: request.id,
  senderType: 'customer',
  senderId: request.customer?.phone ?? null,
  body: 'Верните оплату за заказ',
  attachments: [
    {
      path: 'support/photo.jpg',
      url: 'https://bulka.com.kz/api/admin/support/attachment',
    },
  ],
  internal: false,
  createdAt: '2026-08-05T08:00:00.000Z',
};

const renderPage = (selectedId = request.id) => {
  window.history.replaceState(
    {},
    '',
    `/admin/support${selectedId ? `?request=${selectedId}` : ''}`,
  );
  return render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <SupportPage />
      </I18nProvider>
    </BrowserRouter>,
  );
};

describe('Support operator workflow', () => {
  let currentRequest: SupportRequest;
  let currentMessages: SupportMessage[];

  beforeEach(() => {
    localStorage.setItem('adminLocale', 'ru');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    vi.clearAllMocks();
    feedback.confirm.mockResolvedValue(true);
    currentRequest = { ...request };
    currentMessages = [{ ...customerMessage }];
    apiMocks.getSupportRequests.mockImplementation(async () => ({
      success: true,
      requests: [currentRequest],
      total: 1,
      page: 1,
      pageSize: 30,
    }));
    apiMocks.getSupportRequest.mockImplementation(async () => ({
      success: true,
      request: currentRequest,
      messages: currentMessages,
    }));
    apiMocks.updateSupportRequest.mockImplementation(async (_id: string, patch: any) => {
      currentRequest = {
        ...currentRequest,
        ...(patch.priority ? { priority: patch.priority } : {}),
        ...(patch.status ? { status: patch.status, resolution: patch.resolution ?? null } : {}),
        ...(patch.assignToMe ? { assignedTo: 'Оператор Bulka', status: 'in_review' } : {}),
      };
      return { success: true, request: currentRequest };
    });
    apiMocks.sendSupportMessage.mockImplementation(
      async (_id: string, body: string, internal: boolean) => {
        currentMessages = [
          ...currentMessages,
          {
            id: `message-${currentMessages.length + 1}`,
            requestId: currentRequest.id,
            senderType: 'admin',
            senderId: 'Оператор Bulka',
            body,
            attachments: [],
            internal,
            createdAt: '2026-08-05T08:05:00.000Z',
          },
        ];
        return {
          success: true,
          request: currentRequest,
          messages: currentMessages,
        };
      },
    );
  });

  it('claims, prioritizes, replies and closes a refund request only after a public answer', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Амандық' })).toBeInTheDocument();
    expect(screen.getByText('Клиент запросил возврат по оплаченному заказу.')).toBeInTheDocument();
    expect(screen.getByText('Верните оплату за заказ')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Фото 1/ })).toHaveAttribute(
      'href',
      'https://bulka.com.kz/api/admin/support/attachment',
    );

    await user.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() =>
      expect(apiMocks.updateSupportRequest).toHaveBeenCalledWith('support-1', {
        assignToMe: true,
      }),
    );
    expect(await screen.findByRole('button', { name: 'Ответственный: Оператор Bulka' })).toBeInTheDocument();

    const priorityControls = screen.getAllByRole('combobox', { name: 'Приоритет' });
    await user.click(priorityControls[priorityControls.length - 1]);
    await user.click(screen.getByRole('option', { name: 'Срочный' }));
    await waitFor(() =>
      expect(apiMocks.updateSupportRequest).toHaveBeenCalledWith('support-1', {
        priority: 'urgent',
      }),
    );

    await user.type(screen.getByLabelText('Ответ клиенту'), 'Возврат уже обрабатывается.');
    await user.click(screen.getByRole('button', { name: 'Отправить ответ' }));
    await waitFor(() =>
      expect(apiMocks.sendSupportMessage).toHaveBeenCalledWith(
        'support-1',
        'Возврат уже обрабатывается.',
        false,
      ),
    );
    expect(await screen.findByText('Возврат уже обрабатывается.')).toBeInTheDocument();

    const statusControls = screen.getAllByRole('combobox', { name: 'Статус' });
    await user.click(statusControls[statusControls.length - 1]);
    await user.click(screen.getByRole('option', { name: 'Решено' }));
    await waitFor(() =>
      expect(apiMocks.updateSupportRequest).toHaveBeenCalledWith('support-1', {
        status: 'resolved',
        resolution: undefined,
      }),
    );
    expect(feedback.toast).toHaveBeenCalledWith('Статус обновлён');
  });

  it('does not lose a draft when the operator refuses to switch requests', async () => {
    const secondRequest: SupportRequest = {
      ...request,
      id: 'support-2',
      orderId: null,
      orderNumber: null,
      customer: { name: 'Другой клиент', phone: '77010000002' },
      category: 'other',
      preview: 'Другой вопрос',
    };
    apiMocks.getSupportRequests.mockResolvedValue({
      success: true,
      requests: [request, secondRequest],
      total: 2,
      page: 1,
      pageSize: 30,
    });
    apiMocks.getSupportRequest.mockImplementation(async (id: string) => ({
      success: true,
      request: id === secondRequest.id ? secondRequest : request,
      messages: currentMessages,
    }));
    feedback.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'Амандық' });
    await user.type(screen.getByLabelText('Ответ клиенту'), 'Черновик ответа');
    await user.click(screen.getByRole('button', { name: /Другой клиент/ }));
    expect(feedback.confirm).toHaveBeenCalled();
    expect(window.location.search).toContain('request=support-1');
    expect(screen.getByLabelText('Ответ клиенту')).toHaveValue('Черновик ответа');

    await user.click(screen.getByRole('button', { name: /Другой клиент/ }));
    expect(await screen.findByRole('heading', { name: 'Другой клиент' })).toBeInTheDocument();
    expect(window.location.search).toContain('request=support-2');
  });

  it('recovers from an initial queue failure through the shared retry control', async () => {
    const user = userEvent.setup();
    apiMocks.getSupportRequests
      .mockRejectedValueOnce(new Error('support offline'))
      .mockResolvedValueOnce({
        success: true,
        requests: [],
        total: 0,
        page: 1,
        pageSize: 30,
      });
    renderPage('');

    expect(await screen.findByText('support offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('heading', { name: 'Очередь обращений' })).toBeInTheDocument();
    expect(screen.getByText('В этой очереди обращений нет')).toBeInTheDocument();
  });
});

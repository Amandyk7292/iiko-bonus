import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../lib/i18n';
import { BrowserRouter } from '../../lib/router';
import FortuneRedeemPage, { voucherId } from './FortuneRedeemPage';
import type { Voucher } from './model';
const mocks = vi.hoisted(() => ({
  loadVoucher: vi.fn(),
  redeemWinner: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('./api', () => ({ loadVoucher: mocks.loadVoucher, redeemWinner: mocks.redeemWinner }));
vi.mock('../../components/Feedback', () => ({
  useFeedback: () => ({ confirm: mocks.confirm, toast: mocks.toast }),
}));
const id = '11111111-1111-4111-8111-111111111111';
const voucher = (): Voucher => ({
  id,
  branchId: '22222222-2222-4222-8222-222222222222',
  branchName: 'Жасыл дала',
  customerName: 'Алия',
  prizeLabel: 'Круассан',
  prizeKind: 'gift',
  status: 'claimed',
  wonAt: '2026-10-11T00:00:00Z',
  expiresAt: '2026-10-18T00:00:00Z',
});
const show = (role = 'cashier') =>
  render(
    <BrowserRouter basename="/admin">
      <I18nProvider>
        <FortuneRedeemPage role={role} />
      </I18nProvider>
    </BrowserRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('adminLocale', 'ru');
  window.history.replaceState({}, '', '/admin/fortune/redeem');
  mocks.loadVoucher.mockResolvedValue({ voucher: voucher() });
  mocks.confirm.mockResolvedValue(true);
  mocks.redeemWinner.mockResolvedValue({ winner: { ...voucher(), status: 'redeemed' } });
});
describe('staff prize issue', () => {
  it('parses a code or QR URL without navigating to pasted links', () => {
    expect(voucherId(id.toUpperCase())).toBe(id);
    expect(voucherId(`https://bulka.com.kz/admin/fortune/redeem?code=${id}`)).toBe(id);
    expect(voucherId(`https://bulka.com.kz/prizes/${id}`)).toBe(id);
    expect(voucherId('javascript:alert(1)')).toBe('');
    expect(voucherId('bad-code')).toBe('');
  });
  it('opens customer QR directly, shows gift/account/branch and confirms issue once', async () => {
    window.history.replaceState({}, '', `/admin/fortune/redeem?code=${id}`);
    show();
    expect(await screen.findByRole('heading', { name: 'Круассан' })).toBeInTheDocument();
    expect(mocks.loadVoucher).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    expect(screen.getByText('Алия')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выдать подарок' }));
    await waitFor(() => expect(mocks.redeemWinner).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Алия · Круассан' }),
    );
    expect(await screen.findByText('Подарок уже выдан')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Выдать подарок' })).not.toBeInTheDocument();
  });
  it('clears a previous voucher when code changes and never issues it under the next code', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Код приза'), { target: { value: id } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти приз' }));
    await screen.findByRole('heading', { name: 'Круассан' });
    fireEvent.change(screen.getByLabelText('Код приза'), { target: { value: 'incorrect' } });
    expect(screen.queryByRole('button', { name: 'Выдать подарок' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Найти приз' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Введите код приза');
    expect(mocks.loadVoucher).toHaveBeenCalledTimes(1);
    expect(mocks.redeemWinner).not.toHaveBeenCalled();
  });
  it.each([
    ['expired', 'gift'],
    ['pending', 'gift'],
    ['claimed', 'bonus'],
    ['claimed', 'none'],
  ] as const)('never offers issuance for %s %s vouchers', async (status, prizeKind) => {
    window.history.replaceState({}, '', `/admin/fortune/redeem?code=${id}`);
    mocks.loadVoucher.mockResolvedValue({ voucher: { ...voucher(), status, prizeKind } });
    show();
    await screen.findByRole('heading', { name: 'Круассан' });
    expect(screen.queryByRole('button', { name: 'Выдать подарок' })).not.toBeInTheDocument();
  });
  it('shows an issue error without pretending the gift was issued', async () => {
    window.history.replaceState({}, '', `/admin/fortune/redeem?code=${id}`);
    mocks.redeemWinner.mockRejectedValue(new Error('Срок действия приза истёк'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Выдать подарок' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Срок действия приза истёк');
    expect(screen.queryByText('Подарок уже выдан')).not.toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('does not query or allow issuance for unrelated employee roles', () => {
    window.history.replaceState({}, '', `/admin/fortune/redeem?code=${id}`);
    show('viewer');
    expect(screen.getByText('Нет доступа к выдаче призов')).toBeInTheDocument();
    expect(mocks.loadVoucher).not.toHaveBeenCalled();
  });
  it('cancelled staff confirmation makes no redemption request', async () => {
    window.history.replaceState({}, '', `/admin/fortune/redeem?code=${id}`);
    mocks.confirm.mockResolvedValue(false);
    show('branch_manager');
    fireEvent.click(await screen.findByRole('button', { name: 'Выдать подарок' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.redeemWinner).not.toHaveBeenCalled();
  });
});

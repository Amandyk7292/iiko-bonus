import { beforeEach, describe, expect, it, vi } from 'vitest';
const mockRequest = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ request: mockRequest }));
import { loadDashboard, saveLearning } from './api';
describe('Learning management request scope', () => {
  beforeEach(() => mockRequest.mockReset());
  it('uses the authenticated server staff scope instead of a stale topbar branch selection', async () => {
    mockRequest.mockResolvedValue({ success: true });
    await loadDashboard();
    expect(mockRequest).toHaveBeenCalledWith('/learning/manage/dashboard', {}, { branchScope: '' });
  });
  it('sends a structured mutation through the existing protected request client', async () => {
    await saveLearning('/roles', { title: 'Стажёр', active: true });
    expect(mockRequest).toHaveBeenCalledWith(
      '/learning/manage/roles',
      { method: 'POST', body: JSON.stringify({ title: 'Стажёр', active: true }) },
      { branchScope: '' },
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { download } from './api';
afterEach(() => {
  delete window.BulkaFileShare;
  vi.restoreAllMocks();
});
describe('native report export', () => {
  it('passes the exact bytes and Excel filename to the native sheet', async () => {
    const shareFile = vi.fn().mockResolvedValue(undefined);
    window.BulkaFileShare = { shareFile };
    await download(new Blob(['spreadsheet-bytes']), 'report.xlsx');
    expect(shareFile).toHaveBeenCalledWith({
      name: 'report.xlsx',
      base64: btoa('spreadsheet-bytes'),
    });
  });
  it('reports native failures instead of silently attempting a blob URL', async () => {
    window.BulkaFileShare = { shareFile: vi.fn().mockRejectedValue(new Error('Sharing failed')) };
    await expect(download(new Blob(['report']), 'report.xlsx')).rejects.toThrow('Sharing failed');
  });
  it('keeps browser downloads outside the app', async () => {
    const create = vi.fn().mockReturnValue('blob:export');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await download(new Blob(['report']), 'report.xlsx');
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });
});

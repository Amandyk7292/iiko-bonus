import { request, ApiError } from '../../lib/api';
import { trackIikoRequest } from '../../lib/iiko-request-policy';

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function loadControls<T>(query: object, signal: AbortSignal): Promise<T> {
  const finish = trackIikoRequest('/iiko-dashboard/controls', signal);
  const started = Date.now();
  try {
    while (!signal.aborted) {
      const result = await request<T | { pending: true }>('/iiko-dashboard/controls', {
        method: 'POST',
        body: JSON.stringify(query),
        signal,
        headers: { 'X-Iiko-Async': '1' },
      });
      if (!(result && typeof result === 'object' && 'pending' in result && result.pending))
        return result as T;
      if (Date.now() - started >= 180000) throw new ApiError('', 504, 'IIKO_REPORT_TIMEOUT');
      await pause(signal);
    }
    throw new DOMException('Aborted', 'AbortError');
  } finally {
    finish();
  }
}

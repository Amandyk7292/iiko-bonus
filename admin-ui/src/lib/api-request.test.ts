import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeRequestAbortSignal } from './api';

describe('admin API request abort composition', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('forwards caller cancellation and removes its listener during cleanup', () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const requestAbort = composeRequestAbortSignal(caller.signal);

    expect(requestAbort.signal.aborted).toBe(false);
    caller.abort();
    expect(requestAbort.signal.aborted).toBe(true);
    expect(requestAbort.didTimeout()).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(requestAbort.didTimeout()).toBe(false);

    requestAbort.cleanup();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('aborts after 30 seconds and cleanup prevents a later timeout', () => {
    vi.useFakeTimers();

    const timedRequest = composeRequestAbortSignal();
    vi.advanceTimersByTime(29999);
    expect(timedRequest.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timedRequest.signal.aborted).toBe(true);
    expect(timedRequest.didTimeout()).toBe(true);
    timedRequest.cleanup();

    const completedRequest = composeRequestAbortSignal();
    completedRequest.cleanup();
    vi.advanceTimersByTime(30000);
    expect(completedRequest.signal.aborted).toBe(false);
    expect(completedRequest.didTimeout()).toBe(false);
  });
});

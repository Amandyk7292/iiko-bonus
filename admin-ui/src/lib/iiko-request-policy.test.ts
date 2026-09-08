import { describe, expect, it } from 'vitest';
import { isIikoRequestPending, requestTimeoutMs, trackIikoRequest } from './iiko-request-policy';

describe('iiko request policy', () => {
  it('allows monthly reporting while preserving ordinary request deadlines', () => {
    expect(requestTimeoutMs('/iiko-dashboard/controls')).toBe(55000);
    expect(requestTimeoutMs('/orders')).toBe(30000);
  });
  it('keeps refresh paused until every report finishes, while excluding aborted and ordinary requests', () => {
    const first = new AbortController();
    const second = new AbortController();
    const ordinary = trackIikoRequest('/orders', new AbortController().signal);
    expect(isIikoRequestPending()).toBe(false);
    const finishFirst = trackIikoRequest('/iiko-dashboard/controls', first.signal);
    const finishSecond = trackIikoRequest('/iiko-dashboard/report', second.signal);
    expect(isIikoRequestPending()).toBe(true);
    finishFirst();
    expect(isIikoRequestPending()).toBe(true);
    second.abort();
    expect(isIikoRequestPending()).toBe(false);
    finishSecond();
    ordinary();
  });
});

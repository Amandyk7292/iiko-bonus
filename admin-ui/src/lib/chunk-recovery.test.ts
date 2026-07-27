import { describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RECOVERY_STORAGE_KEY,
  CHUNK_RECOVERY_STABLE_MS,
  installChunkRecovery,
  type ChunkRecoveryRuntime,
} from './chunk-recovery';

const createHarness = (initialMarker?: string) => {
  const values = new Map<string, string>();
  if (initialMarker) values.set(CHUNK_RECOVERY_STORAGE_KEY, initialMarker);
  let listener: ((event: Event) => void) | null = null;
  let stableCallback: (() => void) | null = null;
  const reload = vi.fn();
  const runtime: ChunkRecoveryRuntime = {
    listen: (nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    now: () => 100_000,
    schedule: (callback, delay) => {
      expect(delay).toBe(CHUNK_RECOVERY_STABLE_MS);
      stableCallback = callback;
      return 7;
    },
    cancel: vi.fn(),
    reload,
  };
  return {
    runtime,
    reload,
    values,
    emit: () => {
      const event = new Event('vite:preloadError', { cancelable: true });
      listener?.(event);
      return event;
    },
    becomeStable: () => stableCallback?.(),
  };
};

describe('admin chunk recovery', () => {
  it('reloads once when a deployed lazy chunk is no longer available', () => {
    const harness = createHarness();
    installChunkRecovery(harness.runtime);

    const event = harness.emit();

    expect(event.defaultPrevented).toBe(true);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.values.get(CHUNK_RECOVERY_STORAGE_KEY)).toBe('100000');
  });

  it('does not create an automatic reload loop', () => {
    const harness = createHarness('90000');
    installChunkRecovery(harness.runtime);

    const event = harness.emit();

    expect(event.defaultPrevented).toBe(false);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('allows recovery again after the new interface stays stable', () => {
    const harness = createHarness('90000');
    installChunkRecovery(harness.runtime);

    harness.becomeStable();

    expect(harness.values.has(CHUNK_RECOVERY_STORAGE_KEY)).toBe(false);
  });
});

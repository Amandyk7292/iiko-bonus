export const CHUNK_RECOVERY_STORAGE_KEY = 'bulka-admin-chunk-recovery-at';
export const CHUNK_RECOVERY_COOLDOWN_MS = 30_000;
export const CHUNK_RECOVERY_STABLE_MS = 15_000;

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ChunkRecoveryRuntime = {
  listen: (listener: (event: Event) => void) => () => void;
  storage: RecoveryStorage;
  now: () => number;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timerId: number) => void;
  reload: () => void;
};

export function claimChunkRecovery(storage: RecoveryStorage, now: number) {
  const previous = Number(storage.getItem(CHUNK_RECOVERY_STORAGE_KEY));
  if (Number.isFinite(previous) && previous > 0 && now - previous < CHUNK_RECOVERY_COOLDOWN_MS) {
    return false;
  }
  storage.setItem(CHUNK_RECOVERY_STORAGE_KEY, String(now));
  return true;
}

export function clearChunkRecoveryMarker(storage: RecoveryStorage) {
  storage.removeItem(CHUNK_RECOVERY_STORAGE_KEY);
}

const browserRuntime = (): ChunkRecoveryRuntime => ({
  listen: (listener) => {
    window.addEventListener('vite:preloadError', listener);
    return () => window.removeEventListener('vite:preloadError', listener);
  },
  storage: {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  },
  now: () => Date.now(),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (timerId) => window.clearTimeout(timerId),
  reload: () => window.location.reload(),
});

export function installChunkRecovery(runtime: ChunkRecoveryRuntime = browserRuntime()) {
  let reloadScheduled = false;
  const stopListening = runtime.listen((event) => {
    if (reloadScheduled) {
      event.preventDefault();
      return;
    }

    let claimed = false;
    try {
      claimed = claimChunkRecovery(runtime.storage, runtime.now());
    } catch {
      // If session storage is unavailable, fail visibly through the root error
      // boundary instead of risking an automatic reload loop.
      return;
    }
    if (!claimed) return;

    reloadScheduled = true;
    event.preventDefault();
    runtime.reload();
  });

  const stableTimer = runtime.schedule(() => {
    try {
      clearChunkRecoveryMarker(runtime.storage);
    } catch {
      // Storage can be disabled independently from the application.
    }
  }, CHUNK_RECOVERY_STABLE_MS);

  return () => {
    stopListening();
    runtime.cancel(stableTimer);
  };
}

export function reloadAdminApplication() {
  try {
    clearChunkRecoveryMarker(window.sessionStorage);
  } catch {
    // A manual reload remains useful even when storage is unavailable.
  }
  window.location.reload();
}

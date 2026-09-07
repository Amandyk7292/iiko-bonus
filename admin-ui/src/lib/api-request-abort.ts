const REQUEST_TIMEOUT_MS = 30000;

export function composeRequestAbortSignal(
  callerSignal?: AbortSignal | null,
  timeoutMs = REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  let timedOut = false;
  let cleanedUp = false;
  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = window.setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

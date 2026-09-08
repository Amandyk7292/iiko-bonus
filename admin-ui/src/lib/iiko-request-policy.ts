const pending = new Set<AbortSignal>();
const isReporting = (endpoint: string) => endpoint.startsWith('/iiko-dashboard/');

export const requestTimeoutMs = (endpoint: string) => (isReporting(endpoint) ? 55000 : 30000);

export function trackIikoRequest(endpoint: string, signal: AbortSignal) {
  if (isReporting(endpoint)) pending.add(signal);
  return () => {
    pending.delete(signal);
  };
}

export function isIikoRequestPending() {
  return [...pending].some((signal) => !signal.aborted);
}

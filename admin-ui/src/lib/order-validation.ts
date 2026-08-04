export const normalizeCancellationReason = (value: string) => value.trim().replace(/\s+/g, ' ');

export const isCancellationReasonValid = (value: string) => {
  const normalized = normalizeCancellationReason(value);
  return normalized.length >= 3 && /[\p{L}\p{N}]/u.test(normalized);
};

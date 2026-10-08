import { useState, type Dispatch, type SetStateAction } from 'react';

// Keep a typing draft while its URL is unchanged; adopt external navigation
// during render so the URL-writing effect never commits an older draft over it.
export function useQueryState<T>(
  urlValue: T,
  normalize?: (value: T) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState({ urlValue, value: urlValue });
  const value =
    Object.is(draft.urlValue, urlValue) || Object.is(normalize?.(draft.value) ?? draft.value, urlValue)
      ? draft.value
      : urlValue;
  if (!Object.is(draft.urlValue, urlValue)) setDraft({ urlValue, value });
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    setDraft((previous) => {
      const current = Object.is(previous.urlValue, urlValue) ? previous.value : urlValue;
      return { urlValue, value: typeof next === 'function' ? (next as (value: T) => T)(current) : next };
    });
  };
  return [value, setValue];
}

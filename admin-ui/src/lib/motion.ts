import { useEffect, useState } from 'react';

export const motionDurations = {
  fast: 150,
  base: 180,
  medium: 220,
  slow: 260,
  panel: 300,
} as const;

export const chartMotion = (reduced: boolean) => (
  reduced ? false as const : { duration: motionDurations.slow }
);

const getReducedMotion = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export function useReducedMotion() {
  const [reduced, setReduced] = useState(getReducedMotion);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

import { expect, it } from 'vitest';
import { virtualPosLineTotal } from './virtual-pos';

it('matches authoritative decimal half-up rounding per weighted line before summing', () => {
  expect(virtualPosLineTotal(2.01, '0.5')).toBe(1.01);
  const lines = [virtualPosLineTotal(10.05, '0.5'), virtualPosLineTotal(10.05, '0,5')];
  expect(lines.reduce((total, amount) => total + Math.round(amount * 100), 0) / 100).toBe(10.06);
  expect(virtualPosLineTotal(99999.99, '0.001')).toBe(100);
});

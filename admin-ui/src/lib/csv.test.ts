import { describe, expect, it } from 'vitest';
import { csvCell } from './csv';

describe('CSV cells', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1)', '  =1+1', '\tAlice', '\r=1', '\n=1'])(
    'neutralizes formula/control prefixes in strings: %j',
    (value) => expect(csvCell(value)).toBe(`"'${value}"`),
  );

  it('preserves numeric values and readable text while escaping separators and quotes', () => {
    expect(csvCell(-35)).toBe('"-35"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('Плюшка; "Московская"')).toBe('"Плюшка; ""Московская"""');
    expect(csvCell('+77762003590')).toBe('"\'+77762003590"');
    expect(csvCell('Амандык')).toBe('"Амандык"');
  });
});

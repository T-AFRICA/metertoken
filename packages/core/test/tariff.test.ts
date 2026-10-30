import { describe, expect, it } from 'vitest';
import { quoteByAmount, quoteByUnits, TariffError, type TariffDefinition } from '../src';

// Sample tariff only (flat rate + percentage charges). Real tariffs are configured by an admin.
const sample: TariffDefinition = {
  currency: 'TZS',
  baseRate: '292',
  percentCharges: [
    { name: 'VAT 18%', percent: '18' },
    { name: 'Levy 3%', percent: '3' },
    { name: 'Levy 1%', percent: '1' },
  ],
  fixedCharges: [],
};

describe('quoteByUnits', () => {
  it('prices units with per-line rounding', () => {
    const q = quoteByUnits(sample, '5');
    expect(q.units).toBe('5.00');
    expect(q.amount).toBe('1781.20');
    expect(q.lines.map((l) => l.amount)).toEqual(['1460.00', '262.80', '43.80', '14.60']);
  });

  it('adds fixed charges', () => {
    const q = quoteByUnits({ ...sample, fixedCharges: [{ name: 'Service', amount: '100' }] }, '1');
    expect(q.amount).toBe('456.24');
  });

  it('rejects zero, negative and too-precise units', () => {
    expect(() => quoteByUnits(sample, '0')).toThrow(TariffError);
    expect(() => quoteByUnits(sample, '-1')).toThrow(TariffError);
    expect(() => quoteByUnits(sample, '1.001')).toThrow(TariffError);
  });

  it('uses 0 decimals for UGX', () => {
    const q = quoteByUnits({ currency: 'UGX', baseRate: '756.2', percentCharges: [{ name: 'VAT', percent: '18' }], fixedCharges: [] }, '3');
    expect(q.amount).toMatch(/^\d+$/);
  });
});

describe('quoteByAmount', () => {
  it('is the inverse of quoteByUnits for an exact amount', () => {
    const q = quoteByAmount(sample, '1781.20');
    expect(q.units).toBe('5.00');
    expect(q.amount).toBe('1781.20');
    expect(q.lines.find((l) => l.name === 'Rounding')).toBeUndefined();
  });

  it('rounds units down and shows the remainder', () => {
    const q = quoteByAmount(sample, '1000');
    const priced = quoteByUnits(sample, q.units);
    expect(Number(priced.amount)).toBeLessThanOrEqual(1000);
    expect(q.amount).toBe('1000.00');
    expect(q.lines.at(-1)?.name).toBe('Rounding');
  });

  it('rejects amounts that do not cover fixed charges', () => {
    expect(() => quoteByAmount({ ...sample, fixedCharges: [{ name: 'Service', amount: '500' }] }, '400')).toThrow(TariffError);
  });
});

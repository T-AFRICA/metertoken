import Decimal from 'decimal.js';

export const CURRENCY_DECIMALS = { KES: 2, TZS: 2, UGX: 0, RWF: 0 } as const;
export type CurrencyCode = keyof typeof CURRENCY_DECIMALS;

/** Units (kWh) are always quoted to 2 decimals. */
export const UNIT_DECIMALS = 2;

export interface PercentCharge {
  name: string;
  /** Percentage of the energy charge, e.g. "18" for 18 %. */
  percent: string;
}

export interface FixedCharge {
  name: string;
  amount: string;
}

export interface TariffDefinition {
  currency: CurrencyCode;
  /** Price of 1 kWh before charges. */
  baseRate: string;
  percentCharges: PercentCharge[];
  fixedCharges: FixedCharge[];
}

export interface QuoteLine {
  name: string;
  amount: string;
}

export interface Quote {
  mode: 'units' | 'amount';
  units: string;
  amount: string;
  currency: CurrencyCode;
  lines: QuoteLine[];
}

export class TariffError extends Error {}

const money = (d: Decimal, currency: CurrencyCode) =>
  d.toDecimalPlaces(CURRENCY_DECIMALS[currency], Decimal.ROUND_HALF_UP);

function assertTariff(t: TariffDefinition) {
  if (!new Decimal(t.baseRate).gt(0)) throw new TariffError('Tariff base rate must be greater than 0');
  for (const c of t.percentCharges) {
    if (new Decimal(c.percent).lt(0)) throw new TariffError(`Charge "${c.name}" cannot be negative`);
  }
  for (const c of t.fixedCharges) {
    if (new Decimal(c.amount).lt(0)) throw new TariffError(`Charge "${c.name}" cannot be negative`);
  }
}

/** Price a purchase of `units` kWh. Each line is rounded to the currency's decimals. */
export function quoteByUnits(t: TariffDefinition, units: string): Quote {
  assertTariff(t);
  const u = new Decimal(units);
  if (!u.gt(0)) throw new TariffError('Units must be greater than 0');
  if (u.decimalPlaces() > UNIT_DECIMALS) throw new TariffError(`Units can have at most ${UNIT_DECIMALS} decimals`);

  const energy = money(u.mul(t.baseRate), t.currency);
  const lines: QuoteLine[] = [{ name: 'Energy', amount: energy.toFixed(CURRENCY_DECIMALS[t.currency]) }];
  let total = energy;
  for (const c of t.percentCharges) {
    const v = money(energy.mul(c.percent).div(100), t.currency);
    lines.push({ name: c.name, amount: v.toFixed(CURRENCY_DECIMALS[t.currency]) });
    total = total.add(v);
  }
  for (const c of t.fixedCharges) {
    const v = money(new Decimal(c.amount), t.currency);
    lines.push({ name: c.name, amount: v.toFixed(CURRENCY_DECIMALS[t.currency]) });
    total = total.add(v);
  }
  return {
    mode: 'units',
    units: u.toFixed(UNIT_DECIMALS),
    amount: total.toFixed(CURRENCY_DECIMALS[t.currency]),
    currency: t.currency,
    lines,
  };
}

/**
 * Convert a money amount into units, rounding units down so the customer is never
 * credited more than they paid for. Any remainder is shown as a rounding line.
 */
export function quoteByAmount(t: TariffDefinition, amount: string): Quote {
  assertTariff(t);
  const a = new Decimal(amount);
  const dp = CURRENCY_DECIMALS[t.currency];
  if (!a.gt(0)) throw new TariffError('Amount must be greater than 0');
  if (a.decimalPlaces() > dp) throw new TariffError(`Amount can have at most ${dp} decimals for ${t.currency}`);

  const fixed = t.fixedCharges.reduce((s, c) => s.add(c.amount), new Decimal(0));
  const factor = t.percentCharges.reduce((s, c) => s.add(new Decimal(c.percent).div(100)), new Decimal(1));
  const net = a.sub(fixed);
  if (!net.gt(0)) throw new TariffError('Amount does not cover the fixed charges');

  let units = net.div(factor).div(t.baseRate).toDecimalPlaces(UNIT_DECIMALS, Decimal.ROUND_DOWN);
  if (!units.gt(0)) throw new TariffError('Amount is too small to buy any units');
  // Per-line rounding can push the priced total above the amount paid; step down until it fits.
  let priced = quoteByUnits(t, units.toFixed(UNIT_DECIMALS));
  while (new Decimal(priced.amount).gt(a)) {
    units = units.sub(new Decimal(1).div(10 ** UNIT_DECIMALS));
    if (!units.gt(0)) throw new TariffError('Amount is too small to buy any units');
    priced = quoteByUnits(t, units.toFixed(UNIT_DECIMALS));
  }
  const remainder = a.sub(priced.amount);
  const lines = remainder.gt(0) ? [...priced.lines, { name: 'Rounding', amount: remainder.toFixed(dp) }] : priced.lines;
  return { mode: 'amount', units: priced.units, amount: a.toFixed(dp), currency: t.currency, lines };
}

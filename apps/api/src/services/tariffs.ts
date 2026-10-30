import type { CurrencyCode, FixedCharge, PercentCharge, TariffDefinition } from '@tronic/core';
import type { Queryable } from '../db';

export interface ActiveTariff {
  code: string;
  versionId: string;
  definition: TariffDefinition;
}

export async function findActiveTariff(q: Queryable, code: string): Promise<ActiveTariff | null> {
  const row = (
    await q.query<{ id: string; code: string; currency: CurrencyCode; base_rate: string; percent_charges: PercentCharge[]; fixed_charges: FixedCharge[] }>(
      `SELECT v.id, t.code, t.currency, v.base_rate::text AS base_rate, v.percent_charges, v.fixed_charges
         FROM tariff_versions v JOIN tariffs t ON t.id = v.tariff_id
        WHERE t.code = $1 AND v.status = 'active'`,
      [code],
    )
  ).rows[0];
  if (!row) return null;
  return {
    code: row.code,
    versionId: row.id,
    definition: {
      currency: row.currency,
      baseRate: row.base_rate,
      percentCharges: row.percent_charges,
      fixedCharges: row.fixed_charges,
    },
  };
}

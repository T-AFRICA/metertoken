import { quoteByAmount, quoteByUnits, StsRejectedError, StsUnavailableError, TariffError, type MeterVerification } from '@tronic/core';
import Decimal from 'decimal.js';
import type { AppContext } from '../context';
import { HttpError } from '../http';
import { findActiveTariff } from './tariffs';

const VERIFY_CACHE_MS = 5 * 60 * 1000;

/** Meter checks and server-side quotes, shared by the staff desk and the customer page. */
export function createQuoteService(ctx: AppContext) {
  const verified = new Map<string, { at: number; result: MeterVerification }>();

  async function verifyMeter(meterNo: string): Promise<MeterVerification> {
    const hit = verified.get(meterNo);
    if (hit && Date.now() - hit.at < VERIFY_CACHE_MS) return hit.result;
    try {
      const result = await ctx.adapter.verifyMeter(meterNo);
      verified.set(meterNo, { at: Date.now(), result });
      return result;
    } catch (e) {
      if (e instanceof StsRejectedError) throw new HttpError(404, 'METER_NOT_FOUND', e.message);
      if (e instanceof StsUnavailableError) throw new HttpError(502, 'VENDOR_UNAVAILABLE', 'The STS service is not reachable. Try again.');
      throw e;
    }
  }

  async function createQuote(userId: string, meterNo: string, mode: 'units' | 'amount', value: string) {
    const meter = await verifyMeter(meterNo);
    const tariff =
      (meter.tariffCode && (await findActiveTariff(ctx.db, meter.tariffCode))) ||
      (await findActiveTariff(ctx.db, ctx.cfg.DEFAULT_TARIFF_CODE));
    if (!tariff) throw new HttpError(409, 'NO_TARIFF', 'No active tariff is configured. Ask an admin to set one up.');

    let quote;
    try {
      quote = mode === 'units' ? quoteByUnits(tariff.definition, value) : quoteByAmount(tariff.definition, value);
    } catch (e) {
      if (e instanceof TariffError) throw new HttpError(400, 'INVALID_VALUE', e.message);
      throw e;
    }
    if (new Decimal(quote.units).gt(ctx.cfg.MAX_VEND_UNITS)) {
      throw new HttpError(400, 'LIMIT', `Maximum ${ctx.cfg.MAX_VEND_UNITS} kWh per vend`);
    }
    if (new Decimal(quote.amount).gt(ctx.cfg.MAX_VEND_AMOUNT)) {
      throw new HttpError(400, 'LIMIT', `Maximum ${ctx.cfg.MAX_VEND_AMOUNT} ${quote.currency} per vend`);
    }

    const row = (
      await ctx.db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO quotes (user_id, meter_no, mode, units, amount, currency, tariff_version_id, lines, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9))
         RETURNING id, expires_at`,
        [userId, meterNo, quote.mode, quote.units, quote.amount, quote.currency, tariff.versionId, JSON.stringify(quote.lines), ctx.cfg.QUOTE_TTL_SECONDS],
      )
    ).rows[0]!;

    return {
      quoteId: row.id,
      meterNo,
      customerName: meter.customerName ?? null,
      tariffCode: tariff.code,
      ...quote,
      expiresAt: row.expires_at,
    };
  }

  return { verifyMeter, createQuote };
}

import { decimalStringSchema, meterNoSchema } from '@tronic/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit';
import type { AppContext } from '../context';
import { requireRole, requireUser } from '../http';
import { createQuoteService } from '../services/quotes';

const VEND_ROLES = ['cashier', 'supervisor', 'admin'] as const;

export function quoteRoutes(app: FastifyInstance, ctx: AppContext) {
  const quotes = createQuoteService(ctx);

  app.post('/api/meters/verify', { preHandler: requireRole(...VEND_ROLES) }, async (req) => {
    const user = requireUser(req);
    const { meterNo } = z.object({ meterNo: meterNoSchema }).parse(req.body);
    try {
      const result = await quotes.verifyMeter(meterNo);
      await audit(ctx.db, { actorId: user.id, action: 'meter.verify', entity: 'meter', entityId: meterNo, detail: { valid: true } });
      return result;
    } catch (e) {
      await audit(ctx.db, { actorId: user.id, action: 'meter.verify', entity: 'meter', entityId: meterNo, detail: { valid: false } });
      throw e;
    }
  });

  app.post('/api/quotes', { preHandler: requireRole(...VEND_ROLES) }, async (req) => {
    const user = requireUser(req);
    const body = z
      .object({ meterNo: meterNoSchema, mode: z.enum(['units', 'amount']), value: decimalStringSchema })
      .parse(req.body);
    return quotes.createQuote(user.id, body.meterNo, body.mode, body.value);
  });
}

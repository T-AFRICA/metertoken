import { z } from 'zod';
import type { Queryable } from '../db';
import { HttpError, type SessionUser } from '../http';

/** The inactive staff account that customer purchases are recorded under (created in migration 002). */
export const SELF_SERVICE_USERNAME = 'self-service';

export const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

export interface CustomerRow {
  id: string;
  meter_no: string;
  name: string;
  phone: string | null;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

export const CUSTOMER_SELECT = `SELECT id, meter_no, name, phone, active, created_at, last_login_at FROM customers`;

export function customerView(c: CustomerRow) {
  return {
    id: c.id,
    meterNo: c.meter_no,
    name: c.name,
    phone: c.phone,
    active: c.active,
    createdAt: c.created_at,
    lastLoginAt: c.last_login_at,
  };
}

/** Customer purchases go through createVend as this account; it can never sign in. */
export async function selfServiceUser(q: Queryable): Promise<SessionUser> {
  const row = (await q.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE username = $1', [SELF_SERVICE_USERNAME])).rows[0];
  if (!row) throw new HttpError(500, 'SELF_SERVICE_MISSING', 'Customer self-service is not set up. Run the database migrations.');
  return { id: row.id, username: SELF_SERVICE_USERNAME, displayName: row.display_name, role: 'cashier', sessionId: '', csrfToken: '' };
}

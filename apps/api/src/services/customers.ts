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
  landlord_id: string | null;
  landlord_name: string | null;
  created_at: Date;
  last_login_at: Date | null;
}

/** Columns are qualified with "c." because the landlord join brings its own id and created_at. */
export const CUSTOMER_SELECT = `SELECT c.id, c.meter_no, c.name, c.phone, c.active, c.landlord_id, l.display_name AS landlord_name,
       c.created_at, c.last_login_at
  FROM customers c LEFT JOIN users l ON l.id = c.landlord_id`;

export function customerView(c: CustomerRow) {
  return {
    id: c.id,
    meterNo: c.meter_no,
    name: c.name,
    phone: c.phone,
    active: c.active,
    landlordId: c.landlord_id,
    landlordName: c.landlord_name,
    createdAt: c.created_at,
    lastLoginAt: c.last_login_at,
  };
}

export const isLandlord = (u: SessionUser) => u.role === 'landlord';

/** A landlord may only vend to the meters of their own active tenants. */
export async function assertLandlordMeter(q: Queryable, user: SessionUser, meterNo: string) {
  if (!isLandlord(user)) return;
  const own = (await q.query('SELECT 1 FROM customers WHERE meter_no = $1 AND landlord_id = $2 AND active', [meterNo, user.id])).rows[0];
  if (!own) throw new HttpError(403, 'NOT_YOUR_TENANT', 'This meter is not one of your tenants. Register the tenant first on the Tenants page.');
}

/** Customer purchases go through createVend as this account; it can never sign in. */
export async function selfServiceUser(q: Queryable): Promise<SessionUser> {
  const row = (await q.query<{ id: string; display_name: string }>('SELECT id, display_name FROM users WHERE username = $1', [SELF_SERVICE_USERNAME])).rows[0];
  if (!row) throw new HttpError(500, 'SELF_SERVICE_MISSING', 'Tenant self-service is not set up. Run the database migrations.');
  return { id: row.id, username: SELF_SERVICE_USERNAME, displayName: row.display_name, role: 'cashier', sessionId: '', csrfToken: '' };
}

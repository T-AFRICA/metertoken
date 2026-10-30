import { z } from 'zod';

/** STS meter numbers are 11 or 13 digits; the vendor API accepts at most 13 characters. */
export const meterNoSchema = z
  .string()
  .trim()
  .regex(/^(\d{11}|\d{13})$/, 'Meter number must be 11 or 13 digits');

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Must be a positive number');

export const currencySchema = z.enum(['KES', 'TZS', 'UGX', 'RWF']);

export const roleSchema = z.enum(['cashier', 'supervisor', 'admin', 'auditor']);
export type Role = z.infer<typeof roleSchema>;

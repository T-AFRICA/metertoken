import { currencySchema } from '@tronic/core';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .default('')
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));
const intCsv = csv.transform((list, ctx) => {
  const nums = list.map(Number);
  if (nums.some((n) => !Number.isInteger(n))) ctx.addIssue({ code: 'custom', message: 'Expected comma-separated integers' });
  return nums;
});

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(4000),

  /** PostgreSQL connection string. If unset, an embedded PGlite database in PGLITE_DIR is used (development only). */
  DATABASE_URL: z.string().optional(),
  /** PEM certificate of the database's CA (Supabase: Database settings → SSL certificate). Turns on verified TLS. */
  DATABASE_CA_CERT: z
    .string()
    .optional()
    .transform((v) => v?.replace(/\\n/g, '\n')),
  PGLITE_DIR: z.string().default('.data/pglite'),

  /** 32 random bytes, base64. Encrypts STS tokens at rest. */
  TOKEN_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENC_KEY must be 32 bytes, base64-encoded'),
  COOKIE_SECURE: bool.optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),

  CURRENCY: currencySchema.default('TZS'),
  DEFAULT_TARIFF_CODE: z.string().default('DEFAULT'),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** Meters reject a second token generated in the same minute ("USED"), so 60 s is the minimum. */
  METER_COOLDOWN_SECONDS: z.coerce.number().int().min(60).default(60),
  DUPLICATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_VEND_AMOUNT: z.string().default('1000000'),
  MAX_VEND_UNITS: z.string().default('5000'),
  /** UNKNOWN vends that cannot be resolved automatically move to MANUAL_REVIEW after this long. */
  UNKNOWN_TO_REVIEW_SECONDS: z.coerce.number().int().positive().default(600),

  STS_MODE: z.enum(['mock', 'live']).default('mock'),
  STS_LIVE_ENABLED: bool.default('false'),
  STS_VENDOR_BASE_URL: z.string().optional(),
  STS_VENDOR_USER_ID: z.string().optional(),
  STS_VENDOR_PASSWORD: z.string().optional(),
  STS_VENDOR_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  STS_VENDOR_SUCCESS_CODES: intCsv,
  STS_VENDOR_REJECT_CODES: intCsv,
  STS_VENDOR_ALLOW_INSECURE_HOSTS: csv,

  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  SEED_SAMPLE_TARIFF: bool.default('false'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && !cfg.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production (PGlite is for development only)');
  }
  return cfg;
}

export const cookieSecure = (cfg: Config) => cfg.COOKIE_SECURE ?? cfg.NODE_ENV === 'production';

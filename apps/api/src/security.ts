import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM. Stored as "v1:<iv>:<tag>:<ciphertext>", all base64. */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(stored: string, keyB64: string): string {
  const [version, iv, tag, ct] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|csrf|authorization/i;
const ALLOWED_KEYS = new Set(['tokenLast4', 'tokenCount']);

/** Removes credentials and tokens from objects before they are logged or audited. */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) && !ALLOWED_KEYS.has(k) ? '[redacted]' : redact(v)]),
    ) as T;
  }
  return value;
}

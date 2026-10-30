/** Mock tokens start with letters so they can never be keyed into a real meter. */
export const MOCK_TOKEN_PREFIX = 'MOCK';

export function normalizeToken(raw: string): string {
  return raw.replace(/[\s\-_]/g, '');
}

/** A real STS token is exactly 20 digits (IEC 62055-41). */
export function isStsTokenDigits(raw: string): boolean {
  return /^\d{20}$/.test(normalizeToken(raw));
}

export function isMockToken(raw: string): boolean {
  return raw.trim().startsWith(MOCK_TOKEN_PREFIX);
}

/** Group digits in fours: "1234 5678 9012 3456 7890". Mock tokens are returned unchanged. */
export function formatToken(raw: string): string {
  if (isMockToken(raw)) return raw.trim();
  return normalizeToken(raw).replace(/(.{4})(?=.)/g, '$1 ');
}

export function tokenLast4(raw: string): string {
  return normalizeToken(raw).slice(-4);
}

export function maskToken(raw: string): string {
  return `•••• •••• •••• •••• ${tokenLast4(raw)}`;
}

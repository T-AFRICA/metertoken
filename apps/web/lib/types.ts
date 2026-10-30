export type Role = 'cashier' | 'supervisor' | 'admin' | 'auditor';
export type VendStatus = 'PENDING' | 'SUBMITTED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'MANUAL_REVIEW';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface Me {
  user: User;
  csrfToken: string;
  adapterMode: 'mock' | 'live';
  currency: string;
}

export interface QuoteLine {
  name: string;
  amount: string;
}

export interface Quote {
  quoteId: string;
  meterNo: string;
  customerName: string | null;
  tariffCode: string;
  mode: 'units' | 'amount';
  units: string;
  amount: string;
  currency: string;
  lines: QuoteLine[];
  expiresAt: string;
}

export interface Vend {
  id: string;
  reference: string;
  meterNo: string;
  operator: string;
  mode: 'units' | 'amount';
  units: string;
  amount: string;
  currency: string;
  lines: QuoteLine[];
  status: VendStatus;
  adapterMode: 'mock' | 'live';
  vendorRef: string | null;
  tokenLast4: string | null;
  tokens: string[] | null;
  errorMessage: string | null;
  resolutionNote: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const isSupervisor = (r: Role) => r === 'supervisor' || r === 'admin';
export const canVend = (r: Role) => r !== 'auditor';

export function formatToken(t: string): string {
  if (t.startsWith('MOCK')) return t;
  return t.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/** "MANUAL_REVIEW" → "Manual review", for status badges. */
export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

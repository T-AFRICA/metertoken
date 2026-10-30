import type { CurrencyCode } from '../tariff';

export type AdapterMode = 'mock' | 'live';

export interface MeterVerification {
  meterNo: string;
  valid: boolean;
  /** Display name, already safe to show to the operator. */
  customerName?: string;
  /** Vendor tariff / use-type code, when the vendor returns one. */
  tariffCode?: string;
}

export interface IssueRequest {
  /** Portal transaction UUID; also the idempotency key for adapters that support one. */
  clientRef: string;
  meterNo: string;
  /** Vend by money amount or by kWh units. */
  by: 'amount' | 'units';
  /** Decimal string with fixed decimals; never a float. */
  value: string;
  currency: CurrencyCode;
}

export interface IssueResult {
  /** One or more tokens; key-change tokens may precede the credit token. */
  tokens: string[];
  vendorRef?: string;
  vendorCode?: string;
  units?: string;
  amount?: string;
}

export type StatusResult =
  | { status: 'unsupported' }
  | { status: 'not_found' }
  | { status: 'succeeded'; result: IssueResult };

export interface StsAdapter {
  readonly mode: AdapterMode;
  verifyMeter(meterNo: string): Promise<MeterVerification>;
  issueCreditToken(req: IssueRequest): Promise<IssueResult>;
  getTransactionStatus(clientRef: string): Promise<StatusResult>;
}

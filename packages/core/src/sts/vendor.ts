import { isStsTokenDigits, normalizeToken } from '../token';
import {
  StsConfigError,
  StsMeterNotFoundError,
  StsRejectedError,
  StsUnavailableError,
  StsUnknownOutcomeError,
} from './errors';
import type { IssueRequest, IssueResult, MeterVerification, StatusResult, StsAdapter } from './types';

/**
 * Adapter for the vendor's published "STS Vend System API" (see docs/STS_API_DOCUMENTATION.md §7).
 *
 * Only three operations exist here on purpose: GetContractInfo, GetVendingToken and UseTypeList.
 * Management tokens (clear credit, clear tamper, max power, change decoder key) and meter
 * administration are deliberately not implemented.
 *
 * The vendor API takes UserId/Password in the query string, so request URLs are never logged.
 * GetVendingToken is a GET: it is sent exactly once, with no retries at any layer.
 */

export type VendorOperation = 'GetContractInfo' | 'GetVendingToken' | 'UseTypeList';

const PATHS: Record<VendorOperation, string> = {
  GetContractInfo: '/api/Power/GetContractInfo',
  GetVendingToken: '/api/Power/GetVendingToken',
  UseTypeList: '/api/UseType/UseTypeList',
};

/** MeterType 1 = electricity in the vendor API. */
const METER_TYPE_ELECTRIC = '1';

export interface VendorCallLog {
  operation: VendorOperation;
  outcome: 'ok' | 'vendor_error' | 'http_error' | 'timeout' | 'network_error' | 'bad_response';
  httpStatus?: number;
  code?: number;
  latencyMs: number;
}

export interface VendorApiConfig {
  baseUrl: string;
  userId: string;
  password: string;
  timeoutMs: number;
  /** RichResult.code values that mean success. Must come from the vendor's documentation. */
  successCodes: number[];
  /**
   * RichResult.code values that the vendor confirms mean "no token was issued".
   * Any other non-success code is treated as an unknown outcome and sent to manual review.
   */
  rejectCodes?: number[];
  /** Hosts that may be reached over plain HTTP because they sit on a private VPN route. */
  allowInsecureHosts?: string[];
  fetchImpl?: typeof fetch;
  onCall?: (log: VendorCallLog) => void;
}

export function assertVendorConfig(cfg: VendorApiConfig): void {
  let url: URL;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    throw new StsConfigError('STS vendor base URL is not a valid URL');
  }
  const insecureAllowed = (cfg.allowInsecureHosts ?? []).includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecureAllowed)) {
    throw new StsConfigError(
      'STS vendor base URL must use HTTPS, or the host must be listed as a private VPN host',
    );
  }
  if (url.username || url.password) throw new StsConfigError('Do not put credentials in the STS vendor URL');
  if (!cfg.userId || !cfg.password) throw new StsConfigError('STS vendor credentials are missing');
  if (cfg.successCodes.length === 0) {
    throw new StsConfigError('STS vendor success codes are not configured (take them from the vendor documentation)');
  }
  if (!(cfg.timeoutMs > 0)) throw new StsConfigError('STS vendor timeout must be greater than 0');
}

interface RichResult {
  code: number;
  message?: string | null;
  data?: unknown;
}

function isRichResult(v: unknown): v is RichResult {
  return typeof v === 'object' && v !== null && typeof (v as RichResult).code === 'number';
}

class CallFailed extends Error {
  constructor(readonly outcome: VendorCallLog['outcome'], message: string) {
    super(message);
  }
}

export class VendorApiStsAdapter implements StsAdapter {
  readonly mode = 'live' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: VendorApiConfig) {
    assertVendorConfig(cfg);
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async verifyMeter(meterNo: string): Promise<MeterVerification> {
    let res: RichResult;
    try {
      res = await this.call('GetContractInfo', { MeterType: METER_TYPE_ELECTRIC, MeterCode: meterNo });
    } catch (e) {
      throw new StsUnavailableError(e instanceof Error ? e.message : 'Vendor call failed');
    }
    if (!this.cfg.successCodes.includes(res.code)) {
      throw new StsMeterNotFoundError(res.message || 'Meter not accepted by vendor', String(res.code));
    }
    // The response schema of GetContractInfo is not documented yet. Until it is, only the fact
    // that the vendor accepted the meter is used; no customer data is passed through.
    return { meterNo, valid: true };
  }

  async issueCreditToken(req: IssueRequest): Promise<IssueResult> {
    let res: RichResult;
    try {
      res = await this.call('GetVendingToken', {
        MeterType: METER_TYPE_ELECTRIC,
        MeterCode: req.meterNo,
        AmountOrQuantity: req.value,
        VendingType: req.by === 'amount' ? '0' : '1',
      });
    } catch (e) {
      // Timeout, network error, HTTP error or unreadable body: the vendor may have issued a token.
      throw new StsUnknownOutcomeError(e instanceof Error ? e.message : 'Vendor call failed');
    }

    if (!this.cfg.successCodes.includes(res.code)) {
      const message = res.message || `Vendor returned code ${res.code}`;
      if ((this.cfg.rejectCodes ?? []).includes(res.code)) throw new StsRejectedError(message, String(res.code));
      throw new StsUnknownOutcomeError(message, String(res.code));
    }

    const tokens = extractTokens(res.data);
    if (tokens.length === 0) {
      throw new StsUnknownOutcomeError('Vendor reported success but no valid 20-digit token was found', String(res.code));
    }
    return { tokens, vendorCode: String(res.code) };
  }

  async getTransactionStatus(): Promise<StatusResult> {
    // The vendor API has no status or electricity-history operation (yet).
    return { status: 'unsupported' };
  }

  /** Tariff categories ("use types"). Response shape is undocumented, so it is returned as-is. */
  async listUseTypes(): Promise<unknown> {
    const res = await this.call('UseTypeList', {}, { userId: 'userId', password: 'password' });
    if (!this.cfg.successCodes.includes(res.code)) throw new StsRejectedError(res.message || 'UseTypeList failed');
    return res.data;
  }

  private async call(
    operation: VendorOperation,
    params: Record<string, string>,
    credentialNames = { userId: 'UserId', password: 'Password' },
  ): Promise<RichResult> {
    const url = new URL(PATHS[operation], this.cfg.baseUrl);
    url.searchParams.set(credentialNames.userId, this.cfg.userId);
    url.searchParams.set(credentialNames.password, this.cfg.password);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const started = Date.now();
    const log = (entry: Omit<VendorCallLog, 'operation' | 'latencyMs'>) =>
      this.cfg.onCall?.({ operation, latencyMs: Date.now() - started, ...entry });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      log({ outcome: timedOut ? 'timeout' : 'network_error' });
      // Never include the original error text: some runtimes put the full URL (with password) in it.
      throw new CallFailed(timedOut ? 'timeout' : 'network_error', timedOut ? 'Vendor call timed out' : 'Vendor network error');
    }

    if (!response.ok) {
      log({ outcome: 'http_error', httpStatus: response.status });
      throw new CallFailed('http_error', `Vendor HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      log({ outcome: 'bad_response', httpStatus: response.status });
      throw new CallFailed('bad_response', 'Vendor response was not JSON');
    }
    if (!isRichResult(body)) {
      log({ outcome: 'bad_response', httpStatus: response.status });
      throw new CallFailed('bad_response', 'Vendor response did not have the expected { code, message, data } shape');
    }
    log({
      outcome: this.cfg.successCodes.includes(body.code) ? 'ok' : 'vendor_error',
      httpStatus: response.status,
      code: body.code,
    });
    return body;
  }
}

/** Accepts a token string, a list of strings, or a string with several tokens separated by , ; or newlines. */
export function extractTokens(data: unknown): string[] {
  const candidates: string[] = [];
  if (typeof data === 'string') candidates.push(...data.split(/[,;\n]/));
  else if (Array.isArray(data)) for (const d of data) if (typeof d === 'string') candidates.push(d);
  const tokens = candidates.map((c) => c.trim()).filter(Boolean);
  if (tokens.length === 0 || !tokens.every(isStsTokenDigits)) return [];
  return tokens.map(normalizeToken);
}

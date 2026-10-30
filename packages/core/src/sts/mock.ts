import { MOCK_TOKEN_PREFIX } from '../token';
import { StsMeterNotFoundError, StsRejectedError, StsUnknownOutcomeError } from './errors';
import type { IssueRequest, IssueResult, MeterVerification, StatusResult, StsAdapter } from './types';

export interface MockStsOptions {
  /** First sequence number, so mock tokens keep counting up across restarts. */
  startSeq?: number;
  latencyMs?: number;
}

/**
 * Test scenarios, chosen by meter number:
 * - starts with "0000"  → meter not found
 * - ends with "9999"    → vendor rejects the vend (FAILED)
 * - ends with "8888"    → timeout, no token issued (UNKNOWN → status finds nothing)
 * - ends with "6666"    → timeout, but the token WAS issued (UNKNOWN → status finds it)
 * - anything else       → success
 *
 * Tokens are "MOCK dddd dddd dddd dddd" from a counter: never random, never 20 digits,
 * so a mock token cannot be mistaken for, or keyed in as, a real STS token.
 */
export class MockStsAdapter implements StsAdapter {
  readonly mode = 'mock' as const;
  private seq: number;
  private readonly issued = new Map<string, IssueResult>();

  constructor(private readonly opts: MockStsOptions = {}) {
    this.seq = opts.startSeq ?? 0;
  }

  async verifyMeter(meterNo: string): Promise<MeterVerification> {
    await this.delay();
    if (meterNo.startsWith('0000')) throw new StsMeterNotFoundError('Meter not found (mock)', 'MOCK_NOT_FOUND');
    return { meterNo, valid: true, customerName: 'MOCK CUSTOMER', tariffCode: undefined };
  }

  async issueCreditToken(req: IssueRequest): Promise<IssueResult> {
    const previous = this.issued.get(req.clientRef);
    if (previous) return previous;
    await this.delay();

    if (req.meterNo.endsWith('9999')) throw new StsRejectedError('Vend rejected (mock)', 'MOCK_REJECTED');
    if (req.meterNo.endsWith('8888')) throw new StsUnknownOutcomeError('Timed out (mock, no token issued)');

    this.seq += 1;
    const digits = String(this.seq).padStart(16, '0').replace(/(.{4})(?=.)/g, '$1 ');
    const result: IssueResult = {
      tokens: [`${MOCK_TOKEN_PREFIX} ${digits}`],
      vendorRef: `MOCK-REF-${this.seq}`,
      vendorCode: 'MOCK_OK',
      ...(req.by === 'units' ? { units: req.value } : { amount: req.value }),
    };
    this.issued.set(req.clientRef, result);

    if (req.meterNo.endsWith('6666')) throw new StsUnknownOutcomeError('Timed out (mock, token was issued)');
    return result;
  }

  async getTransactionStatus(clientRef: string): Promise<StatusResult> {
    const result = this.issued.get(clientRef);
    return result ? { status: 'succeeded', result } : { status: 'not_found' };
  }

  private delay() {
    const ms = this.opts.latencyMs ?? 0;
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }
}

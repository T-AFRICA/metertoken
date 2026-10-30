import {
  MockStsAdapter,
  StsConfigError,
  StsRejectedError,
  VendorApiStsAdapter,
  type IssueRequest,
  type StsAdapter,
} from '@tronic/core';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config';
import type { Db } from './db';

export const REQUIRED_LIVE_APPROVALS = 2;

const approvalCount = async (db: Db) =>
  Number((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM live_mode_approvals')).rows[0]?.n ?? 0);

/**
 * Mock is the default. Live needs all of: STS_MODE=live, STS_LIVE_ENABLED=true, a valid vendor
 * configuration (HTTPS or VPN host, credentials, success codes) and approval by two admins.
 * If STS_MODE=live but anything is missing, startup fails instead of silently using the mock.
 */
export async function createAdapter(cfg: Config, db: Db, log: FastifyBaseLogger): Promise<StsAdapter> {
  if (cfg.STS_MODE === 'mock') {
    const seq = Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM vends WHERE adapter_mode = 'mock'`)).rows[0]?.n ?? 0);
    return new MockStsAdapter({ startSeq: seq, latencyMs: cfg.NODE_ENV === 'test' ? 0 : 400 });
  }

  if (!cfg.STS_LIVE_ENABLED) throw new StsConfigError('STS_MODE=live requires STS_LIVE_ENABLED=true');
  const approvals = await approvalCount(db);
  if (approvals < REQUIRED_LIVE_APPROVALS) {
    throw new StsConfigError(`STS_MODE=live requires approval by ${REQUIRED_LIVE_APPROVALS} admins in the portal (currently ${approvals})`);
  }

  const vendor = new VendorApiStsAdapter({
    baseUrl: cfg.STS_VENDOR_BASE_URL ?? '',
    userId: cfg.STS_VENDOR_USER_ID ?? '',
    password: cfg.STS_VENDOR_PASSWORD ?? '',
    timeoutMs: cfg.STS_VENDOR_TIMEOUT_MS,
    successCodes: cfg.STS_VENDOR_SUCCESS_CODES,
    rejectCodes: cfg.STS_VENDOR_REJECT_CODES,
    allowInsecureHosts: cfg.STS_VENDOR_ALLOW_INSECURE_HOSTS,
    onCall: (entry) => log.info({ sts: entry }, 'sts vendor call'),
  });

  // Re-checks approvals before every vend so revoking takes effect without a restart.
  return {
    mode: 'live',
    verifyMeter: (meterNo) => vendor.verifyMeter(meterNo),
    getTransactionStatus: () => vendor.getTransactionStatus(),
    issueCreditToken: async (req: IssueRequest) => {
      if ((await approvalCount(db)) < REQUIRED_LIVE_APPROVALS) {
        throw new StsRejectedError('Live vending is not approved (approvals were revoked). No request was sent.');
      }
      return vendor.issueCreditToken(req);
    },
  };
}

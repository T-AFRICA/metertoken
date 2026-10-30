import { describe, expect, it, vi } from 'vitest';
import {
  extractTokens,
  formatToken,
  isStsTokenDigits,
  maskToken,
  MockStsAdapter,
  StsConfigError,
  StsMeterNotFoundError,
  StsRejectedError,
  StsUnknownOutcomeError,
  VendorApiStsAdapter,
  type VendorApiConfig,
  type VendorCallLog,
} from '../src';

const req = { clientRef: 'ref-1', meterNo: '01234567890', by: 'amount' as const, value: '1000.00', currency: 'TZS' as const };
const FAKE_TOKEN = '12345678901234567890'; // test fixture, not a real token

describe('token helpers', () => {
  it('formats and masks', () => {
    expect(formatToken(FAKE_TOKEN)).toBe('1234 5678 9012 3456 7890');
    expect(maskToken(FAKE_TOKEN)).toBe('•••• •••• •••• •••• 7890');
    expect(isStsTokenDigits('1234 5678 9012 3456 7890')).toBe(true);
    expect(isStsTokenDigits('MOCK 0000 0000 0000 0001')).toBe(false);
  });
});

describe('MockStsAdapter', () => {
  it('returns deterministic, non-keyable mock tokens', async () => {
    const a = new MockStsAdapter({ startSeq: 41 });
    const r = await a.issueCreditToken(req);
    expect(r.tokens).toEqual(['MOCK 0000 0000 0000 0042']);
    expect(isStsTokenDigits(r.tokens[0]!)).toBe(false);
  });

  it('is idempotent per clientRef', async () => {
    const a = new MockStsAdapter();
    const r1 = await a.issueCreditToken(req);
    const r2 = await a.issueCreditToken(req);
    expect(r2).toBe(r1);
  });

  it('simulates scenarios by meter number', async () => {
    const a = new MockStsAdapter();
    await expect(a.verifyMeter('00001234567')).rejects.toBeInstanceOf(StsMeterNotFoundError);
    await expect(a.issueCreditToken({ ...req, clientRef: 'r', meterNo: '12345679999' })).rejects.toBeInstanceOf(StsRejectedError);
    await expect(a.issueCreditToken({ ...req, clientRef: 'u', meterNo: '12345678888' })).rejects.toBeInstanceOf(StsUnknownOutcomeError);
    expect(await a.getTransactionStatus('u')).toEqual({ status: 'not_found' });
    await expect(a.issueCreditToken({ ...req, clientRef: 'i', meterNo: '12345676666' })).rejects.toBeInstanceOf(StsUnknownOutcomeError);
    expect((await a.getTransactionStatus('i')).status).toBe('succeeded');
  });
});

describe('VendorApiStsAdapter', () => {
  const secret = 'not-a-real-password';
  const base: VendorApiConfig = {
    baseUrl: 'https://vendor.example.test',
    userId: 'tronic',
    password: secret,
    timeoutMs: 1000,
    successCodes: [0],
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('refuses plain HTTP unless the host is an allowed VPN host', () => {
    expect(() => new VendorApiStsAdapter({ ...base, baseUrl: 'http://120.26.4.119:9094' })).toThrow(StsConfigError);
    expect(() => new VendorApiStsAdapter({ ...base, baseUrl: 'http://10.8.0.5:9094', allowInsecureHosts: ['10.8.0.5'] })).not.toThrow();
    expect(() => new VendorApiStsAdapter({ ...base, successCodes: [] })).toThrow(StsConfigError);
  });

  it('builds the documented GetVendingToken query', async () => {
    const fetchImpl = vi.fn(async () => json({ code: 0, message: 'ok', data: FAKE_TOKEN }));
    const a = new VendorApiStsAdapter({ ...base, fetchImpl });
    const r = await a.issueCreditToken({ ...req, by: 'units', value: '5.00' });
    expect(r.tokens).toEqual([FAKE_TOKEN]);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/api/Power/GetVendingToken');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      MeterType: '1',
      MeterCode: req.meterNo,
      AmountOrQuantity: '5.00',
      VendingType: '1',
    });
  });

  it('sends a timed-out vend exactly once and reports an unknown outcome', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error(`connect failed https://vendor.example.test/?Password=${secret}`), { name: 'TimeoutError' });
    });
    const logs: VendorCallLog[] = [];
    const a = new VendorApiStsAdapter({ ...base, fetchImpl, onCall: (l) => logs.push(l) });
    const err = await a.issueCreditToken(req).catch((e) => e);
    expect(err).toBeInstanceOf(StsUnknownOutcomeError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(err.message)).not.toContain(secret);
    expect(JSON.stringify(logs)).not.toContain(secret);
    expect(logs[0]?.outcome).toBe('timeout');
  });

  it('treats unlisted vendor error codes as unknown and listed ones as rejected', async () => {
    const a = new VendorApiStsAdapter({ ...base, rejectCodes: [5], fetchImpl: async () => json({ code: 7, message: 'x' }) });
    await expect(a.issueCreditToken(req)).rejects.toBeInstanceOf(StsUnknownOutcomeError);
    const b = new VendorApiStsAdapter({ ...base, rejectCodes: [5], fetchImpl: async () => json({ code: 5, message: 'x' }) });
    await expect(b.issueCreditToken(req)).rejects.toBeInstanceOf(StsRejectedError);
  });

  it('treats success without a valid token as unknown', async () => {
    const a = new VendorApiStsAdapter({ ...base, fetchImpl: async () => json({ code: 0, data: { something: 1 } }) });
    await expect(a.issueCreditToken(req)).rejects.toBeInstanceOf(StsUnknownOutcomeError);
  });

  it('extracts several tokens', () => {
    expect(extractTokens(`${FAKE_TOKEN},${FAKE_TOKEN}`)).toHaveLength(2);
    expect(extractTokens('12345')).toEqual([]);
  });
});

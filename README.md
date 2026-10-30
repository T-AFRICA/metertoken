# Tronic STS Electricity Token Portal

Staff/agent portal to verify a meter, enter units, see the automatic amount, generate an STS electricity token, and print a receipt — with role-based access, configurable tariffs, duplicate protection and a tamper-evident audit log.

> **Mock mode by default.** Until the vendor authorises Tronic to use its "STS Vend System API", every token is a clearly marked `MOCK …` value that cannot be entered into a meter. The portal never generates tokens itself and never imitates STS cryptography. See [docs/STS_INTEGRATION_ARCHITECTURE.md](docs/STS_INTEGRATION_ARCHITECTURE.md) §10.

## Layout

| Path | What |
|---|---|
| `packages/core` | Tariff maths, token helpers, `StsAdapter` interface, `MockStsAdapter`, `VendorApiStsAdapter` (disabled by default) |
| `apps/api` | Fastify API: auth + roles, meters, quotes, vends, admin, reports, audit. PostgreSQL (PGlite in development) |
| `apps/web` | Next.js UI: vend screen, receipt (80 mm), history, admin pages |
| `docs/` | Analysis of the existing STS system, vendor API notes, architecture, vendor requirements, website link guide |

## Run locally (development)

Requirements: Node.js 22+. No database install needed (embedded PGlite).

```bash
npm install
```

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`: set `TOKEN_ENC_KEY` (command is in the file) and `BOOTSTRAP_ADMIN_PASSWORD` (10+ characters). Then, in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:3000 and sign in as `admin`. With `SEED_SAMPLE_TARIFF=true` a **sample** tariff exists so the vend screen works; replace it under Tariffs.

### Mock test meters
| Meter number | Result |
|---|---|
| any 11/13 digits | Success (MOCK token) |
| starts with `0000` | Meter not found |
| ends with `9999` | Vendor rejects → FAILED |
| ends with `8888` | Timeout, no token → UNKNOWN → supervisor resolves |
| ends with `6666` | Timeout, token was issued → recovered automatically by the status sweep |

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

## Roles

| Role | Can |
|---|---|
| cashier | Verify meter, quote, generate token, print own receipts (token visible for 24 h) |
| supervisor | + approve possible duplicates, resolve UNKNOWN vends, reprint any, reports |
| admin | + users, tariffs (a different admin must approve), live-mode approval, activity log |
| auditor | Read-only history (no tokens), reports, activity log |

## Vend safety rules (built in)
- Price is calculated on the server from the active tariff; the browser never sends a price.
- `Idempotency-Key` per Generate click; a repeated request returns the same result.
- One open vend per meter; no second vend for the same meter within 60 s (meters reject two tokens from the same minute with `USED`); same amount within 5 min needs a supervisor.
- A vend is sent to the STS service once. Timeouts become `UNKNOWN` and are never retried automatically.
- Tokens are encrypted at rest (AES-256-GCM), masked in lists, never exported or logged.

## Going live (later)
1. Vendor: written authorization, vend-only API account, HTTPS or VPN, response/error documentation — see [docs/STS_VENDOR_API_REQUIREMENTS.md](docs/STS_VENDOR_API_REQUIREMENTS.md) §12.
2. Fill `STS_VENDOR_*` in the server environment; set `STS_MODE=live`, `STS_LIVE_ENABLED=true`.
3. Two admins approve in **Settings**; restart the API. Test on a test meter first.

## Production checklist
- PostgreSQL (`DATABASE_URL`), HTTPS reverse proxy, API on localhost only.
- `TOKEN_ENC_KEY` in a secrets manager; daily DB backups and a restore test.
- Remove `BOOTSTRAP_ADMIN_PASSWORD` after the first start; `SEED_SAMPLE_TARIFF=false`.
- Add two-factor login for supervisors/admins before exposing the login page publicly.
- Website link: [docs/WEBSITE_LINK_GUIDE.md](docs/WEBSITE_LINK_GUIDE.md).

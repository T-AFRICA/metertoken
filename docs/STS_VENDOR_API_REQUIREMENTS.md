# STS Vendor API Requirements

**For:** the vendor/operator of the STS vending system at `120.26.4.119:9110`
**From:** Tronic (portal integrator)
**Date:** 2026-10-30
**Purpose:** Request an **authorized server-to-server integration** so the Tronic portal can issue tokens through the existing STS vending service — without automating the operator web UI and without rebuilding the vending engine.

---

## 1. What we are asking for (summary)

1. Written authorization for Tronic to integrate as a vending agent / third-party channel.
2. An official, documented **server-to-server vending API** with a **sandbox** and **test meters**.
3. **HTTPS** (or VPN) transport, service credentials, and IP allow-listing.
4. **Idempotent** vend requests and a **transaction status** query.
5. Daily **reconciliation** data.

---

## 2. Required API capabilities

| # | Capability | Minimum contract we need | Priority |
|---|---|---|---|
| R1 | **Verify meter** | Input: meter number. Output: valid/invalid, meter status (active/blocked), customer display name (optional, masked), tariff code/index, supply group code, key revision number, whether a key-change is pending. | Must |
| R2 | **Quote / tariff calculation** | Input: meter number + units **or** amount. Output: units, amount, tax/levy breakdown, tariff version. (Lets the portal show the exact vendor price before vending.) | Should |
| R3 | **Issue credit token** | Input: `clientRef` (our UUID, idempotency key), meter number, amount or units, currency, operator/outlet ID. Output: one or more tokens (incl. key-change tokens if required), `vendorRef`, units credited, amount charged, tax breakdown, token TID/issue time, receipt number. | Must |
| R4 | **Idempotency** | Repeating R3 with the same `clientRef` returns the **original** result and never issues a second token or charge. | Must |
| R5 | **Transaction status** | Query by `clientRef` or `vendorRef` → `NOT_FOUND`, `PROCESSING`, `SUCCEEDED` (with tokens), `FAILED` (with reason). | Must |
| R6 | **Reprint / retrieve** | Retrieve a past transaction's receipt data by reference (authorized roles only). | Should |
| R7 | **Transaction history / reconciliation** | List transactions for our agent account by date range (paged) **or** a daily file (CSV/JSON via SFTP/HTTPS). | Must |
| R8 | **Agent balance / float** | Current balance and low-balance threshold, if the agent pre-funds. | Should |
| R9 | **Health** | Unauthenticated or lightweight health endpoint. | Should |
| R10 | **Error catalogue** | Stable machine-readable error codes (meter not found, meter blocked, insufficient float, amount below min / above max, key revision mismatch, duplicate clientRef with different payload, auth failure, rate limited, internal error) with retryable flag. | Must |

### Example of the R3 shape we would like (illustrative — vendor defines the real one)

```http
POST /api/v1/vends HTTPS
Authorization: <service credential>
Idempotency-Key: 6f1c…-uuid
Content-Type: application/json

{ "clientRef": "6f1c…-uuid", "meterNo": "…", "amount": "1000.00", "currency": "TZS", "outletId": "TRONIC-001" }
```
```json
{ "status": "SUCCEEDED", "vendorRef": "V2026…", "tokens": [{ "type": "CREDIT", "value": "XXXX XXXX XXXX XXXX XXXX", "units": "2.81" }],
  "amount": "1000.00", "breakdown": { "energy": "…", "vat": "…", "levies": "…" }, "issuedAt": "2026-…Z", "receiptNo": "…" }
```

---

## 3. Security requirements

| # | Requirement |
|---|---|
| S1 | **TLS 1.2+** with a valid certificate on a hostname, **or** site-to-site VPN / private link. Plain HTTP is not acceptable for credentials or tokens. |
| S2 | Service authentication: **mTLS** or **OAuth 2.0 client credentials** or HMAC-signed requests. Not a human username/password, not a browser session. |
| S3 | Separate credentials for sandbox and production; rotation procedure; revocation on request. |
| S4 | IP allow-listing of Tronic's egress IPs. |
| S5 | Per-agent and per-outlet identification in each request for audit on the vendor side. |
| S6 | Rate limits and timeout guidance (expected p95 latency, maximum processing time). |
| S7 | Replay protection (timestamp/nonce if HMAC). |
| S8 | No STS keys, decoder keys or secure-module access are requested or needed by Tronic. |
| S9 | Notice period (e.g. 30 days) and versioning for breaking changes. |

---

## 4. STS / metering compliance questions

1. Which IEC 62055-41 edition and token classes are supported? Can R3 return **key-change tokens** together with the credit token when a meter's key revision must be updated?
2. Is the system **TID-rollover compliant** (post-24 Nov 2024 base date), and are the target meters on key revision ≥ 2?
3. Supported meter number lengths and check-digit validation.
4. Which utility/KMC is the system registered with, and in which countries (Kenya, Tanzania, Uganda, Rwanda)?
5. Are free/engineering tokens (e.g. clear tamper) available to agents? (Tronic does not need them initially.)

---

## 5. Commercial / operational questions

1. Agent model: pre-funded float, post-paid settlement, or commission?
2. Who is the seller of record for tax/fiscal receipt purposes (KRA eTIMS, TRA EFD/VFD, URA EFRIS, RRA EBM)?
3. Support hours, escalation contacts, SLA for availability and incident response.
4. Reconciliation file timing (e.g. by 02:00 EAT daily) and dispute process for `UNKNOWN` transactions.
5. Reversal/cancellation policy (normally none for STS tokens — confirm).
6. Data protection: what customer data is returned, retention limits, DPA/data-sharing agreement.

---

## 6. Questions about the existing web system (to clarify our analysis)

1. Is `POST /ElectricManage/ElectricVend/GetToken` intended for third-party use? (We assume **not** and will not use it without written approval.)
2. Meaning of `Id` and of each `VendType` value; is `Amount` recomputed server-side from `Energy`?
3. Purpose and parameters of `GET /ElectricVend/GetBillByContractId`.
4. Is there a reference/receipt number for each vend, and how do operators look up a vend that timed out?
5. Is HTTPS available on this system, and are anti-forgery (CSRF) protections applied to JSON actions?

---

## 7. Verified findings (basis for this request)
- The only interface known to Tronic is an operator web UI over plain HTTP; vending is one session-authenticated POST that returns the token directly without a reference number or idempotency key.

## 8. Assumptions
- The vendor product has or can provide a third-party/agent API (common for bank and mobile-money channels).

## 9. Missing information
- Everything in §2–§6 until the vendor responds.

## 10. Vendor-dependent requirements
- All of §2 (R1, R3, R4, R5, R7, R10 are mandatory) and §3.

## 11. Production blockers (until resolved by the vendor)
1. No written authorization.
2. No HTTPS/VPN channel.
3. No idempotency or status query.
4. No sandbox/test meters.
5. No reconciliation data.

---

## Appendix — draft message to the vendor

> Subject: Request for third-party vending API access — Tronic
>
> Hello,
>
> Tronic is building a vending portal for our outlets and would like to integrate with your STS vending service through an official, authorized channel rather than the operator web interface.
>
> Could you please share: (1) your third-party/agent vending API documentation, (2) sandbox access with test meters, (3) the authentication method (mTLS, OAuth client credentials or signed requests) and HTTPS/VPN options, (4) how duplicate requests are handled (idempotency / client reference) and how to query a transaction's status after a timeout, and (5) daily reconciliation report formats.
>
> We will not automate the operator web interface. Please also tell us the commercial and authorization steps needed for Tronic to be registered as a vending agent.
>
> Regards,
> Tronic

---

## 12. Update 2026-10-30 — questions about the published "STS Vend System API" (port 9094)

We found the vendor's OpenAPI document at `http://120.26.4.119:9094/swagger/v1/swagger.json`. We have **not called any operation**. Before using it we need:

**Authorization and accounts**
1. Written confirmation that Tronic may integrate using this API for electricity vending.
2. A **dedicated API account** for Tronic, restricted to `GetContractInfo`, `GetVendingToken` (MeterType 1) and `UseTypeList` — **without** permission for clear-credit, clear-tamper, max-power, change-decoder tokens, meter register/update/delete or use-type management.
3. Confirmation whether API accounts are separate from web-portal logins.

**Transport and credentials**
4. HTTPS on port 9094 (valid certificate, TLS 1.2+), or a site-to-site VPN plus IP allow-listing of Tronic's egress IPs.
5. A header-based or signed credential instead of `UserId`/`Password` in the query string — or, at minimum, confirmation that query strings are excluded from server logs.
6. Platform/patch status of the IIS 7.5 host.

**Contract**
7. Response schemas and example responses (with masked tokens) for `GetVendingToken`, `GetContractInfo`, `UseTypeList`; full list of `code` values and messages.
8. Does `GetVendingToken` return a transaction/receipt number, units, amount, tax breakdown and any extra key-change tokens?
9. Rounding: how `AmountOrQuantity` (double) is rounded; currency; minimum/maximum vend.
10. Idempotency: can a client reference be added to `GetVendingToken`? Ideally make vending a `POST` with an `Idempotency-Key`.
11. Status/history: an electricity equivalent of `WaterVend/PageVend` (vends by meter and date range) and a lookup by client reference.
12. Does `GetVendingToken` itself block a second vend for the same meter within one minute (meters reject same-minute tokens with `USED`)?
13. `Kmf/ListSgcByMeterType` declares no credentials — is it intended to be public?
14. Sandbox host or test meters for certification; rate limits; change-notice policy.

**Meter fleet (from the "L type" meter manual)**
15. Key revision (KRN) and TID-rollover status of the installed meters; how key-change tokens are delivered if a vend requires one.

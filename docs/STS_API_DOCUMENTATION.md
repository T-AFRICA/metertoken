# STS Vending System — API Contract Reconstruction

**Target:** `http://120.26.4.119:9110`
**Date:** 2026-10-30
**Important:** These are **browser-observed internal routes of an operator web application**, not a published or confirmed API. They are documented to understand the system and to brief the vendor — **not** as an integration target. The new portal must not call them without written vendor authorization (see `STS_INTEGRATION_ARCHITECTURE.md`).

No live capture of the web UI has been made yet. Only what the user observed is marked *Observed*.

> **Update 2026-10-30 — published API found.** The user supplied `http://120.26.4.119:9094/swagger/index.html`. Its OpenAPI 3.0.1 document, titled **"STS Vend System API" v1**, was downloaded (two read-only GETs of the documentation; **no API operation was called**) and saved as `evidence/sts_vend_api_swagger_v1.json` (SHA-256 `bb62d6aa…f624e`). It is documented in **§7**. This API, not the web routes, is the realistic integration target. Everything in §7 is *Documented* (stated in the vendor's own spec) but **not yet exercised**.

**Status legend**

| Status | Meaning |
|---|---|
| **Observed** | The user saw this request in their own browser. |
| **Inferred** | Reasoned from observed facts; route and/or shape not seen. |
| **Not Found** | No evidence at all. No route is invented here. |

---

## 1. Capability matrix

| Capability | Web UI `:9110` (internal routes) | Published API `:9094` (see §7) |
|---|---|---|
| Login / auth | Observed (route only): `GET /Account/Login` | **Documented:** `UserId` + `Password` passed as **query parameters** on every call. No security scheme declared. |
| Meter verification | **Not Found** | **Documented:** `GET /api/Power/GetContractInfo` (contract information of the meter) |
| Customer / contract lookup | Observed (route only): `GET /ElectricVend/GetBillByContractId` | **Documented:** `GET /api/Power/GetContractInfo` |
| Tariff and amount calculation | **Not Found** | **Inferred:** `GET /api/UseType/UseTypeList` ("use type" ≈ tariff category). No quote endpoint. Server computes the other value from `AmountOrQuantity` + `VendingType`. |
| Token generation | **Observed:** `POST /ElectricManage/ElectricVend/GetToken` | **Documented:** `GET /api/Power/GetVendingToken` |
| Token status | **Not Found** | **Not Found** |
| Transaction history | Inferred: possibly `GetBillByContractId` | **Not Found for electricity.** Only `POST /api/WaterVend/PageVend` (water). |
| Receipt | **Not Found** | **Not Found** |

---

## 2. `POST /ElectricManage/ElectricVend/GetToken` — **Observed**

### 2.1 Request

| Field | Value |
|---|---|
| Method | `POST` |
| Path | `/ElectricManage/ElectricVend/GetToken` |
| Content-Type | `application/json` (Inferred from the JSON body; exact header incl. charset not captured) |
| Auth | Session cookie set at login (Inferred). Anti-forgery header/field: Unknown. |
| Caller | Browser XHR/fetch from the vending page. |

**Body (illustrative values from the user; not test data):**

```json
{
  "Id": "<record id>",
  "MeterCode": "<meter number>",
  "VendType": 0,
  "Amount": "1781.200",
  "Energy": "5.0"
}
```

| Parameter | Observed JSON type | Meaning | Status |
|---|---|---|---|
| `Id` | unknown (value not recorded) | Server-issued record ID of the meter, customer or contract, loaded by an earlier lookup. Not a transaction ID. | Inferred |
| `MeterCode` | string (assumed) | STS meter serial number (typically 11 or 13 digits). | Inferred |
| `VendType` | number | Vend type enum. `0` most likely = normal credit purchase (STS Class 0 "transfer credit"). Other values may cover free/engineering tokens or vend-by-amount vs vend-by-energy. | Inferred |
| `Amount` | **string**, 3 decimals | Money amount. Currency unknown. | Observed type |
| `Energy` | **string**, 1 decimal | Units in kWh. | Observed type / Inferred unit |

### 2.2 Response — success (Observed)

```json
{
  "state": "success",
  "message": "Get token successfully",
  "data": "XXXX XXXX XXXX XXXX XXXX"
}
```

| Field | Type | Meaning |
|---|---|---|
| `state` | string | `"success"` on success. Failure values Unknown (likely `"error"` / `"fail"`). |
| `message` | string | Human-readable message. |
| `data` | string | One 20-digit STS token formatted as 5 × 4 digits. |

**Not present in the response:** transaction/receipt number, units actually credited, amount actually charged, tariff applied, timestamp, token identifier (TID), meter echo. Any of these may be visible elsewhere in the UI.

### 2.3 Errors — Unknown

To capture without vending: none possible. Ask the vendor for the full list (insufficient balance/float, meter not found, meter blocked, key revision mismatch, amount below minimum, session expired, duplicate request).

Expected behaviour on session expiry for this style of app: a `302` redirect to `/Account/Login` or an HTML login page returned with `200` — **a client must not mistake HTML for a failed or successful vend**. Unconfirmed.

### 2.4 Dependencies

- Requires a valid logged-in session.
- Requires `Id` from a prior lookup (route Not Found).
- Probably requires vendor credit/float on the operator account (Unknown).

### 2.5 Transaction IDs and idempotency

- No client-supplied idempotency key in the request.
- No server reference in the response.
- **Assume every call creates a new token and a new charge.** Two clicks = two tokens.

---

## 3. `GET /ElectricVend/GetBillByContractId` — **Observed (route only)**

| Field | Value |
|---|---|
| Method | `GET` |
| Path | `/ElectricVend/GetBillByContractId` (note: no `/ElectricManage` area prefix as reported — may be a relative URL resolved under the area, or a different route; confirm in capture) |
| Query parameters | Unknown. Name suggests a contract ID, e.g. `?contractId=…` or `?Id=…`. **Not confirmed — do not use.** |
| Response | Unknown. Likely the `{state, message, data}` envelope with `data` as a list of bill/vend records, or a grid-paging shape (`{total, rows}`). |
| Auth | Session cookie (Inferred). |
| Purpose | Bills or vend history for a customer contract (Inferred). Possible source for receipt reprint and transaction history. |

Note the risk: if bill records include past tokens, this endpoint returns tokens in cleartext over HTTP.

---

## 4. Login — **Observed (route only)**

`GET /Account/Login` returns the login page. The credential POST is intentionally **not** analysed or documented: it carries the password and sets the session.

---

## 5. Common conventions (Inferred)

| Convention | Inference |
|---|---|
| Route pattern | `/{Area}/{Controller}/{Action}` (ASP.NET MVC). |
| Envelope | `{ state: string, message: string, data: any }`. |
| Numbers | Monetary and energy values sent as **strings** with fixed decimals. |
| Errors | Probably HTTP 200 with `state != "success"`; framework errors as HTTP 500 HTML pages. |
| CORS | Not expected to allow cross-origin calls (no reason for the vendor to have enabled it). Unverified. |

---

## 6. Verified findings / Assumptions / Missing / Vendor-dependent / Blockers

### Verified
- `GetToken` route, method, request keys, `VendType` numeric, `Amount`/`Energy` as strings, success envelope, token returned directly as 5×4 digits.
- `GetBillByContractId` route exists and is called with `GET`.

### Assumptions
- Session-cookie auth; JSON content type; `Id` is a server record ID; `VendType 0` = normal credit vend; each call is non-idempotent.

### Missing information
- Meter verification, tariff, status, history and receipt routes.
- `GetBillByContractId` parameters and response.
- All error shapes; `VendType` enum; currency; rounding rules; session timeout; CSRF requirement.

### Vendor-dependent requirements
- An official, documented server-to-server API replacing all of the above (see `STS_VENDOR_API_REQUIREMENTS.md`).
- If the vendor instead authorizes use of these routes, it must supply the contract in writing, a service account, and HTTPS.

### Production blockers
- These routes are an **undocumented internal UI contract**; they can change without notice.
- Using them server-side would require login automation or session reuse — **not permitted**.
- Plain HTTP; no idempotency; no transaction reference.

---

## 7. Published "STS Vend System API" — `http://120.26.4.119:9094`

**Source:** `GET /swagger/v1/swagger.json` (OpenAPI 3.0.1, title "STS Vend System API", description "The API for STS vend system", version v1). Server headers on the documentation responses: `Server: Microsoft-IIS/7.5`, `X-Powered-By: ASP.NET`. No `servers`, no `securitySchemes`, no global `security` are declared. **No operation below has been called.**

### 7.1 Operation inventory

| Method | Path | Summary (vendor's wording) | Relevance to portal |
|---|---|---|---|
| GET | `/api/Power/GetVendingToken` | Get the token of recharge | **Core** — token generation |
| GET | `/api/Power/GetContractInfo` | Get the contract information of the meter | **Core** — meter verification / lookup |
| GET | `/api/UseType/UseTypeList` | Get the use type list | Useful — tariff categories (read-only) |
| GET | `/api/Kmf/ListSgcByMeterType` | List SGC by meter type | Optional — supply group codes (metadata, not keys) |
| GET | `/api/Power/GetClearCreditToken` | Get the token of clear credit | **Exclude** — management token |
| GET | `/api/Power/GetClearTamperSignToken` | Get the token of clear tamper sign | **Exclude** — management token |
| GET | `/api/Power/GetMaxPowerToken` | Get the token of set max power | **Exclude** — management token |
| GET | `/api/Power/GetChangeDecoderToken` | Get the token of change decoder key | **Exclude** — key-change token |
| POST | `/api/Power/MeterRegister` | Register the meter (multipart/form-data) | Out of scope |
| POST | `/api/Power/MeterUpdate` | Update the meter (multipart/form-data) | Out of scope |
| POST | `/api/Power/MeterDelete` | Delete the meter (multipart/form-data) | Out of scope |
| POST | `/api/UseType/AddUseType` / `UpdateUseType` / `DeleteUseType` | Manage use types (multipart/form-data) | Out of scope |
| POST | `/api/WaterVend/PageVend` | Page by page query of water vend records | Water only — pattern the vendor could add for electricity |

### 7.2 `GET /api/Power/GetVendingToken` — Documented

| Query parameter | Type / constraint | Required | Vendor description |
|---|---|---|---|
| `UserId` | string | yes | The user id |
| `Password` | string | yes | The password |
| `MeterType` | int32, pattern `^[12]$` | yes | 1 = electric, 2 = water |
| `MeterCode` | string, maxLength 13 | yes | The meter code |
| `AmountOrQuantity` | number (double) | yes | Amount or quantity, determined by `VendingType` |
| `VendingType` | int32, pattern `^[01]$` | yes | **0 = amount, 1 = quantity** |

- **Response:** `200 OK` with **no schema declared**. Most likely the same envelope as other operations (`RichResult`: `{ code: int, message: string, data: any }`) with the token in `data` — **unconfirmed**. Whether `data` also carries units, amount, a transaction number or multiple tokens is unknown.
- **No** client reference, idempotency key, outlet ID or currency parameter.
- Comparison with the web UI: web `VendType: 0` very probably maps to this `VendingType 0 = amount` — the web form sends `Amount` as the driver and `Energy` for display. (Inferred.)

### 7.3 `GET /api/Power/GetContractInfo` — Documented

Query: `UserId`, `Password`, `MeterType` (1/2), `MeterCode` — all required. Response: `200 OK`, schema not declared. Expected (unconfirmed): customer/contract, use type (tariff), SGC, KRN/TI, status.

### 7.4 `GET /api/UseType/UseTypeList` — Documented

Query: `userId` (string, max 10), `password` (string, max 20) — required. Response schema not declared. Likely the list of tariff categories with prices.

### 7.5 `GET /api/Kmf/ListSgcByMeterType` — Documented

Query: `meterType` (1/2) — required. **No credential parameters are declared** for this operation. Returns SGC list (supply group codes are identifiers, not secret keys). Not to be probed; report to the vendor as a question.

### 7.6 `POST /api/WaterVend/PageVend` — Documented (water only)

Query: `PageNumber` (≥1), `PageSize` (1–100). Body `WaterVendDTO`: `userId` (1–10), `password` (1–20), `meterCode` (1–13), `startDate`, `endDate` (`yyyy-MM-dd`). Response `RichResult { code:int32, message:string|null, data:any|null }`. This is the only paged-history operation; an electricity equivalent should be requested.

### 7.7 Common conventions (Documented / Inferred)

| Item | Finding |
|---|---|
| Envelope | `RichResult { code, message, data }` (Documented for PageVend). Note the web UI uses `{ state, message, data }` — different. |
| Auth | Account credentials in **every request's query string** (Documented). |
| Meter code | ≤ 13 characters (Documented). |
| User ID / password lengths | ≤ 10 / ≤ 20 characters (Documented). |
| Transport | Plain HTTP on port 9094, IIS 7.5 (Observed on documentation responses). |
| Error codes | Not documented. |

### 7.8 Security observations (from the spec only — nothing was tested)

1. **Credentials in the URL over plain HTTP.** Query strings are written to IIS access logs, proxy logs and monitoring tools, and are visible to anyone on the network path. The account password should be considered exposed to the vendor's infrastructure logs by design.
2. **Token issuance via `GET`.** HTTP clients, proxies and some libraries treat `GET` as safe and *retry it automatically*; a silent retry here could mean a second token and a second debit. The portal's HTTP client must have retries **disabled** for this call.
3. **No idempotency, no status query, no electricity history** → a timeout leaves the outcome unknown with no API to resolve it.
4. **Management token operations share the same credential.** An account able to call `GetVendingToken` may also be able to issue clear-credit / clear-tamper / max-power / key-change tokens and to register or delete meters. The vendor should issue a **vend-only** API account.
5. **`ListSgcByMeterType` declares no credentials.** Possibly unauthenticated. Ask, don't test.
6. **IIS 7.5** ships with Windows Server 2008 R2 (end of support January 2020; extended updates ended January 2023). Ask the vendor about the hosting platform and patch level.
7. Swagger UI is publicly reachable in production — common, but it advertises management operations.

### 7.9 Separated findings for the published API

**Verified (from the vendor's own OpenAPI document)**
- Operation list, parameter names, types and constraints in §7.1–7.6; `VendingType` 0 = amount, 1 = quantity; `MeterType` 1 = electric; credentials passed as query parameters; `RichResult` envelope for PageVend; HTTP only; IIS 7.5.

**Assumptions**
- `GetVendingToken` returns the token in `RichResult.data`; it is not idempotent; `GetContractInfo` is read-only; the web UI and the API share the same back end and accounts.

**Missing information**
- Response schemas for every `Power` and `UseType` operation; error codes; whether `data` includes a transaction number, units, amount or extra key-change tokens; rate limits; whether API accounts are separate from web logins; sandbox.

**Vendor-dependent requirements**
- Written authorization to use this API; a **vend-only** account; HTTPS or VPN; idempotency (client reference) or at least a status/history query for electricity vends; documented responses and errors.

**Production blockers**
- Credentials in cleartext URLs; `GET` for token issuance; no way to resolve a timed-out vend; management operations reachable with the same credential.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('cashier', 'supervisor', 'admin', 'auditor')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- id is the SHA-256 of the cookie value; the raw session id is never stored.
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('KES', 'TZS', 'UGX', 'RWF')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Maker-checker: a version becomes active only when a different admin approves it.
CREATE TABLE tariff_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_id uuid NOT NULL REFERENCES tariffs(id),
  base_rate numeric(18, 4) NOT NULL CHECK (base_rate > 0),
  percent_charges jsonb NOT NULL DEFAULT '[]',
  fixed_charges jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);
CREATE UNIQUE INDEX tariff_one_active_idx ON tariff_versions(tariff_id) WHERE status = 'active';

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  meter_no text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('units', 'amount')),
  units numeric(18, 2) NOT NULL,
  amount numeric(18, 3) NOT NULL,
  currency text NOT NULL,
  tariff_version_id uuid NOT NULL REFERENCES tariff_versions(id),
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE vends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ref uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  quote_id uuid NOT NULL UNIQUE REFERENCES quotes(id),
  user_id uuid NOT NULL REFERENCES users(id),
  meter_no text NOT NULL,
  mode text NOT NULL,
  units numeric(18, 2) NOT NULL,
  amount numeric(18, 3) NOT NULL,
  currency text NOT NULL,
  lines jsonb NOT NULL,
  tariff_version_id uuid NOT NULL REFERENCES tariff_versions(id),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'MANUAL_REVIEW')),
  adapter_mode text NOT NULL CHECK (adapter_mode IN ('mock', 'live')),
  vendor_ref text,
  vendor_code text,
  token_enc text,
  token_last4 text,
  error_message text,
  duplicate_confirmed_by uuid REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  completed_at timestamptz
);
-- At most one unresolved vend per meter.
CREATE UNIQUE INDEX vends_one_open_per_meter_idx ON vends(meter_no)
  WHERE status IN ('PENDING', 'SUBMITTED', 'UNKNOWN', 'MANUAL_REVIEW');
CREATE INDEX vends_meter_created_idx ON vends(meter_no, created_at DESC);
CREATE INDEX vends_created_idx ON vends(created_at DESC);

CREATE TABLE vend_attempts (
  id bigserial PRIMARY KEY,
  vend_id uuid NOT NULL REFERENCES vends(id),
  operation text NOT NULL,
  outcome text NOT NULL,
  latency_ms integer,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipt_prints (
  id bigserial PRIMARY KEY,
  vend_id uuid NOT NULL REFERENCES vends(id),
  user_id uuid NOT NULL REFERENCES users(id),
  reprint boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

-- Append-only, hash-chained. In production, grant the app role INSERT and SELECT only.
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text,
  entity_id text,
  detail jsonb,
  payload text NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE INDEX audit_events_at_idx ON audit_events(at DESC);

-- Live STS mode needs approval from two different admins (plus the environment flag).
CREATE TABLE live_mode_approvals (
  admin_id uuid PRIMARY KEY REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now()
);

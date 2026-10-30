-- Registered customers buy tokens for their own meter from a prepaid balance.
-- Staff top the balance up at the counter after taking payment; there is no payment gateway.
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_no text NOT NULL UNIQUE,
  name text NOT NULL,
  phone text,
  pin_hash text NOT NULL,
  balance numeric(18, 3) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- id is the SHA-256 of the cookie value, as for staff sessions.
CREATE TABLE customer_sessions (
  id text PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX customer_sessions_customer_idx ON customer_sessions(customer_id);

-- Every balance change. amount is signed: top-ups and refunds add, purchases subtract.
CREATE TABLE customer_ledger (
  id bigserial PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id),
  kind text NOT NULL CHECK (kind IN ('topup', 'purchase', 'refund')),
  amount numeric(18, 3) NOT NULL,
  balance_after numeric(18, 3) NOT NULL,
  vend_id uuid REFERENCES vends(id),
  user_id uuid REFERENCES users(id),
  idempotency_key text UNIQUE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_ledger_customer_idx ON customer_ledger(customer_id, created_at DESC);

ALTER TABLE vends ADD COLUMN customer_id uuid REFERENCES customers(id);
CREATE INDEX vends_customer_idx ON vends(customer_id, created_at DESC) WHERE customer_id IS NOT NULL;

-- Customer purchases run through the same quote and vend pipeline under this account.
-- It is inactive with an unusable password hash, so nobody can sign in as it.
INSERT INTO users (username, display_name, password_hash, role, active)
VALUES ('self-service', 'Customer self-service', '!', 'cashier', false);

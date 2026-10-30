-- Landlords sign in like staff but see and manage only their own tenants.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('cashier', 'supervisor', 'admin', 'auditor', 'landlord'));

-- Which landlord a tenant belongs to. NULL for tenants Tronic manages directly.
ALTER TABLE customers ADD COLUMN landlord_id uuid REFERENCES users(id);
CREATE INDEX customers_landlord_idx ON customers(landlord_id);

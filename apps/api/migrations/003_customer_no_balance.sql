-- Customers no longer pay from a portal balance: the tenant settles payment outside the portal.
-- Each customer's tokens stay on record through vends.customer_id.
DROP TABLE customer_ledger;
ALTER TABLE customers DROP COLUMN balance;

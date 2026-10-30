-- Registered customers are tenants of a landlord; the self-service account shows up as the operator on their tokens.
UPDATE users SET display_name = 'Tenant self-service' WHERE username = 'self-service';

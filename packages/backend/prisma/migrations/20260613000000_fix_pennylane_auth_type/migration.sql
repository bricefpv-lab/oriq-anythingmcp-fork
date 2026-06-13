-- Fix Pennylane connectors: wrong base_url and missing X-Use-2026-API-Changes header.
--
-- Root cause: base_url was https://app.pennylane.com and tool paths were /api/v2/...
-- This produced URLs like https://app.pennylane.com/api/v2/customer_invoices, but
-- the Pennylane external API lives at https://app.pennylane.com/api/external/v2/...
-- Without /external in the path, requests hit the Pennylane web SPA which returns
-- HTML instead of JSON, regardless of the Authorization token.
--
-- auth_type is already OAUTH2 (correct). auth_config is populated (encrypted blob).
-- oauthTokenOverride injection via X-OAuth-Token header already works correctly.
--
-- Fix:
--   1. base_url: https://app.pennylane.com → https://app.pennylane.com/api/external/v2
--   2. tool paths: strip /api/v2 prefix (e.g. /api/v2/customer_invoices → /customer_invoices)
--   3. headers: add X-Use-2026-API-Changes: true (required since Pennylane's 2026 rollout)
--
-- Safe to run repeatedly:
--   - base_url update is idempotent (overwrites with same value if already fixed)
--   - path update only matches paths starting with /api/v2/

-- Step 1: fix base_url and add header
UPDATE connectors
SET
  base_url = 'https://app.pennylane.com/api/external/v2',
  headers  = COALESCE(headers, '{}'::jsonb) || '{"X-Use-2026-API-Changes":"true"}'::jsonb
WHERE id IN (
  SELECT DISTINCT connector_id
  FROM   mcp_tools
  WHERE  name LIKE 'pennylane_%'
);

-- Step 2: strip /api/v2 prefix from tool endpoint paths
-- /api/v2/customer_invoices → /customer_invoices
-- /api/v2/companies/{id}/trial_balance → /companies/{id}/trial_balance
UPDATE mcp_tools
SET endpoint_mapping = jsonb_set(
  endpoint_mapping,
  '{path}',
  to_jsonb(substring(endpoint_mapping->>'path' from 8))
)
WHERE connector_id IN (
  SELECT DISTINCT connector_id
  FROM   mcp_tools
  WHERE  name LIKE 'pennylane_%'
)
AND endpoint_mapping->>'path' LIKE '/api/v2/%';

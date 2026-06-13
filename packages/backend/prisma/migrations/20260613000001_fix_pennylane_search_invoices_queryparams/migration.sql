-- Fix pennylane_search_invoices: missing queryParams mapping.
--
-- Root cause: endpoint_mapping had no queryParams field, so the RestEngine sent
-- GET /customer_invoices with no query parameters at all. The Pennylane v2 API
-- (X-Use-2026-API-Changes: true) requires at least `limit` to return results;
-- without it the response contains items: [] (empty array) regardless of data.
--
-- Fix:
--   • Add queryParams with limit=50 (constant) — cursor-based pagination per
--     the reference adapter (pennylane-shared.ts fetchOnePage path ?limit=50).
--   • Map $date_from / $date_to / $status / $search as optional filter params
--     (RestEngine drops keys whose $param reference resolves to undefined).
--   • Remove page/per_page from parameters schema (old page-based pagination,
--     replaced by cursor+limit in the 2026 API).
--
-- Safe to run repeatedly (jsonb_set overwrites queryParams idempotently).

UPDATE mcp_tools
SET
  endpoint_mapping = jsonb_set(
    endpoint_mapping,
    '{queryParams}',
    '{"limit": 50, "date_from": "$date_from", "date_to": "$date_to", "status": "$status", "search": "$search"}'::jsonb
  ),
  parameters = '{
    "type": "object",
    "properties": {
      "date_from": {"type": "string", "description": "Date de debut YYYY-MM-DD (ex: 2025-01-01)"},
      "date_to":   {"type": "string", "description": "Date de fin   YYYY-MM-DD (ex: 2025-12-31)"},
      "status":    {"type": "string", "enum": ["draft", "outstanding", "late", "paid"]},
      "search":    {"type": "string", "description": "Recherche texte libre"}
    }
  }'::jsonb
WHERE name = 'pennylane_search_invoices';

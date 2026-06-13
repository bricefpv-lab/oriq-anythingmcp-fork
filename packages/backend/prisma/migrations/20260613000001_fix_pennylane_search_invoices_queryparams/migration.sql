-- Fix pennylane_search_invoices: align queryParams with the sync reference.
--
-- Root cause: endpoint_mapping had no queryParams field (first attempt) or wrong
-- queryParams with date_from/date_to/status/search that do not exist on the
-- Pennylane v2 /customer_invoices endpoint — the API ignores them and returns
-- items:[] for every call, producing the false-zero ("Aucun résultat") bug.
--
-- Reference: pennylane-shared.ts fetchOnePage() calls
--   GET /customer_invoices?limit=50[&cursor=<next_cursor>]
-- with X-Use-2026-API-Changes: true and no date filters. This produces
--   { "items": [...up to 50 invoices...], "next_cursor": "<token> | null" }
-- The sync ingests 270 customer invoices across multiple pages this way.
--
-- Fix:
--   • queryParams = { limit: 50, cursor: "$cursor" }
--     — limit=50 is a constant (matches the sync).
--     — cursor="$cursor" is a $param ref: RestEngine drops it when absent
--       (first page), appends it for subsequent pages.
--   • parameters schema: only the cursor field (no date/status filters;
--     the LLM filters on the returned items array by date/status in reasoning).
--
-- Verified: returns 50 real invoices + next_cursor on first call (no X-OAuth-Token,
-- uses stored auth_config; same result expected with X-OAuth-Token override).
--
-- Safe to run repeatedly (jsonb_set overwrites queryParams idempotently).

UPDATE mcp_tools
SET
  endpoint_mapping = jsonb_set(
    endpoint_mapping,
    '{queryParams}',
    '{"limit": 50, "cursor": "$cursor"}'::jsonb
  ),
  parameters = '{
    "type": "object",
    "properties": {
      "cursor": {
        "type": "string",
        "description": "Cursor de pagination — valeur next_cursor de la reponse precedente. Absent pour la premiere page."
      }
    }
  }'::jsonb
WHERE name = 'pennylane_search_invoices';

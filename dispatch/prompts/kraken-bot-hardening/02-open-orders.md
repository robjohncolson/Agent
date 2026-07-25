# Codex task — Kraken bot hardening 02: open-orders tracking

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/02-open-orders-tracking.spec.md` — problem, acceptance criteria
2. `tasks/specs/02-open-orders-tracking.plan.md` — implementation plan

Read both fully before editing.

## Your job

Execute the plan. Note that step 1 (the new /api/open-orders endpoint)
requires investigating existing patterns in `web/routes.py` and the
Kraken adapter. Before writing the handler, identify how the existing
`/api/exchange-balances` endpoint is wired and mimic that pattern
exactly.

If the bot's Kraken adapter doesn't expose a `fetch_open_orders` method,
you may need to add one in the adapter layer. Investigate first; only
add what's needed.

## Owned paths

You may modify:
- `web/routes.py`
- `scripts/cc_brain.py`
- `main.py` (only if strictly needed to wire state into the new route)
- `exchange/models.py` (to add any missing fields on the Order model)
- `exchange/parsers.py` (to parse additional fields from Kraken responses)

**Note:** a previous attempt at this task failed ownership enforcement
because Codex needed to extend `exchange/models.py` and `exchange/parsers.py`
to expose fields like `opened_at`, `status`, and normalized pair. Those
files are now explicitly in the owned paths — make whatever extensions
are necessary to surface the fields the `/api/open-orders` endpoint
returns. Keep changes minimal and additive.

Do NOT touch tests; this task is additive. Do not refactor unrelated
code in these files.

## Required outcome

- New GET `/api/open-orders` route returning `{orders: [...], count: N}`.
- New `get_pairs_with_open_orders()` helper in `scripts/cc_brain.py`.
- Step 5 in cc_brain unions memory-based and authoritative pending
  pair sets.
- `check_pending_orders()` extended to cancel ghost orders.
- Syntax check passes for both files.
- All existing tests still pass.

## Verification before completing

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('cc_brain OK')"
python -c "import ast; ast.parse(open('web/routes.py').read()); print('routes OK')"

# Smoke test the new endpoint
python -c "
import urllib.request, json
with urllib.request.urlopen('http://127.0.0.1:58392/api/open-orders', timeout=10) as r:
    body = json.load(r)
print(f'orders: count={body.get(\"count\", 0)}')
for o in body.get('orders', []):
    print(f'  {o}')
"
```

The smoke test requires the bot runtime_loop to be running. If it
isn't, note that in your response but do not try to start it.

## Done criteria

Git commit with scoped diff and the plan's commit message template.
Include the smoke-test output in your final response.

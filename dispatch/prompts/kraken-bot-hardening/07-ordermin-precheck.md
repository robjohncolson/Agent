# Codex task — Kraken bot hardening 07: ordermin pre-check

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/07-ordermin-precheck.spec.md`
2. `tasks/specs/07-ordermin-precheck.plan.md`

## Your job

Add ordermin + costmin pre-checking to the decision pipeline so Kraken
doesn't reject orders for minimum-size violations. Implement per the
plan: extend `_fetch_kraken_pairs` to cache the minimums, add a helper,
filter three call sites.

## Owned paths

- `scripts/cc_brain.py`

## Required outcome

- `_fetch_kraken_pairs` stores `ordermin` and `costmin` alongside
  existing `pair_decimals` / `lot_decimals`
- New `_meets_order_minimums(pair, qty, price)` helper
- Step 5b entry filter (with log per skip)
- evaluate_portfolio rotation filter (silent)
- check_exits filter (silent — positions too small for exit fall through
  to the dust path)
- Syntax check passes

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
import scripts.cc_brain as m
m._discovered_cache.clear(); m._discovered_at = 0
pairs = m._fetch_kraken_pairs()
info = pairs.get('RAVE/USD') or {}
print('RAVE/USD ordermin:', info.get('ordermin'))
print('RAVE/USD costmin:', info.get('costmin'))
ok, reason = m._meets_order_minimums('RAVE/USD', 1.0, 0.01)
print('Tiny test:', ok, reason)
"
```

Both minimums should be non-None, and the tiny test should return
(False, reason).

## Done criteria

Git commit per the plan's commit message template. Include the helper
test output in your response.

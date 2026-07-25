# Codex task — Kraken bot hardening 09: USDT/USD outlier investigation

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/09-usdt-loss-investigation.spec.md` — the five root-cause
   hypotheses
2. `tasks/specs/09-usdt-loss-investigation.plan.md` — investigation steps

## Your job

This is a **diagnostic-first** task. Investigate a single outlier trade:
USDT/USD reported net P&L of −$15.85 (42.9% loss) in the last 7 days,
which is impossible for a stablecoin under normal conditions. This one
trade dominates the entire 7-day loss.

Work through the plan's investigation steps (memory lookup, brain
reports, SQLite queries) to locate the actual trade data, reconstruct
the math, and classify the root cause as A (accounting bug), B
(execution bug), or C (data anomaly).

Then, if a code fix is warranted, implement it. If the root cause is
an untrusted aggregation path, the fix may need to touch files outside
the default owned list — investigate first and expand ownership only
if strictly necessary.

## Owned paths

- `tasks/specs/09-usdt-loss-investigation.result.md` (CREATE)
- `scripts/cc_brain.py` (if code fix is needed in decision logic)
- `web/routes.py` (if the `/api/trade-outcomes` aggregation is wrong)
- `persistence/*.py` (if reconciliation is dropping fills)

**Be conservative.** If the root cause points to a file outside this
list, STOP, document your finding in the result file, and do not
attempt the fix. The human can dispatch a follow-up.

## Required outcome

1. `tasks/specs/09-usdt-loss-investigation.result.md` with the full
   analysis per the plan's template
2. IF root cause A or B: a code fix in the appropriate owned file
3. IF root cause C: an outlier-detection rule that flags (not tunes on)
   such events

## Verification

```bash
test -f tasks/specs/09-usdt-loss-investigation.result.md && echo "result OK"
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('syntax OK')"
```

## Done criteria

Git commit per the plan's template. Final response must state the
root cause classification (A/B/C) and whether a code fix was applied.

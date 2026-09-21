# Codex task — Kraken bot hardening 06: backfill script fidelity fix

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/06-backfill-script-fidelity.spec.md` — problem + acceptance
2. `tasks/specs/06-backfill-script-fidelity.plan.md` — step-by-step plan

## Your job

Update `scripts/backfill_shadow.py` so it only counts cycles that
actually resulted in a real filled order on Kraken. Dry-run cycles
and failed-order cycles must be filtered out before the forward-return
comparison runs.

## Owned paths

- `scripts/backfill_shadow.py`

## Required outcome

- New `Mode:` parsing (DRY RUN vs LIVE)
- New Step 6 outcome parser (`PLACED:` / `FAILED:` / `DRY RUN`)
- Filter report at the top of the summary showing how many were dropped
- Per-cycle table only contains filled cycles
- Running against current state/cc-reviews/ produces a materially
  different (and correct) summary than the pre-fix version
- RAVE/USD 2026-04-12 01:32 must NOT appear in the filled cycles list

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/backfill_shadow.py').read()); print('OK')"
python scripts/backfill_shadow.py --forward-hours 6 2>&1 | head -20
```

The filter report should appear and show non-zero dry_run and
failed_order drops.

## Done criteria

Git commit scoped to `scripts/backfill_shadow.py`, commit message per
the plan's template. Include the filter report output in your final
response.

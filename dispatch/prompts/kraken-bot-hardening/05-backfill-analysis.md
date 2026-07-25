# Codex task — Kraken bot hardening 05: backfill 6h analysis

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/05-backfill-6h-analysis.spec.md` — task definition
2. `tasks/specs/05-backfill-6h-analysis.plan.md` — step-by-step plan
3. `scripts/backfill_shadow.py` — existing tool (READ, don't modify
   unless you find a bug that blocks running it)

## Your job

This is a **diagnostic task**, not implementation. Run the backfill
with a 6-hour forward-return window, compute the statistics, and
produce a written analysis in
`tasks/specs/05-backfill-6h-analysis.result.md`.

No code changes unless the backfill script itself has a bug.

## Owned paths

- `tasks/specs/05-backfill-6h-analysis.result.md` (CREATE)

If you find a bug in `scripts/backfill_shadow.py` that blocks the
task, you may also edit that file — but ONLY to fix the blocking
bug, not for refactoring or style.

## Required outcome

A new `tasks/specs/05-backfill-6h-analysis.result.md` file containing
the full analysis per the template in the plan. It must include:

- Command used + date
- Number of reports processed
- Reconstruction fidelity (must be 100%)
- Number of cycles with 6h forward data
- Per-cycle table
- Aggregate metrics table (shadow wins, live wins, ties, cumulative
  edge, per-cycle edge, significance if applicable)
- Comparison to the earlier 2h-window result
- Sample-size assessment
- Recommendation: one of {promote / extend-veto / hold-narrow /
  investigate}

## Verification

The analysis file itself is the artifact. Confirm:

```bash
test -f tasks/specs/05-backfill-6h-analysis.result.md && echo "OK"
wc -l tasks/specs/05-backfill-6h-analysis.result.md
```

## Done criteria

Git commit that adds the result file, with a commit message like:

```
Backfill 6h forward-return analysis

See tasks/specs/05-backfill-6h-analysis.result.md for the full
write-up.

Key finding: <one sentence>
Recommendation: <one of the four options>
```

The final response must include the recommendation explicitly.

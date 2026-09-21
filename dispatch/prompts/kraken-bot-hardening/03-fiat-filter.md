# Codex task — Kraken bot hardening 03: fiat-currency filter

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/03-fiat-filter-check-exits.spec.md` — problem, acceptance criteria
2. `tasks/specs/03-fiat-filter-check-exits.plan.md` — implementation plan

## Dependency

**This task must run AFTER task 01** (floor-round exit qty). Both
edit `check_exits`. When you start, verify that task 01's changes
are already present in `scripts/cc_brain.py`:

```bash
grep -n "_floor_qty" scripts/cc_brain.py
```

Must show the helper defined and at least one call site. If not,
halt and report that the dependency hasn't merged yet.

## Your job

Execute the plan as written. Small, surgical change: one new
`FIAT_CURRENCIES` constant, one updated skip condition in
`check_exits`, and two updated skip conditions in `evaluate_portfolio`.

## Owned paths

You may modify only:
- `scripts/cc_brain.py`

## Required outcome

- New `FIAT_CURRENCIES = frozenset((...))` constant with EUR, GBP,
  AUD, CAD, CHF, JPY, ZAR, HKD, SGD.
- `check_exits` skips `QUOTE_CURRENCIES | FIAT_CURRENCIES`.
- `evaluate_portfolio` skips fiat as both source and target.
- Syntax check passes.

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
from scripts.cc_brain import FIAT_CURRENCIES, QUOTE_CURRENCIES
assert 'EUR' in FIAT_CURRENCIES
assert 'AUD' in FIAT_CURRENCIES
assert 'USD' not in FIAT_CURRENCIES  # USD stays in QUOTE_CURRENCIES
print('constants OK')
"
```

## Done criteria

Git commit with diff scoped to `scripts/cc_brain.py`, commit message
per the plan's template.

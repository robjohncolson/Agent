# Codex task — Kraken bot hardening 01: floor-round exit quantities

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/01-floor-round-exit-qty.spec.md` — problem, root cause, acceptance criteria
2. `tasks/specs/01-floor-round-exit-qty.plan.md` — step-by-step implementation plan

Read both fully before editing any code.

## Your job

Execute the plan exactly as written. Do not deviate unless you find
a concrete bug in the plan, in which case stop and explain.

## Owned paths

You may modify only:
- `scripts/cc_brain.py`

Do not touch any other file.

## Required outcome

- New `_floor_qty(qty, pair)` helper near `_price_decimals`.
- All sell-order qty construction sites use `_floor_qty` instead of
  `str(round(qty, 6))`.
- Syntax check passes: `python -c "import ast; ast.parse(open('scripts/cc_brain.py').read())"`.
- Commit message follows the plan's template.

## Verification before completing

Run these and report output:
```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
from scripts.cc_brain import _floor_qty
# CRV real balance is 91.5370539700; floor to 8 decimals must be <= actual
v = _floor_qty(91.5370539700, 'CRV/USD')
print(f'CRV floor: {v}')
assert float(v) <= 91.5370539700, 'floor exceeded balance!'
"
```

Do NOT run `cc_brain.py` in live mode — dry-run or skip. Another
agent/cycle will validate end-to-end.

## Done criteria

Final git commit on your branch with the diff scoped to
`scripts/cc_brain.py`, commit message following the plan's template,
plus any verification logs you want to include in the response.

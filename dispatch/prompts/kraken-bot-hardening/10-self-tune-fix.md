# Codex task — Kraken bot hardening 10: backwards self-tune rule fix

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/10-self-tune-rule-fix.spec.md` — why the current rule
   is mathematically backwards
2. `tasks/specs/10-self-tune-rule-fix.plan.md`

## Your job

The `self_tune` function has a rule at around line 711 that bumps
`MAX_POSITION_PCT` when `total_fees / gross_wins > 0.60`. The reasoning
is broken: fee ratio is invariant to position size at fixed percentage
fees, so bigger positions don't fix the problem. The rule has been
pushing position size from 0.04 to 0.07 without the underlying ratio
changing.

Replace it with a rule that bumps `ENTRY_THRESHOLD` instead — be
pickier about which setups pay the fee tax.

## Owned paths

- `scripts/cc_brain.py`

## Required outcome

- The old fee-ratio → MAX_POSITION_PCT rule is deleted
- A new fee-ratio → ENTRY_THRESHOLD rule replaces it
- `MAX_POSITION_PCT` is NOT reset (leave whatever value the previous
  buggy rule pushed it to — that's a separate tuning concern)
- Syntax check passes
- Ideally, a sanity test showing the same outcomes at different
  position sizes produce the same tuning decision

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
from scripts import cc_brain
prev_pos = cc_brain.MAX_POSITION_PCT
prev_thr = cc_brain.ENTRY_THRESHOLD
outcomes = [
    {'net_pnl': 1.0, 'fee_total': 0.5, 'exit_reason': 'timer'},
    {'net_pnl': 1.0, 'fee_total': 0.5, 'exit_reason': 'timer'},
    {'net_pnl': -1.0, 'fee_total': 0.5, 'exit_reason': 'stop_loss'},
    {'net_pnl': -1.0, 'fee_total': 0.5, 'exit_reason': 'stop_loss'},
    {'net_pnl': 1.0, 'fee_total': 0.5, 'exit_reason': 'timer'},
]
cc_brain.self_tune(outcomes, [], lambda m: None)
print(f'MAX_POSITION_PCT {prev_pos} -> {cc_brain.MAX_POSITION_PCT}')
print(f'ENTRY_THRESHOLD {prev_thr} -> {cc_brain.ENTRY_THRESHOLD}')
# MAX_POSITION_PCT must be unchanged (the buggy rule should not fire)
assert cc_brain.MAX_POSITION_PCT == prev_pos, 'position size should NOT change'
"
```

## Done criteria

Git commit per the plan's template.

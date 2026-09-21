# Codex task — Kraken bot hardening 04: extended shadow veto

You are working in the **kraken-bot-v4** repo at
`C:\Users\rober\Downloads\Projects\kraken-bot-v4`.

## Inputs to read first

1. `tasks/specs/04-extended-shadow-veto.spec.md` — problem, three
   design options, chosen approach (Option C hybrid)
2. `tasks/specs/04-extended-shadow-veto.plan.md` — step-by-step plan

Read both fully before editing.

## Your job

Implement the hybrid shadow preferred-entry logic:
1. Add `shadow_preferred_entry` helper after `compute_unified_holds`
2. Rewire Step 5b entry flow to consult the helper before live's pick
3. Remove the now-unused `shadow_wants_cash` variable

This is a surgical edit but touches the critical decision path.
Follow the plan closely.

## Owned paths

You may modify only:
- `scripts/cc_brain.py`

## Required outcome

- New `SHADOW_STRONG_THRESHOLD = 0.65` constant
- New `shadow_preferred_entry(...)` function with exactly the signature
  and return shape specified in the plan
- Step 5b rewired to call the helper first
- Old narrow-veto code deleted
- Three log outcomes distinctly emitted in logs: REDIRECT, VETO, defer
- Syntax passes

## Verification

```bash
python -c "import ast; ast.parse(open('scripts/cc_brain.py').read()); print('OK')"
python -c "
from scripts.cc_brain import shadow_preferred_entry, SHADOW_STRONG_THRESHOLD
assert SHADOW_STRONG_THRESHOLD == 0.65
print('constant OK')
"

# Dry-run to exercise all three paths (may only hit some depending on
# current shadow verdict — note which one fired)
python scripts/cc_brain.py --dry-run 2>&1 | grep -E "SHADOW" | head
```

## Done criteria

Git commit scoped to `scripts/cc_brain.py` with the plan's commit
message template. Include the grep output in your final response so
we can see which shadow path fired on the dry-run.

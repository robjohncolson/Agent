# Agent: Grid Bot V2 CLAUDE.md Rules

## Phase
P1-foundation | No dependencies | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Append trading-bot-specific rules to `grid-bot-v2/CLAUDE.md` that prevent the recurring bug patterns from 22 sessions of development.

## Context: The Dependency Graph You Must Understand

The main loop has 9 sequential steps. Bugs hide at the boundaries between steps:

```
Step 1: Price + Candles (adapter.fetch_ohlcv)
Step 2: Scanner Update (FastHMM, Tactical, merge_regimes → MarketCharacter)
Step 3: Capacity Check (CapacityTracker → WorkBank)
  ↓ Steps 1-3 are parallelizable (no shared state)
Step 4: Governor Decisions (evaluate → GovernorActions)
  ↓ DEPENDS ON: MarketCharacter (Step 2) + WorkBank (Step 3)
Step 5: Per-Slot Transitions (SlotEngine → state_machine.transition)
  ↓ DEPENDS ON: GovernorActions (Step 4)
Step 6: Fill Detection + Reconciliation (poll_fills → adapter.query_orders)
  ↓ DEPENDS ON: Current slot states (Step 5)
Step 7: Governor Post-Tick
  ↓ DEPENDS ON: Updated slot states (Step 6)
Step 8: Persist (ledger, slot_engine.snapshot, candle SQLite)
Step 9: Broadcast (SSE, WebSocket)
```

**Critical fill detection paths (the ones that caused money loss):**
1. Normal poll: `poll_fills() → adapter.query_orders() → FillEvent → transition()`
2. Startup reconciliation: `main.py init → load ledger → replay → reconcile with exchange`
3. Recovery flow: `RecoveryFillEvent / RecoveryCancelEvent → transition() → repricing`
4. Degraded mode: `S0_long_only / S0_short_only → different transition table entries`

**Fee calculation path (traced end-to-end):**
```
config.MAKER_FEE_PCT
  → state_machine.transition() BookCycleAction
    → cycle.gross_profit = exit_price - entry_price
    → cycle.fee = volume * price * MAKER_FEE_PCT * 2  (entry + exit)
    → cycle.net_profit = gross - fee
      → ledger.book_cycle_profit(cycle)
        → dashboard.display_pnl()
```

## Read First
1. `main.py` lines 1-30 (9-step docstring)
2. `state_machine.py` (the FROZEN reducer — understand transitions)
3. `governor.py` lines 379-519 (evaluate function)
4. `slot_engine.py` (how slots wrap state_machine)
5. Existing `CLAUDE.md` in this repo (if any)

## Owned Paths
- `CLAUDE.md`

## Rules to Append

```markdown
## Trading Bot Rules

### Always Pull First
Always `git pull` before investigating bugs or log messages. The local repo
is frequently behind remote.

### Frozen State Machine
state_machine.py is FROZEN — do not modify it directly. All behavioral changes
go through wrapping layers: governor.py, slot_engine.py, fleet_allocator*.py.

### Fill Detection — Check ALL Paths
When fixing fill detection or P&L bugs, check ALL of these paths:
1. Normal fill flow: poll_fills() → FillEvent → transition()
2. Startup reconciliation: main.py init → ledger replay → adapter reconcile
3. Orphan recovery flow: RecoveryFillEvent, RecoveryCancelEvent → transition()
4. Degraded mode paths: S0_long_only, S0_short_only, S1a_short_only, S1b_long_only
5. Governor post-tick: growth snapshots, recovery TTL expiry

### Fee/Profit Trace
For fee/profit bugs, trace the full path:
  config.MAKER_FEE_PCT → transition() BookCycleAction → cycle.net_profit
  → ledger.book_cycle_profit() → dashboard display

### Test Before Commit
Run `pytest test_state_machine.py test_slot_engine.py test_integration.py`
after any fix. Write a failing test FIRST if the bug isn't already covered.

### Module Dependency Order (main loop)
1-3 parallel: adapter, scanner, capacity (no shared state)
4 sequential: governor (needs MarketCharacter + WorkBank)
5 sequential: slot transitions (needs GovernorActions)
6 sequential: fill detection (needs current slot states)
7-9 sequential: post-tick, persist, broadcast
```

## Verification
```bash
grep -c "Fill Detection" CLAUDE.md  # Should find the section
grep -c "FROZEN" CLAUDE.md          # Should find frozen state machine rule
```

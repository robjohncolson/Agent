# Agent: Test Fill Detection Paths

## Phase
P2-gridbot-safety-net | No dependencies | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Write comprehensive pytest tests for EVERY code path that can trigger fill detection. Each test reproduces a real bug from production sessions.

## Context: The Fill Detection Dependency Graph

```
adapter.query_orders(txids)
  ↓
For each order status:
  ├── status == "closed"  → FillEvent(txid, price, side, volume)
  ├── status == "canceled" → RecoveryCancelEvent(txid)
  └── status == "open"    → no-op
  ↓
state_machine.transition(event, slot.state, cfg)
  ↓
Returns: (new_state, actions[])
  ├── PlaceOrderAction(side, price, volume)    → adapter.place_order()
  ├── CancelOrderAction(txid)                  → adapter.cancel_order()
  ├── OrphanOrderAction(recovery_order)        → adapter.place_order()
  ├── BookCycleAction(entry, exit, profit)      → ledger.book_cycle_profit()
  └── (state mutation: phase transition, order removal/addition)
```

**The 5 fill detection code paths:**

```
PATH 1: Normal Poll (main loop Step 6)
  main.py poll_fills() → adapter.query_orders() → FillEvent → transition()
  TRIGGER: Price crosses order level, exchange fills it

PATH 2: Startup Reconciliation (main.py init)
  Load state from JSON → query exchange for all open orders → reconcile
  TRIGGER: Bot restarts, finds orders were filled while offline
  BUG HISTORY: Missed initialization path caused continued money loss

PATH 3: Recovery Fill (orphan handling)
  RecoveryFillEvent → transition() in recovery context
  TRIGGER: Orphaned order eventually fills at repriced level
  BUG HISTORY: Wrong companion order placed after recovery fill

PATH 4: Recovery Cancel (orphan cancelled by exchange)
  RecoveryCancelEvent → transition() → reschedule at new price
  TRIGGER: Exchange cancels recovery order (insufficient funds, etc.)

PATH 5: Degraded Mode Fill
  Same as Path 1 but state.phase is S0_long_only or S0_short_only
  TRIGGER: Fill arrives when only one side is active
  Different transition table entries apply
```

## Read First
1. `state_machine.py` — the frozen reducer (transition function, PairState, phases)
2. `main.py` lines 519-640 — poll_fills implementation
3. `slot_engine.py` — how SlotEngine wraps transition calls
4. `bot_types.py` — Event types, Action types, PairState fields
5. `conftest.py` — existing fixtures (extend, don't replace)
6. `test_state_machine.py` — existing transition tests (avoid duplication)

## Owned Paths
- `test_fill_detection_paths.py`

## Data Contract: conftest-fixtures-v1
You MUST export these fixtures from `conftest.py` for consumer agents:
- `mock_adapter` — mock Kraken adapter with configurable query_orders responses
- `make_slot` — factory for SlotRuntime with customizable state
- `make_pair_state` — factory for PairState at any phase (S0, S1a, S1b, S2, degraded)
- `make_fill_event` — factory for FillEvent with side, price, volume
- `make_engine_config` — factory for EngineConfig with fee params

## Test Structure

```python
# test_fill_detection_paths.py
import pytest
from state_machine import transition, PairState, derive_phase
from bot_types import (
    FillEvent, RecoveryFillEvent, RecoveryCancelEvent,
    PlaceOrderAction, CancelOrderAction, BookCycleAction, OrphanOrderAction
)

class TestPath1NormalPollFill:
    """PATH 1: Normal fill detected via poll_fills()"""

    def test_buy_entry_fill_transitions_to_s1a(self, make_pair_state, make_fill_event, make_engine_config):
        """A buy-entry fill in S0 should transition to S1a and place a sell-exit"""
        state = make_pair_state(phase="S0", with_entry_orders=True)
        event = make_fill_event(side="buy", txid=state.orders[0].txid)
        new_state, actions = transition(state, event, make_engine_config())
        assert derive_phase(new_state) == "S1a"
        assert any(isinstance(a, PlaceOrderAction) and a.side == "sell" for a in actions)

    def test_sell_entry_fill_transitions_to_s1b(self, ...):
        ...

    def test_exit_fill_books_cycle_profit(self, ...):
        """Exit fill should produce BookCycleAction with correct gross/net profit"""
        ...

    def test_exit_fill_fee_deduction_matches_config(self, ...):
        """Bug repro: fee calculation missed initialization path"""
        ...

class TestPath2StartupReconciliation:
    """PATH 2: Fills that happened while bot was offline"""

    def test_startup_detects_filled_orders_from_exchange(self, mock_adapter, ...):
        """Restart with orders that filled during downtime"""
        ...

    def test_startup_reconciliation_handles_partial_fills(self, ...):
        ...

class TestPath3RecoveryFill:
    """PATH 3: Orphaned order eventually fills"""

    def test_recovery_fill_places_correct_companion(self, ...):
        """Bug repro: wrong companion order was placed after recovery"""
        ...

    def test_recovery_fill_in_s1a_returns_to_s0(self, ...):
        ...

class TestPath4RecoveryCancel:
    """PATH 4: Exchange cancels recovery order"""

    def test_recovery_cancel_reschedules_at_new_price(self, ...):
        ...

class TestPath5DegradedModeFill:
    """PATH 5: Fill arrives in degraded (one-sided) mode"""

    def test_fill_in_long_only_mode(self, ...):
        ...

    def test_fill_in_short_only_mode(self, ...):
        ...
```

## Constraints
- Use existing conftest.py fixtures where they exist; extend with new factories
- Do NOT modify state_machine.py (it's frozen)
- Each test must be independently runnable
- Name tests descriptively — they serve as living documentation of known bug classes
- Add docstrings referencing the session/bug that motivated each test

## Verification
```bash
python -m pytest test_fill_detection_paths.py -v --tb=short
python -m pytest test_fill_detection_paths.py --co -q | wc -l  # Should be 10+
```

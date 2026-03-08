# Agent: Test Startup Reconciliation

## Phase
P2-gridbot-safety-net | No dependencies | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Write pytest tests for the startup state reconstruction flow — the code path that runs when the bot restarts and must reconcile persisted state with the exchange's actual order book.

## Context: Why This Matters

The startup reconciliation path was the **#2 source of money-losing bugs**. When the bot restarts:
1. It loads state from `logs/state.json` (slot snapshots)
2. It replays `logs/ledger.jsonl` (trade history)
3. It queries the exchange for current order statuses
4. It must detect orders that filled while offline and process them

**The bug:** The fix for fee calculation "missed the actual initialization path" — the startup code was initializing `profit_pct` differently than the normal fill path, causing continued financial losses.

## Dependency Graph: Startup Sequence

```
Bot starts (main.py)
  ↓
1. Load config from env vars
  ↓
2. Initialize adapter (KrakenAdapter)
  ↓
3. Load persisted state
   ├── state.json → SlotEngine._slots (SlotRuntime per slot)
   └── ledger.jsonl → Ledger (in-memory deque)
  ↓
4. Reconcile with exchange  ← THIS IS THE CRITICAL PATH
   ├── adapter.query_orders(all_known_txids)
   ├── For each known order:
   │   ├── If exchange says "closed" but state says "open":
   │   │   └── Create FillEvent, run transition() ← MUST match normal fill path
   │   ├── If exchange says "canceled" but state says "open":
   │   │   └── Create CancelEvent, clean up state
   │   └── If exchange has no record (expired):
   │       └── Mark as stale, remove from state
   └── Verify: slot phases are consistent after reconciliation
  ↓
5. Enter main loop
```

## Read First
1. `main.py` — startup/init section (before main loop)
2. `ledger.py` — load/replay logic
3. `slot_engine.py` — snapshot/restore methods
4. `state_machine.py` — transition function (verify reconciliation uses same path)
5. `conftest.py` — existing fixtures

## Owned Paths
- `test_startup_reconciliation.py`

## Contract: Uses conftest-fixtures-v1
Uses fixtures from `conftest.py`: `mock_adapter`, `make_slot`, `make_pair_state`, `make_engine_config`

## Test Structure

```python
# test_startup_reconciliation.py
import pytest
import json

class TestStartupStateLoad:
    """State loading from persisted files"""

    def test_loads_slot_state_from_json(self, tmp_path, ...):
        """Verify slot states restored correctly from state.json"""

    def test_replays_ledger_to_current_state(self, tmp_path, ...):
        """Verify ledger.jsonl replay produces correct cumulative P&L"""

    def test_handles_missing_state_file_gracefully(self, tmp_path, ...):
        """First run — no state.json exists"""

    def test_handles_corrupted_state_file(self, tmp_path, ...):
        """Partial JSON write from crash"""

class TestStartupReconciliation:
    """Reconciliation between persisted state and exchange"""

    def test_detects_orders_filled_while_offline(self, mock_adapter, make_slot, ...):
        """
        Bug repro: Bot restarts, exchange shows order as 'closed',
        state has it as 'open'. Must create FillEvent and transition.
        """
        # Setup: slot with open buy order
        # Mock: adapter returns status='closed' for that txid
        # Assert: FillEvent created, transition called, BookCycleAction produced

    def test_reconciliation_uses_same_transition_as_normal_fill(self, ...):
        """
        Bug repro: startup initialized profit_pct differently than normal path.
        Verify that reconciliation calls the EXACT same transition() function
        with the EXACT same parameters as poll_fills().
        """

    def test_reconciliation_handles_multiple_fills_in_order(self, ...):
        """Multiple orders filled while offline — process in chronological order"""

    def test_reconciliation_handles_cancelled_orders(self, ...):
        """Exchange cancelled orders while offline (insufficient funds, etc.)"""

    def test_reconciliation_handles_unknown_orders(self, ...):
        """State references txid that exchange has no record of (expired)"""

    def test_slot_phase_consistent_after_reconciliation(self, ...):
        """After reconciliation, derive_phase(state) matches expected phase"""

class TestStartupFeeConsistency:
    """Fee calculation must be identical at startup and during normal operation"""

    def test_startup_fee_path_matches_normal_fee_path(self, ...):
        """
        Bug repro: fee calculation fix missed startup initialization path.
        Run same fill through both startup reconciliation and normal poll_fills.
        Assert: net_profit is identical.
        """

    def test_profit_pct_initialized_correctly_at_startup(self, ...):
        """
        Bug repro: profit_pct floor patch missed the actual initialization path.
        Verify config.PROFIT_PCT propagates correctly during startup.
        """
```

## Verification
```bash
python -m pytest test_startup_reconciliation.py -v --tb=short
```

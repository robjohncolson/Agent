# Agent: Test Fee Integration (End-to-End)

## Phase
P2-gridbot-safety-net | Depends on: test-fill-detection-paths (conftest fixtures) | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Write end-to-end pytest tests tracing fee calculation from config through every transformation to final display, preventing the bug class where "fee fix didn't resolve negative P&L."

## Context: The Fee Dependency Chain (End-to-End)

```
config.py
  └── MAKER_FEE_PCT (e.g., 0.0016 = 0.16%)
       ↓
state_machine.py transition() → BookCycleAction
  └── cycle.gross_profit = (exit_price - entry_price) * volume
  └── cycle.fee = volume * avg_price * MAKER_FEE_PCT * 2  (entry + exit fee)
  └── cycle.net_profit = gross_profit - fee
       ↓
ledger.py book_cycle_profit(cycle)
  └── Appends to JSONL: {trade_id, entry_price, exit_price, gross, fee, net, timestamp}
  └── Updates in-memory totals: total_net_profit, total_fees
       ↓
build_status_payload() [in main.py or server.py]
  └── Reads ledger totals → formats for dashboard
       ↓
Dashboard display
  └── Shows P&L, fees, net profit
```

**Bug that cost real money:** The fee fix patched one calculation path but missed the startup initialization path. The startup code was initializing `profit_pct` with a different value, causing the net profit to diverge between restart cycles.

## Read First — IN THIS ORDER (dependency chain)
1. `config.py` — find MAKER_FEE_PCT and PROFIT_PCT definitions
2. `state_machine.py` — find BookCycleAction construction in transition()
3. `ledger.py` — find book_cycle_profit() and total computation
4. `main.py` — find build_status_payload() or equivalent
5. `conftest.py` — use fixtures from test-fill-detection-paths agent

## Depends On
- `test-fill-detection-paths` agent must have created conftest fixtures:
  `mock_adapter`, `make_pair_state`, `make_fill_event`, `make_engine_config`

## Owned Paths
- `test_fee_integration.py`

## Test Structure

```python
class TestFeeCalculation:
    """Unit tests for fee math at each stage"""

    def test_cycle_fee_is_maker_fee_times_two(self, make_engine_config):
        """Fee = volume * price * MAKER_FEE_PCT * 2 (entry + exit)"""
        cfg = make_engine_config(maker_fee_pct=0.0016)
        # Execute a complete cycle (entry fill → exit fill → BookCycleAction)
        # Assert: action.fee == expected

    def test_net_profit_equals_gross_minus_fee(self, ...):
        """Invariant: net = gross - fee, always"""

    def test_negative_gross_still_deducts_fee(self, ...):
        """Loss trade: fee makes it worse, not better"""

class TestFeeConsistencyAcrossPaths:
    """The same fill must produce the same fee regardless of detection path"""

    def test_normal_poll_and_startup_produce_same_fee(self, ...):
        """
        Bug repro: startup initialized profit_pct differently.
        Run identical fill through:
          A) Normal poll_fills path
          B) Startup reconciliation path
        Assert: cycle.fee and cycle.net_profit are identical.
        """

    def test_recovery_fill_fee_matches_normal_fill_fee(self, ...):
        """Recovery fills should use same fee calculation as normal fills"""

class TestFeeEndToEnd:
    """Trace fee from config through to ledger and dashboard payload"""

    def test_config_fee_propagates_to_cycle_action(self, ...):
        """config.MAKER_FEE_PCT → transition() BookCycleAction.fee"""

    def test_cycle_fee_recorded_in_ledger(self, ...):
        """BookCycleAction.fee → ledger.book_cycle_profit() → JSONL record"""

    def test_ledger_totals_match_sum_of_cycles(self, ...):
        """ledger.total_fees == sum(cycle.fee for all cycles)"""

    def test_dashboard_payload_reflects_ledger_totals(self, ...):
        """build_status_payload().total_profit == ledger.total_net_profit"""

class TestFeeEdgeCases:
    """Edge cases that have caused problems"""

    def test_zero_volume_order_has_zero_fee(self, ...):
    def test_very_small_order_fee_not_negative(self, ...):
    def test_fee_with_different_price_decimals(self, ...):
```

## Verification
```bash
python -m pytest test_fee_integration.py -v --tb=long
```

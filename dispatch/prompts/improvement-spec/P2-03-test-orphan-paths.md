# Agent: Test Orphan Recovery Paths

## Phase
P2-gridbot-safety-net | No dependencies | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Write pytest tests for the full orphan lifecycle: detection → orphaning → recovery order → fill/cancel → re-bootstrap.

## Context: The Orphan Dependency Chain

```
Normal trading (S1a or S1b)
  ↓ exit order ages past s1_orphan_sec AND price moved away
Orphan Detection (state_machine.transition on TimerTick)
  ↓
OrphanOrderAction emitted
  ├── Cancel stale exit order
  ├── Create RecoveryOrder at repriced level
  └── Transition back to S0 (re-bootstrap entries)
  ↓
Recovery order sits on exchange
  ↓
BRANCH A: Recovery fills → RecoveryFillEvent → book profit → done
BRANCH B: Recovery cancelled → RecoveryCancelEvent → reschedule at new price
BRANCH C: Recovery times out → write-off candidate → governor decides
```

**Bug history:**
- Fix "incorrectly cancelled the opposite-side entry that should have stayed on book"
- Required 3 iterations to get right — the companion order logic had multiple code paths

## Read First
1. `state_machine.py` — TimerTick handling, OrphanOrderAction, RecoveryFillEvent, RecoveryCancelEvent
2. `orphan_health.py` — OrphanHealthTracker (PnL velocity, recovery tracking)
3. `governor.py` lines 158-186 — compute_recovery_ttl()
4. `governor.py` lines 109-154 — compute_stuck_score()
5. `slot_engine.py` — how orphan actions are dispatched

## Owned Paths
- `test_orphan_recovery_paths.py`

## Test Structure

```python
class TestOrphanDetection:
    """When does an exit order become an orphan?"""

    def test_s1a_exit_orphaned_after_timeout_and_price_moved(self, ...):
        """S1a: A-exit ages past timeout AND price moved away → orphan"""

    def test_s1a_exit_NOT_orphaned_if_price_still_near(self, ...):
        """S1a: old exit but price hasn't moved → keep waiting"""

    def test_s1b_exit_orphaned_after_timeout(self, ...):
        """S1b: B-exit ages past timeout AND price moved → orphan"""

    def test_sticky_mode_disables_orphaning(self, ...):
        """Sticky slots should never orphan their exits"""

    def test_s2_orphans_worse_leg_by_distance(self, ...):
        """S2: Both exits active, orphan the one further from market"""

class TestOrphanActionExecution:
    """What happens when an orphan is detected?"""

    def test_orphan_cancels_stale_exit_only(self, ...):
        """
        Bug repro: Fix incorrectly cancelled the opposite-side ENTRY.
        Verify: only the stale EXIT is cancelled, entry stays on book.
        """

    def test_orphan_creates_recovery_at_repriced_level(self, ...):
        """Recovery order placed at governor-determined price"""

    def test_orphan_transitions_back_to_s0(self, ...):
        """After orphaning, slot returns to S0 and re-bootstraps entries"""

class TestRecoveryFill:
    """Recovery order eventually fills"""

    def test_recovery_fill_books_profit_correctly(self, ...):
        """Net profit accounts for original entry + recovery exit prices + fees"""

    def test_recovery_fill_companion_order_is_correct_side(self, ...):
        """
        Bug repro: wrong companion order placed after recovery fill.
        If recovery was a sell (closing a buy entry), companion should be a new buy entry.
        """

class TestRecoveryCancel:
    """Exchange cancels recovery order"""

    def test_recovery_cancel_reschedules_at_current_market_price(self, ...):

    def test_recovery_cancel_respects_max_retries(self, ...):

class TestRecoveryWriteOff:
    """Governor decides to write off a stuck recovery"""

    def test_write_off_cleans_up_slot_state(self, ...):

    def test_write_off_records_loss_in_ledger(self, ...):
```

## Verification
```bash
python -m pytest test_orphan_recovery_paths.py -v --tb=short
```

# Agent: Test Degraded Mode Transitions

## Phase
P2-gridbot-safety-net | No dependencies | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Write pytest tests for all degraded mode transitions, ensuring fills and orphans work correctly when only one side is active.

## Context: Degraded Mode Dependency Graph

Normal modes:
```
S0 (both entries) ←→ S1a (A-exit + B-entry) ←→ S2 (both exits)
                  ←→ S1b (B-exit + A-entry) ←→
```

Degraded modes (when one side is blocked by risk/momentum gate):
```
S0_long_only  → Only buy entries, no sell entries
S0_short_only → Only sell entries, no buy entries
S1a_short_only → A-exit active, but B-entry blocked
S1b_long_only  → B-exit active, but A-entry blocked
```

**Transitions INTO degraded mode:**
```
S0 + governor.blocked_sides=['sell'] → S0_long_only
S0 + governor.blocked_sides=['buy']  → S0_short_only
S1a + governor.blocked_sides=['buy'] → S1a_short_only
S1b + governor.blocked_sides=['sell'] → S1b_long_only
```

**Transitions OUT of degraded mode:**
```
S0_long_only + blocked_sides=[] → S0 (re-bootstrap both sides)
S0_long_only + buy_entry_fills  → ??? (need to verify this path)
```

## Read First
1. `state_machine.py` — search for "long_only", "short_only", "degraded"
2. `governor.py` — how blocked_sides is computed (risk_gate, momentum_gate)
3. `risk_gate.py` — directional blocking logic
4. `momentum_gate.py` — hard blocks that override governor

## Owned Paths
- `test_degraded_mode_transitions.py`

## Test Structure

```python
class TestEntryIntoDegradedMode:
    def test_s0_with_sell_blocked_becomes_long_only(self, ...):
    def test_s0_with_buy_blocked_becomes_short_only(self, ...):
    def test_s1a_with_buy_blocked_becomes_s1a_short_only(self, ...):
    def test_s1b_with_sell_blocked_becomes_s1b_long_only(self, ...):

class TestFillsInDegradedMode:
    def test_buy_fill_in_long_only_transitions_correctly(self, ...):
        """Fill arrives when only buy side is active"""
    def test_sell_fill_in_short_only_transitions_correctly(self, ...):
    def test_exit_fill_in_degraded_books_profit(self, ...):
        """Exit fills in degraded mode must still book cycle profit"""

class TestExitFromDegradedMode:
    def test_long_only_recovers_to_s0_when_unblocked(self, ...):
    def test_short_only_recovers_to_s0_when_unblocked(self, ...):

class TestOrphansInDegradedMode:
    def test_orphan_detection_works_in_degraded_s1a(self, ...):
    def test_orphan_recovery_in_degraded_mode(self, ...):
```

## Verification
```bash
python -m pytest test_degraded_mode_transitions.py -v --tb=short
```

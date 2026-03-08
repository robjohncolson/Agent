# Agent: CI Setup for Grid Bot V2

## Phase
P2-gridbot-safety-net | Depends on: ALL P2 test agents | Working dir: `C:/Users/ColsonR/grid-bot-v2`

## Objective
Create GitHub Actions CI workflow that runs the full pytest suite on push and PR, with coverage reporting.

## Dependencies (Fan-In)
This agent runs AFTER all test agents complete:
- `test-fill-detection-paths` → test_fill_detection_paths.py
- `test-startup-reconciliation` → test_startup_reconciliation.py
- `test-orphan-recovery-paths` → test_orphan_recovery_paths.py
- `test-fee-integration` → test_fee_integration.py
- `test-degraded-modes` → test_degraded_mode_transitions.py

All test files must exist and pass before CI is meaningful.

## Owned Paths
- `.github/workflows/ci.yml`

## Implementation

```yaml
# .github/workflows/ci.yml
name: Grid Bot V2 Tests

on:
  push:
    branches: [master, main]
  pull_request:
    branches: [master, main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python 3.12
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov

      - name: Run tests with coverage
        run: |
          python -m pytest \
            test_state_machine.py \
            test_slot_engine.py \
            test_fill_detection_paths.py \
            test_startup_reconciliation.py \
            test_orphan_recovery_paths.py \
            test_fee_integration.py \
            test_degraded_mode_transitions.py \
            test_integration.py \
            -v --tb=short \
            --cov=. --cov-report=term-missing \
            --cov-fail-under=60

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: htmlcov/
```

## Constraints
- Coverage threshold starts at 60% (will increase as more tests are added)
- Tests run in ~30s (no network calls — all mocked)
- No secrets needed (no exchange API calls in tests)

## Verification
```bash
# Validate YAML syntax
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
# Dry-run tests locally
python -m pytest -v --tb=short --co -q | wc -l
```

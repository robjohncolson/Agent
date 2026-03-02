# Phase 5 - Parallel Codex Runner

This runner extends Phase 3 with branch-per-agent execution and dependency-aware batches.

## Command

```bash
python runner/parallel-codex-runner.py --manifest dispatch/parallel-batch.manifest.json
```

Useful flags:

```bash
python runner/parallel-codex-runner.py --validate-only
python runner/parallel-codex-runner.py --dry-run --no-cc-merge
python runner/parallel-codex-runner.py --max-parallel 2 --require-clean
```

## Manifest Inputs

- `dispatch/parallel-batch.manifest.json`
- Per-agent `prompt_file`
- `owned_paths` (enforced)
- `depends_on` (dependency graph)
- `contracts` with exact `python.json_shape` and `r.json_shape`

## State Outputs

- `state/parallel-batch.json` (per-agent status + merge status)
- `state/parallel-codex-logs/*.log` (per-agent logs)
- `state/parallel-runner-errors.log` (failures)

## Execution Model

1. Resolve dependency graph into parallel batches.
2. For each batch, create `codex/{agent-name}` branch worktrees and run agents in parallel.
3. Enforce ownership boundaries by checking changed files against `owned_paths`.
4. If all agents finish, run CC merge pass on a dedicated merge branch.
5. Update `state/parallel-batch.json` at each transition.

## Evidence Mapping

- Obs `#14`: dependency graph and parallel grouping.
- Obs `#16-18`: first parallel batch hazards (duplication, shared-file collisions, signature drift).
- Obs `#35`: second batch lessons (ownership boundaries + explicit contracts + staged merge).

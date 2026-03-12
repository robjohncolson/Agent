# U6 Drill Link Verify — Dependency Graph

Spec: `design/u6-drill-link-verify-spec.md`

## Agents

| Agent | File | Description | Complexity |
|-------|------|-------------|------------|
| A | `scripts/lib/drill-url-table.mjs` | URL truth table + title matcher | S |
| B | `scripts/lib/drill-verify-report.mjs` | Report formatters (Phase 1, 2, 4 tables) | S |
| C | `scripts/verify-u6-drills.mjs` | Main script: CLI + Phases 1–4 | L |

## Waves

```
Wave 1 (parallel): Agent A, Agent B
  - No dependencies, self-contained utility modules
  - Both Codex-eligible (small, single file, clear I/O)

Wave 2 (after wave 1): Agent C (CC-direct)
  - Depends on A + B outputs
  - Imports existing infrastructure: cdp-connect, schoology-dom, schoology-heal,
    lesson-registry, resolve-folder-path
  - CC-direct: requires reading 5+ existing modules, multi-file coordination,
    complex CDP flow, repair logic
```

## File Ownership

- Agent A owns: `scripts/lib/drill-url-table.mjs`
- Agent B owns: `scripts/lib/drill-verify-report.mjs`
- Agent C owns: `scripts/verify-u6-drills.mjs`
- No overlaps

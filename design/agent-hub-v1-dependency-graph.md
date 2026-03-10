# Agent Hub v1 — Implementation Dependency Graph

## Tasks

```
A: Registry data files (repos.json, machines.json, machine-paths/colsonr-work.json)
B: JSON schemas (repo-registry, machine, machine-paths)
C: .machine-id + .gitignore update
D: Supabase table creation (agent_checkpoints)
E: scripts/lib/supabase-client.mjs (depends on D)
F: scripts/agent-startup.mjs (depends on A, C, E)
G: scripts/agent-checkpoint.mjs (depends on E)
H: session.json schema update + migration (depends on A)
```

## Dependency Graph

```
A ──────────────┐
                ├──→ F (startup script)
C ──────────────┤
                │
D ──→ E ────────┤
        │       │
        └───────┼──→ G (checkpoint script)
                │
B (independent) │
                │
H (depends on A)┘
```

## Parallelization Plan

### Wave 1 (no dependencies — run in parallel)
- **Task A**: Create registry data files
- **Task B**: Create JSON schemas
- **Task C**: Create .machine-id + update .gitignore
- **Task D**: Create Supabase agent_checkpoints table

### Wave 2 (depends on Wave 1)
- **Task E**: Create supabase-client.mjs (needs D for table name/shape)
- **Task H**: Migrate session.json schema + update session state (needs A for registry data)

### Wave 3 (depends on Wave 2)
- **Task F**: Create agent-startup.mjs (needs A, C, E)
- **Task G**: Create agent-checkpoint.mjs (needs E)

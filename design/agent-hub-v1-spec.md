# Agent Hub v1 — Cross-Machine Orchestration Layer

## Status: SPEC READY

## Problem

Agent repo is becoming the central orchestration point for all repos on the machine.
Today this works for one machine (ColsonR work PC) with hardcoded paths in `state/session.json`.
It breaks when:

- Switching to a different machine where repos live at different paths
- Session state (checkpoints) written on Machine A isn't visible on Machine B until a manual git pull
- No mechanism to detect staleness — the LLM just works with whatever's local

## Goal

Make Agent the cross-machine gateway for all repos. On startup, the LLM should:
1. Know what machine it's on
2. Know all repos across all machines and their relationships
3. Detect if local state is stale vs. another machine's recent work
4. Auto-pull to catch up before starting work

## Architecture

```
                  +------------------+
                  |    Supabase      |
                  |  (checkpoints)   |
                  +--------+---------+
                           |
              checkpoint read/write
                           |
        +------------------+------------------+
        |                                     |
  +-----+------+                      +-------+----+
  | Machine A  |                      | Machine B  |
  | Agent repo |  <--- git sync --->  | Agent repo |
  |  .machine-id = colsonr-work      |  .machine-id = home-desktop
  +-----+------+                      +-------+----+
        |                                     |
   local repos                           local repos
   (resolved via                         (resolved via
    machine-paths/)                       machine-paths/)
```

## Data Model

### registry/repos.json — Universal Repo Catalog

Keyed by slug. Contains machine-agnostic metadata only.

```json
{
  "apstats-live-worksheet": {
    "remote": "github.com/robjohncolson/apstats-live-worksheet",
    "purpose": "Student-facing live worksheets, calendars, quizzes",
    "deploy": "github-pages",
    "depends_on": ["lrsl-driller", "curriculum-render"],
    "entry_points": ["u*_lesson*_live.html", "ap_stats_roadmap_square_mode.html"],
    "domain": "teaching"
  },
  "lrsl-driller": {
    "remote": "github.com/robjohncolson/lrsl-driller",
    "purpose": "Drill game engine with cartridge system and Manim animations",
    "deploy": "vercel",
    "depends_on": [],
    "entry_points": ["platform/app.html", "cartridges/*/manifest.json"],
    "domain": "teaching"
  },
  "curriculum-render": {
    "remote": "github.com/robjohncolson/curriculum_render",
    "purpose": "Quiz renderer and Railway-hosted grading API",
    "deploy": "railway",
    "depends_on": [],
    "entry_points": ["index.html", "server.js"],
    "domain": "teaching"
  },
  "grid-bot-v3": {
    "remote": "github.com/robjohncolson/grid-bot-v3",
    "purpose": "Kraken DOGE grid trading bot with R/Shiny dashboard and Haskell state machine",
    "deploy": "railway",
    "depends_on": [],
    "entry_points": ["bot.py", "app.R", "StateMachine.hs"],
    "domain": "trading"
  },
  "cmd-line-tools": {
    "remote": "github.com/robjohncolson/cmd-line-tools",
    "purpose": "Personal CLI utilities",
    "deploy": null,
    "depends_on": [],
    "entry_points": [],
    "domain": "tools"
  }
}
```

### registry/machines.json — Known Machines

```json
{
  "colsonr-work": {
    "hostname": "LPS-YOURPC",
    "os": "win32",
    "platform_notes": "Windows 11 Education, Lynn Public Schools, no admin",
    "python": "C:/Users/ColsonR/AppData/Local/Programs/Python/Python312",
    "node": "v22.19.0",
    "shell": "bash (git bash)"
  },
  "home-desktop": {
    "hostname": "HOME-PC",
    "os": "win32",
    "platform_notes": "Windows 11 Home, full admin",
    "python": null,
    "node": null,
    "shell": null
  }
}
```

Fields for machines not yet fully profiled can be null — filled in on first use.

### registry/machine-paths/<machine-slug>.json — Per-Machine Path Mapping

```json
{
  "machine": "colsonr-work",
  "base_path": "C:/Users/ColsonR",
  "repos": {
    "apstats-live-worksheet": "C:/Users/ColsonR/apstats-live-worksheet",
    "lrsl-driller": "C:/Users/ColsonR/lrsl-driller",
    "curriculum-render": "C:/Users/ColsonR/curriculum_render",
    "grid-bot-v3": "C:/Users/rober/Downloads/Projects/grid-bot-v3",
    "cmd-line-tools": "C:/Users/ColsonR/cmd-line-tools"
  }
}
```

### .machine-id — Local Machine Identity (gitignored)

Plain text file containing the machine slug:
```
colsonr-work
```

Set once per clone. Read by startup script to resolve which machine-paths file to load.

### Supabase: `agent_checkpoints` Table

```sql
CREATE TABLE agent_checkpoints (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  machine       TEXT NOT NULL,
  agent_commit  TEXT NOT NULL,
  active_task   TEXT,
  current_project TEXT,
  session_state JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_checkpoints_created ON agent_checkpoints(created_at DESC);
```

`session_state` is the full contents of `state/session.json` at checkpoint time.
`agent_commit` is the HEAD commit of the Agent repo when the checkpoint was written.

## Scripts

### scripts/lib/supabase-client.mjs — Shared Supabase Helper

Thin wrapper that reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env`.
Exports:
- `writeCheckpoint(machineId, sessionState)` — upserts to `agent_checkpoints`
- `getLatestCheckpoint()` — returns the most recent checkpoint row
- `isStale(localCommit)` — compares local HEAD against latest checkpoint's `agent_commit`

Graceful degradation: if Supabase is unreachable, log a warning and return null. Never block startup.

### scripts/agent-startup.mjs — Startup Freshness Check

Run on Agent repo startup (can be wired into CLAUDE.md startup sequence).

```
1. Read .machine-id → current machine slug
2. Load registry/machines.json → validate machine is known
3. Load registry/machine-paths/<slug>.json → resolve local paths
4. Call supabase-client.getLatestCheckpoint()
5. Get local Agent repo HEAD commit
6. If latest checkpoint's agent_commit differs from local HEAD:
   a. Log: "Local Agent repo is behind. Auto-pulling..."
   b. Run: git pull --ff-only
   c. Re-read state files after pull
7. Read state/session.json → active task context
8. Print startup summary:
   - Current machine
   - Active task (if any)
   - Last checkpoint (when, which machine)
   - Number of known repos, how many are locally available
```

### scripts/agent-checkpoint.mjs — Write Checkpoint

Called at natural breakpoints (task completion, pipeline step done, context threshold).

```
1. Read .machine-id
2. Read state/session.json (already updated by the calling process)
3. Get Agent repo HEAD commit
4. Call supabase-client.writeCheckpoint(machineId, sessionState)
5. Git add + commit state/ changes
6. Git push
7. Log: "Checkpoint written to Supabase + pushed to git"
```

## Startup Sequence (Updated CLAUDE.md)

Replace the current "Startup Reconstruction (Phase 4)" with:

```
When Claude Code starts in this repo:
1. Run scripts/agent-startup.mjs (machine detection, staleness check, auto-pull)
2. Read state/session.json for current_project, active_task, checkpoint metadata
3. Read the project_state_file referenced in session state
4. Read registry/repos.json for the full domain picture
5. Resolve local paths via registry/machine-paths/<current-machine>.json
6. Read CONTINUATION_PROMPT.md for prose narrative
7. Read new observations after last_synced_observation_id
```

## Migration from Current State

- `session.json` `known_projects` array → migrated to `registry/repos.json` + `registry/machine-paths/colsonr-work.json`
- `session.json` `machine` and `machine_base_path` fields → derived from `.machine-id` + `registry/machines.json`
- Existing `state/project-*.json` files remain unchanged — they track per-project state, not registry metadata
- `session.json` keeps `active_task`, `current_project`, `last_checkpoint_at`, `checkpoint_trigger`, etc.
- New fields added to session schema: `agent_commit` (HEAD hash at checkpoint time)

## File Inventory (New Files)

| File | Committed | Purpose |
|------|-----------|---------|
| `registry/repos.json` | yes | Universal repo catalog |
| `registry/machines.json` | yes | Known machine profiles |
| `registry/machine-paths/colsonr-work.json` | yes | Work machine path mappings |
| `.machine-id` | **no** (gitignored) | Local machine identity |
| `scripts/lib/supabase-client.mjs` | yes | Shared Supabase helper |
| `scripts/agent-startup.mjs` | yes | Startup freshness check |
| `scripts/agent-checkpoint.mjs` | yes | Write checkpoint to Supabase + git |
| `schema/repo-registry.schema.json` | yes | Schema for repos.json |
| `schema/machine.schema.json` | yes | Schema for machines.json |
| `schema/machine-paths.schema.json` | yes | Schema for machine-paths files |

## Non-Goals for v1

See `design/agent-hub-roadmap.md` for future phases.

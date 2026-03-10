# Agent — Cross-Machine Orchestration Hub

Central command repo for managing all projects across machines. Tracks repo state, dispatches sub-agents, and synchronizes context via Supabase.

## Quick Start

```bash
npm start          # Run startup check + interactive menu
npm run startup    # Startup check only (machine detection, staleness, auto-pull)
npm run checkpoint # Write checkpoint to Supabase + git push
```

## First-Time Setup (New Machine)

1. Clone this repo
2. `npm install`
3. Copy `.env` from an existing machine (contains Supabase credentials)
4. Set your machine identity:
   ```bash
   echo 'your-machine-slug' > .machine-id
   ```
5. Add your machine to `registry/machines.json` and create `registry/machine-paths/your-machine-slug.json`
6. Run `npm run startup` to verify

## Structure

```
registry/              # What exists (slow-changing)
  repos.json           #   Universal repo catalog (7 repos)
  machines.json        #   Known machines
  machine-paths/       #   Per-machine local path mappings

state/                 # What's happening (fast-changing)
  session.json         #   Active task, checkpoint metadata
  project-*.json       #   Per-repo state snapshots
  lesson-registry.json #   Lesson content tracking

scripts/
  agent-startup.mjs    #   Machine detection + staleness check
  agent-checkpoint.mjs #   Write checkpoint to Supabase + git
  lesson-prep.mjs      #   Full lesson prep pipeline
  menu.mjs             #   Interactive TUI menu

design/                # Specs and architecture
  agent-hub-v1-spec.md #   Hub architecture spec
  agent-hub-roadmap.md #   Future phases (v2-v6)

schema/                # JSON schemas for all data files
```

## How It Works

**Startup** (`npm run startup`):
1. Reads `.machine-id` to identify the current machine
2. Checks Supabase for the latest checkpoint from any machine
3. If local repo is behind, auto-pulls to catch up
4. Prints a summary: machine, active task, repo availability

**Checkpoint** (`npm run checkpoint`):
1. Updates `state/session.json` with timestamp
2. Writes checkpoint to Supabase (machine, commit, task state)
3. Commits and pushes to git

**Cross-machine sync**: Supabase holds the latest checkpoint commit hash. When you start on a different machine, startup detects the mismatch and pulls automatically. No manual sync needed.

## Managed Repos

| Slug | Purpose | Deploy |
|------|---------|--------|
| apstats-live-worksheet | Student worksheets + calendar | GitHub Pages |
| lrsl-driller | Drill game engine + cartridges | Vercel |
| curriculum-render | Quiz renderer + grading API | Railway |
| grid-bot-v3 | DOGE grid trading bot + dashboard | Railway |
| grid-bot | Original trading bot | — |
| cmd-line-tools | Personal CLI utilities | — |
| agent | This repo | — |

## Roadmap

See [design/agent-hub-roadmap.md](design/agent-hub-roadmap.md) for v2-v6 plans:
- **v2**: Sub-agent dispatch framework
- **v3**: Auto-discovery + repo indexing
- **v4**: External visibility dashboard
- **v5**: Realtime cross-machine awareness
- **v6**: Full automation ratchet

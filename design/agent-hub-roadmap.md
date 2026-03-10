# Agent Hub — Roadmap (Future Phases)

## v1 (Current) — Cross-Machine Foundation
- Registry: repos.json, machines.json, machine-paths/
- .machine-id for local identity
- Supabase checkpoint table for staleness detection
- Startup script: detect machine, check freshness, auto-pull
- Checkpoint script: write state to Supabase + git push

## v2 — Sub-Agent Dispatch Framework
- Formalize sub-agent dispatch as a generic system (not lesson-prep-specific)
- Dispatch manifest: declare task, target repo, owned paths, expected outputs
- Agent (hub) writes scoped prompts from registry context + project state
- Sub-agent reports back: commit hashes, URLs, status, errors
- State sync: Agent auto-updates project state file after sub-agent completes
- Build on existing `runner/cross-agent.py` pattern

## v3 — Auto-Discovery & Repo Indexing
- Scan configured directories for git repos not yet in registry
- Infer purpose from README, package.json, language mix
- Propose registry entries for user approval (never auto-add)
- Periodic refresh: detect new repos, removed repos, renamed repos

## v4 — External Visibility Dashboard
- Simple web UI (or Supabase-backed API) for viewing:
  - All repos and their current state
  - Active tasks and pipeline progress
  - Cross-machine session history
  - Checkpoint timeline
- Accessible from phone/browser without launching Claude Code
- Read-only initially; control plane stays in CLI

## v5 — Realtime Cross-Machine Awareness
- Supabase Realtime subscriptions
- Machine B can watch Machine A's progress live
- Task handoff becomes instant (no waiting for checkpoint)
- Useful for: monitoring long-running pipelines from phone, pair-programming across machines

## v6 — Full Automation Ratchet
- Declarative workflow definitions (YAML/JSON)
- Pipeline templates: "lesson prep", "deploy bot", "release cartridge"
- State machine for each workflow: known states, transitions, error recovery
- All manual interventions captured as explicit decision points
- Goal: every repeated workflow eventually becomes a single command

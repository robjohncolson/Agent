# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## Checkpoint Model (Phase 4)

Use both layers on startup:
1. `state/session.json` - current project, active task, and latest checkpoint timestamp.
2. `state/project-*.json` - per-project commits, deployment status, and open issues.
3. `CONTINUATION_PROMPT.md` (this file) - narrative context, tradeoffs, and immediate next actions.

Structured state complements this prose prompt; it does not replace it.

Auto-checkpoint rule: before context pressure gets high, checkpoint around 80% context usage and refresh both the state files and this prompt before 90%.

---
## Context

You are the **Agent** — an LLM routing intelligence layer that profiles how I use different AI models and will eventually automate message routing between them. We have **completed the data-gathering phase** and now have a **working automation framework**.

### Machine: Work (ColsonR)

Base path: `C:/Users/ColsonR`

This is a **work machine** (Lynn Public Schools, Windows 11 Education). The Agent repo was cloned here and all project state files have been initialized from the repos present on this machine.

### Repos on this machine

| Repo | Path | Status | Description |
|------|------|--------|-------------|
| **apstats-live-worksheet** | `C:/Users/ColsonR/apstats-live-worksheet` | running | AP Stats single-file HTML worksheets with Railway backend + AI grading |
| **curriculum-render** | `C:/Users/ColsonR/curriculum_render` | running | AP Stats Consensus Quiz — collaborative web app, Railway server |
| **lrsl-driller** | `C:/Users/ColsonR/lrsl-driller` | running | Subject-agnostic drill platform, v4.8.0, 12 cartridges, Vercel+Railway |
| **grid-bot** | `C:/Users/ColsonR/grid-bot/doge-grid-bot` | running | Crypto grid trading bot, 3-process Railway stack (Python+R+Haskell) |
| **cmd-line-tools** | `C:/Users/ColsonR/cmd-line-tools` | running | CLI utilities for lesson processing, git workflows |
| **Agent** | `C:/Users/ColsonR/Agent` | running | This repo — LLM routing intelligence layer |

### What this repo contains

```
Agent/
  CLAUDE.md                     # Project overview + startup instructions
  CONTINUATION_PROMPT.md        # This file
  design/automation-vision.md   # Automation design (all 7 phases documented)

  profiles/                     # One JSON per LLM — accumulated characteristics
    claude-code.json            # 8 roles, confidence varies by trait (0.5-0.8)
    codex.json                  # Implementation executor (confidence 0.85)
    gemini.json                 # Visual/UX/aesthetic (confidence 0.8)
    chatgpt-deep-research.json  # Systems architecture (confidence 0.8)
    deepseek.json               # Mathematical precision (confidence 0.85)
    grok.json                   # TBD — 0 observations yet

  observations/log.json         # 42 routing observations (append-only)

  schema/                       # JSON schemas
  state/                        # Structured state (Phase 4)
    session.json                # Current project/task/checkpoint + known_projects registry
    project-apstats-live-worksheet.json
    project-curriculum-render.json
    project-lrsl-driller.json
    project-grid-bot.json
    project-cmd-line-tools.json
    project-grid-bot-v3.json    # Legacy — from home machine

  scripts/                      # Automation scripts (PowerShell)
  runner/                       # Codex execution runners
  dispatch/                     # Dispatch configuration
```

### The roster

| Model | Type | Role | Confidence |
|---|---|---|---|
| Claude Code | Terminal CLI | Hub + 8 roles (synthesizer, architect, Codex director, reviewer, merge resolver, infra debugger, architectural advisor, multi-language debugger) | 0.5-0.8 |
| Codex | Terminal CLI | Implementation executor — proven across R, Python, Bash, PowerShell, JSON schema | 0.85 |
| Gemini 3.1 Pro | Web UI (free) | Visual/UX/aesthetic — code-level UI reasoning, audience-aware. Choosy about file uploads. | 0.8 |
| GPT 5.2 Deep Research | Web UI (subscription) | Systems architecture — failure modes, citations, catches issues others miss | 0.8 |
| DeepSeek R1 | Web UI (free/maybe API) | Mathematical precision — severity taxonomy, AP Stats alignment. Best file upload handling. | 0.85 |
| Grok | Web UI (subscription) | TBD — 0 observations. File upload confirmed. Hypothesized: real-time X data, adversarial review. | 0 |

### The confirmed workflow pattern (3 complete cycles)

```
CC explores codebase → CC writes spec v1
  → CC fans out 3 review prompts (tailored per model):
      Gemini (~70 lines, visual-layer files only)
      GPT (~140 lines, full system internals)
      DeepSeek (~175 lines, all domain code — longest prompt, most files)
  → User runs stage-dispatch.ps1 → drags staging dirs into browser tabs
  → Reviews come back → user saves to staging/{specialist}/response.md
  → User runs harvest-responses.ps1 → CC reads harvested responses
  → CC synthesizes all 3 → spec v2
  → CC writes per-phase Codex implementation prompts
  → codex-runner.sh (sequential) or parallel-codex-runner.py (parallel)
  → CC reviews → CC commits/pushes
```

### Key constraints

- No API keys for ChatGPT, Gemini, or Grok (web subscriptions only)
- DeepSeek maybe has API access
- All 4 web UIs support file upload (DeepSeek best, Gemini choosiest)
- CC↔Codex automation fully tooled (both CLIs, runners exist)
- **Work machine note**: Python not on PATH in Git Bash — may need `py` or full path for runner scripts

### What to do next

1. **Verify toolchain** — check that Codex CLI, Node, and Python are accessible on this machine
2. **First live dispatch cycle** using the automation tools on one of the work machine repos
3. **Profile Grok** — include in next review cycle (still 0 observations)
4. **Test cross-agent delegation** on this machine (CC→Codex via runner/cross-agent.py)
5. Continue logging observations as workflow evolves

I am a high school math teacher building educational tools. My main projects are AP Statistics teaching tools: live worksheets, a consensus quiz app, and a drill platform. The grid-bot is an AP Stats teaching tool built around a live crypto trading bot. I'll keep narrating my multi-LLM workflow — you keep building the routing intelligence.

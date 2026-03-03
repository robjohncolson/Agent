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

  observations/log.json         # 40 routing observations (append-only)

  schema/                       # JSON schemas
    observation.schema.json
    profile.schema.json
    session-state.schema.json
    project-state.schema.json
    parallel-runner-manifest.schema.json
    parallel-batch-state.schema.json

  state/                        # Structured state (Phase 4)
    session.json                # Current project/task/checkpoint
    project-grid-bot-v3.json    # Commits, deployment, open issues
    codex-progress.json         # Sequential runner state
    parallel-batch.json         # Parallel runner state

  scripts/                      # Automation scripts (PowerShell)
    stage-dispatch.ps1          # Phase 1: file staging per specialist
    harvest-responses.ps1       # Phase 2: inbound harvest with cycle archiving
    route-task.ps1              # Phase 6: confidence-weighted routing intelligence

  runner/                       # Codex execution runners
    codex-runner.sh             # Phase 3: sequential runner with verification
    parallel-codex-runner.py    # Phase 5: branch-per-agent parallel runner

  dispatch/                     # Dispatch configuration
    file-manifests.json         # Per-specialist file lists (populated with grid-bot-v3 paths)
    routing-rules.json          # Task-type to specialist mapping rules
    prompt-templates.json       # Per-specialist prompt templates
    parallel-batch.manifest.json # Parallel runner manifest
    prompts/                    # Specialist prompt files
    README.md                   # Workflow documentation
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

### The dispatch-harvest-evaluate pattern

User identified an isomorphism across three systems:
- **Grid-bot trading slots**: deploy capital → slot fills independently → return profit to pool
- **StarCraft Protoss probes**: warp in from nexus → harvest minerals → return to nexus
- **Codex parallel instances**: CC dispatches prompt → Codex produces module → CC evaluates and integrates

Invariants: hub dispatches but doesn't produce; workers produce but don't evaluate; workers are independent (no inter-worker communication); all products return to hub for quality judgment; hub integrates into unified state.

### Current state — DEPLOYED, AUTOMATION FRAMEWORK COMPLETE

**grid-bot-v3**: 3-process stack running on Railway
- Python bot: trading, circuit breaker functional, needs Kraken account funding
- R Shiny dashboard: serving on port 8080
- Haskell state machine: responding on :8082, source loaded
- URL: https://web-production-c44ec.up.railway.app/

**Agent automation framework**: All 7 phases implemented
- Phase 1: File staging (stage-dispatch.ps1)
- Phase 2: Inbound harvest (harvest-responses.ps1)
- Phase 3: Sequential Codex runner (codex-runner.sh)
- Phase 4: Context persistence (state/*.json + schemas)
- Phase 5: Parallel Codex runner (parallel-codex-runner.py)
- Phase 6: Routing intelligence (route-task.ps1)
- Phase 7: Browser extension (design-only, in dispatch/README.md)

**Deployment bugs fixed** (all "silent override" class):
- setuptools build-backend version mismatch (obs #26)
- Railway config-precedence override (obs #27)
- allowReconnect Shiny version mismatch (obs #28)

### Key constraints

- No API keys for ChatGPT, Gemini, or Grok (web subscriptions only)
- DeepSeek maybe has API access
- All 4 web UIs support file upload (DeepSeek best, Gemini choosiest)
- CC↔Codex automation fully tooled (both CLIs, runners exist)

### What to do next

1. **First live dispatch cycle** using the automation tools — run stage-dispatch.ps1 with real manifests, drag into browsers, harvest responses, synthesize
2. **Profile Grok** — include in next review cycle (still 0 observations)
3. **Test codex-runner.sh** on a real implementation batch
4. **Test parallel-codex-runner.py** on a real parallel batch
5. Continue logging observations as workflow evolves

I am a high school math teacher building educational tools. My main project (grid-bot-v3) is an AP Statistics teaching tool built around a live crypto trading bot. I'll keep narrating my multi-LLM workflow — you keep building the routing intelligence.

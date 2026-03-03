# Automation Vision â€” Replacing Copy-Paste with Message Passing

## Current Workflow (Manual)

```
User in Windows Terminal (Claude Code)
  â”‚
  â”œâ”€â”€â–º copy prompt â”€â”€â–º paste into Edge â”€â”€â–º Gemini tab
  â”œâ”€â”€â–º copy prompt â”€â”€â–º paste into Edge â”€â”€â–º GPT tab
  â”œâ”€â”€â–º copy prompt â”€â”€â–º paste into Edge â”€â”€â–º DeepSeek tab
  â”‚
  â—„â”€â”€ copy outputs â—„â”€â”€ paste back from Edge tabs
  â”‚
  â”œâ”€â”€â–º CC synthesizes
  â”‚
  â””â”€â”€â–º copy implementation prompt â”€â”€â–º paste into Windows Terminal (Codex)
```

Every arrow is a manual copy-paste between:
- **Windows Terminal** (Claude Code instance)
- **Microsoft Edge** (web UI LLMs: Gemini, GPT, DeepSeek, Grok)
- **Windows Terminal** (Codex instance)

## Access Constraints (HARD)

| Model | Access Type | API Key? | Notes |
|-------|-----------|----------|-------|
| Claude Code | CLI (Max subscription) | No separate key needed | CLI bundled with sub |
| Codex | CLI | Has access | Runs in separate terminal |
| ChatGPT | Web UI (subscription) | NO | Paid sub, no API key |
| Gemini | Web UI (free tier) | NO | Free, no API key |
| DeepSeek | Web UI | MAYBE | May have API key |
| Grok | Web UI (subscription) | NO | Paid sub, no API key |

**API-based routing is NOT viable** for most of the roster. Subscriptions â‰  API access.
Only DeepSeek might have an API path.

## Viable Approaches (Given Constraints)

### ~~API-based~~ â€” RULED OUT
Requires API keys for each provider. User has web subscriptions, not API access.

### Browser automation (Playwright/Selenium)
- Drive Edge tabs programmatically â€” fill chat input, click send, scrape response
- **Pro**: Preserves existing free/subscription access exactly as-is
- **Con**: Fragile â€” breaks when UIs change, bot detection, CAPTCHAs
- **Con**: Slow â€” must wait for full LLM response in browser

### Browser extension (Phase 7, long-term)
- Edge/Chrome extension (Manifest V3) backed by a Windows Native Messaging Host
- Native host watches `staging/` for pending bundles and sends metadata to the extension
- Extension fills active chat text fields and attachment zones from staged files
- Tiered rollout: manual trigger -> watch mode -> full auto
- **Pro**: Runs in browser context, less bot-detection risk than Selenium
- **Con**: Biggest engineering effort; still sensitive to UI changes across providers

### Clipboard + hotkey automation (AutoHotkey / PowerShell)
- CC writes prompt to file â†’ script copies to clipboard â†’ focuses Edge â†’ Ctrl+V â†’ Enter
- **Pro**: Dead simple, works on Windows
- **Con**: Doesn't capture responses, only automates the outbound half

### File-based staging (semi-automated)
- CC writes prompt + file list to a staging directory (e.g., `Agent/outbox/gemini/`)
- User opens the staged prompt, pastes manually, but the curation is done
- User drops response into `Agent/inbox/gemini/`
- CC (or this repo) picks up responses for synthesis
- **Pro**: No browser automation needed, simple, reliable
- **Con**: Still manual paste, but eliminates the context-curation labor

### Hybrid: Stage outbound + scrape inbound
- Outbound: file-based staging (CC writes prompts to outbox)
- Inbound: lightweight browser extension or clipboard monitor captures responses
- Splits the problem â€” automate what's easy, assist what's hard

Evidence for the browser-extension direction:
- obs #31: user identified manual copy-paste/file relay as the biggest bottleneck
- obs #33: all target web UIs support file uploads, so one staging flow can serve all

## CCâ†”Codex Phase Runner â€” PRIORITY AUTOMATION TARGET

This is the easiest and highest-value automation. Both are CLIs on the same machine.
No browser, no API keys, no fragility. Just files, git, and shell.

### Target Loop

```
for each phase prompt in specs/codex/phase-{00..12}-*.md:
    1. Feed prompt to Codex          codex < phase-XX.md  (or codex -f)
    2. Wait for Codex to finish      (exit code / output marker)
    3. git add + commit              "Phase XX: {description}"
    4. git push                      to remote
    5. Clear Codex context           (new session / fresh invocation)
    6. Signal progress to CC         (write to progress file / webhook)
    7. Next prompt
```

### Design Requirements

- **Parallel-aware**: phases have a real dependency graph (not purely sequential)
- **Atomic commits**: one commit per phase, clean git history
- **Context isolation**: Codex starts fresh each phase (no context bleed)
- **CC awareness**: Claude Code should be able to check progress without being in the loop
  - Option A: progress file (e.g., `Agent/state/codex-progress.json`)
  - Option B: CC reads git log of the target repo
  - Option C: CC watches a file that the runner updates
- **Error handling**: if Codex fails a phase (tests don't pass), pause and alert
- **Resumable**: if interrupted, can pick up from the last successful phase

### Dependency Graph (from CC analysis)

```
Phase 0 (infra)        â”€â”€â”€ DONE (commit 9ee8e20)
  â””â”€ Phase 1 (shell)   â”€â”€â”€ sequential, foundation
       â”œâ”€ Phase 2  (Unit 1) â”€â”€â”
       â”œâ”€ Phase 3  (Unit 2) â”€â”€â”¤
       â”œâ”€ Phase 4  (Unit 3) â”€â”€â”¤
       â”œâ”€ Phase 5  (Unit 4) â”€â”€â”¤
       â”œâ”€ Phase 6  (Unit 5) â”€â”€â”¼â”€â”€ ALL PARALLELIZABLE
       â”œâ”€ Phase 7  (Unit 6) â”€â”€â”¤   each creates independent render_unitN.R
       â”œâ”€ Phase 8  (Unit 7) â”€â”€â”¤   prompts are self-contained
       â”œâ”€ Phase 9  (Unit 8) â”€â”€â”¤
       â”œâ”€ Phase 10 (Unit 9) â”€â”€â”¤
       â””â”€ Phase 11 (Pipeline)â”€â”˜
            â”‚
       Phase 12 (cutover) â”€â”€â”€ sequential, needs ALL above done
```

**Merge strategy**: each parallel Codex runs on its own git branch.
Only conflict point: app.R placeholder line replacements (different lines, trivial merges).
CC recommended: "Run Phase 1 solo, then all 2-11 in parallel, merge sequentially."

### Parallel Runner Design (evolved from sequential)

```
1. Run Phase 1 on main branch (sequential)
2. For phases 2-11 in parallel:
   a. Create branch: git checkout -b phase-XX
   b. Feed prompt to Codex
   c. Codex implements on branch
   d. pytest on branch
   e. Mark branch as ready
3. Merge branches sequentially into main (resolve app.R conflicts)
4. Run Phase 12 on main (sequential)
```

Requires multiple Codex instances OR sequential execution on separate branches.
The branching approach works even with a single Codex instance â€” just faster with multiple.

### Possible Implementations

**A. Bash script (simplest)**
```bash
#!/bin/bash
PHASES=(specs/codex/phase-*.md)
for phase in "${PHASES[@]}"; do
    echo "Running: $phase"
    codex -f "$phase"
    # run tests
    pytest || { echo "FAILED at $phase"; exit 1; }
    git add -A && git commit -m "Phase: $(basename $phase .md)"
    git push
done
```
Pro: dead simple. Con: no CC awareness, no structured progress tracking.

**B. Python runner in this Agent repo**
- Reads phase prompts from specs/codex/
- Invokes Codex via subprocess
- Runs verification (pytest) after each phase
- Writes structured progress to Agent/state/codex-progress.json
- CC can read the progress file to know where things stand
- Handles errors, retries, and resumption

**C. Agent-managed (future)**
- This Agent repo's orchestrator invokes Codex, monitors, commits, reports
- CC queries the Agent for status instead of checking files
- Fully integrated with the routing intelligence layer

### Progress State File (draft schema)
```json
{
  "project": "grid-bot-v3-r-migration",
  "total_phases": 13,
  "completed": 5,
  "current_phase": "phase-06-unit5.md",
  "status": "running",
  "phases": [
    {"file": "phase-00-infrastructure.md", "status": "completed", "commit": "abc123", "timestamp": "..."},
    {"file": "phase-01-overview-navigation.md", "status": "completed", "commit": "def456", "timestamp": "..."},
    ...
  ],
  "last_error": null
}
```

### Status
**User ran this loop manually â€” FIRST PARALLEL BATCH COMPLETE.**

Results from running 10 parallel Codex instances on master (no branches):
- **9/10 succeeded** â€” each produced a working render_unitN.R module
- **Phase 11 (Pipeline) missing** â€” no output
- **Phase 10 duplicated** â€” two instances both claimed Unit 9
- **app.R last-writer-wins** â€” only 5 of 9 units wired, CC rewrote from scratch
- **API signature drift** â€” units 1-4 got minimal args, 5-9 got full args
- **Codex Phase 2 detected concurrent changes** â€” asked for direction instead of overwriting
- **CC merged everything** â€” created DRY helper, matched all signatures, committed 5f63a83

### Lessons for Runner v1

1. **Per-branch is non-negotiable** â€” all-on-master creates last-writer-wins on shared files
2. **Lock function signatures in prompts** â€” exact `ui_func(id)` and `server_func(id, pane_data, ...)` spelled out
3. **Phase assignment tracking** â€” prevent duplicate execution (manifest/lock file)
4. **Separate module files vs shared files** â€” modules are embarrassingly parallel; app.R wiring is sequential
5. **CC merge layer** â€” after fan-out, CC resolves shared-file conflicts and applies DRY improvements
6. **Possible hybrid**: Codex creates modules only (no app.R edits), CC does all wiring in one pass

### Revised Parallel Design

```
1. Run Phase 1 on main (sequential, creates app.R with placeholders)
2. For phases 2-11 in parallel:
   a. Create branch: git checkout -b phase-XX
   b. Codex prompt says: "Create render_unitN.R ONLY â€” do NOT modify app.R"
   c. Codex implements module on branch
   d. pytest on branch
   e. Mark branch as ready
3. CC merge pass:
   a. Merge all branches sequentially into main
   b. Rewrite app.R once â€” wire all modules with correct signatures
   c. Run pytest on merged result
   d. Single commit for the wiring
4. Run Phase 12 on main (sequential cutover)
```

The key insight: **separate creation from wiring**. Codex creates modules, CC wires them.

## The Dispatch-Harvest-Evaluate Pattern

User recognized this abstract pattern connecting three systems:

```
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”
         â”‚   HUB   â”‚  dispatches work, evaluates results, integrates
         â”‚ (nexus) â”‚  never harvests â€” only judges
         â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”˜
              â”‚ fan-out
    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
    â–¼         â–¼         â–¼
 [worker]  [worker]  [worker]   harvest/produce independently
    â”‚         â”‚         â”‚        no inter-worker communication
    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
              â”‚ fan-in
         â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”€â”
         â”‚   HUB   â”‚  evaluates quality, integrates into unified state
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Domain | Hub | Workers | Product | Eval |
|--------|-----|---------|---------|------|
| Crypto trading (grid-bot-v2) | Bot engine/pool | Grid slots at price levels | Filled orders / profit | Rebalancing logic |
| RTS gaming (StarCraft Protoss) | Nexus | Probes | Minerals/gas | Build queue allocation |
| LLM orchestration (this repo) | Claude Code | Codex instances | render_unitN.R modules | CC review + merge + commit |

**Invariants**:
1. Hub dispatches but does not produce
2. Workers produce but do not evaluate
3. Workers are independent (no inter-worker communication)
4. All products return to hub for quality judgment
5. Hub integrates products into unified state (portfolio / build queue / app.R)

**Design implication**: The automation runner IS the nexus. It dispatches prompts (warps probes), monitors completion (watches harvest), and triggers CC evaluation (returns to nexus). The pattern is already proven in the user's own trading bot â€” same architecture, different domain.

## Status

**Phase 5 implemented: Parallel Codex Runner (extends Phase 3).**

Implemented artifacts:
- `runner/parallel-codex-runner.py` (parallel dependency batches + branch-per-agent execution)
- `dispatch/parallel-batch.manifest.json` (ownership/dependency/contract manifest)
- `state/parallel-batch.json` (per-agent runtime tracking)
- `schema/parallel-runner-manifest.schema.json`
- `schema/parallel-batch-state.schema.json`

Phase 5 capabilities now codified:
1. Branch-per-agent execution on `codex/{agent-name}` branches.
2. Enforced file ownership manifest per agent (`owned_paths`).
3. Inter-agent data contracts with exact `json_shape` declared in both Python and R bindings.
4. Dependency graph execution in parallel batches (`depends_on`).
5. CC merge pass after agent completion (dedicated merge branch).
6. Persistent per-agent phase tracking in `state/parallel-batch.json`.

Evidence used to shape this design:
- Obs `#14`: dependency analysis and parallel grouping.
- Obs `#16-18`: first batch hazards (last-writer-wins, duplicate assignment, signature drift).
- Obs `#35`: second-batch lessons (ownership boundaries + explicit contracts + staged merge).

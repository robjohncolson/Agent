# Agent: Global CLAUDE.md Setup

## Phase
P1-foundation | No dependencies | Working dir: `C:/Users/ColsonR`

## Objective
Create `~/.claude/CLAUDE.md` with global rules that prevent the top 3 friction patterns observed across 45 sessions.

## Context (Why This Matters)
- **18% of sessions** had fixes that missed the actual root cause, costing real money on the trading bot
- **11% of sessions** had Claude acting before understanding intent (coding when analysis was wanted)
- **9% of sessions** hit environment mismatches (missing tools, wrong PATH)

## Read First
1. `IMPROVEMENT_SPEC.md` — Section 4.1 for the exact CLAUDE.md content
2. `.claude/settings.json` — existing config (has GitNexus hooks, effort=high)

## Owned Paths
- `.claude/CLAUDE.md`

## Implementation

Create `C:/Users/ColsonR/.claude/CLAUDE.md` with these sections:

### 1. Intent Confirmation Gate
Before starting work, confirm what the user wants: analysis/plan vs. implementation.
Do not begin coding or exploring the codebase until the scope is clear.
If resuming from a prior session, ask which task to prioritize — do not assume.

### 2. Debugging Protocol (Mandatory for Bug Fixes)
```
1. Enumerate ALL code paths that could produce the observed behavior
   - List each with file:line references
   - Include: direct paths, startup/init paths, deep-link/URL restoration paths,
     companion/secondary trigger paths, degraded/recovery mode paths
2. Present the audit to the user — do NOT write fix code yet
3. Only after user confirms, implement fix covering EVERY identified path
4. For state machine / fill detection / order logic: enumerate ALL trigger paths
5. Verify root cause before implementing — no diagnostic-only patches
```

### 3. Git Workflow
- After committing, always `git push` and confirm success
- Check for `gh` CLI before attempting PR creation; if missing, provide manual URL
- Never force-push to main/master without explicit approval

### 4. Environment Awareness
```
Platform: Windows 11, Git Bash (Unix syntax)
Python: 3.12 at C:/Users/ColsonR/AppData/Local/Programs/Python/Python312
Node: v22.19.0 (nvm)
Admin: NO (system installs fail — Chocolatey, etc.)
LaTeX: MiKTeX (may need PATH refresh after install)
Codex: GPT-5.4, config at ~/.codex/config.toml
GitNexus: Installed with PreToolUse hooks (8s timeout)
```

## Constraints
- Do NOT modify `.claude/settings.json` (hooks are already configured)
- Keep CLAUDE.md under 200 lines (it's loaded into every conversation context)
- Use concise, imperative language — these are rules, not suggestions

## Verification
```bash
test -f C:/Users/ColsonR/.claude/CLAUDE.md && echo "OK" || echo "MISSING"
wc -l C:/Users/ColsonR/.claude/CLAUDE.md  # Must be < 200
```

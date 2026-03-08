# Agent: Custom Skills Setup

## Phase
P1-foundation | No dependencies | Working dir: `C:/Users/ColsonR`

## Objective
Create 5 custom Claude Code skills in `~/.claude/skills/` for the most-repeated workflows.

## Context: Why These 5 Skills
Based on 45 sessions:
- **Commit-push** appeared in 25+ sessions (→ `/push`)
- **Trading bot debugging** appeared in 22 sessions with recurring friction (→ `/botfix`)
- **Analysis-only requests** were misunderstood in 5 sessions (→ `/analyze`)
- **Lesson prep** appeared in 8 sessions with repeated re-explanation (→ `/lessonprep`)
- **Cartridge creation** appeared in 5 sessions (→ `/cartridge`)

## Owned Paths
```
.claude/skills/push/SKILL.md
.claude/skills/botfix/SKILL.md
.claude/skills/analyze/SKILL.md
.claude/skills/lessonprep/SKILL.md
.claude/skills/cartridge/SKILL.md
```

## Skill Definitions

### /push — Commit & Push
```
~/.claude/skills/push/SKILL.md
```
1. `git status` — if no changes, say so and stop
2. `git diff --stat` for change summary
3. `git log --oneline -5` to match commit style
4. Stage changed files BY NAME (not `git add -A`). Exclude .env, credentials, binaries.
5. Generate concise commit message (what + why)
6. Commit with Co-Authored-By trailer
7. `git push`. If diverged: `git pull --rebase` then retry once.
8. Confirm: commit hash, branch, remote URL.

### /botfix — Trading Bot Bug Fix Protocol
```
~/.claude/skills/botfix/SKILL.md
```
**Dependency-aware debugging sequence:**
1. `git pull` to sync with remote
2. Ask user: observed behavior, expected behavior, log lines
3. **ANALYSIS PHASE (no code changes):**
   a. Identify ALL code paths that could produce the behavior
   b. For each: file:line, trigger condition, data flow
   c. Mandatory checklist — check these paths:
      - [ ] Normal fill flow (state_machine.transition → FillEvent)
      - [ ] Startup reconciliation (main.py init → ledger replay)
      - [ ] Orphan recovery (RecoveryFillEvent/CancelEvent)
      - [ ] Degraded modes (S0_long_only, S0_short_only, S1a_short_only, S1b_long_only)
      - [ ] Governor post-tick (growth snapshots, recovery TTL)
      - [ ] Fee path (config.MAKER_FEE_PCT → cycle profit → ledger → dashboard)
   d. Present analysis. **WAIT for user confirmation.**
4. **TEST PHASE:**
   a. Write failing test reproducing the bug
   b. Run pytest to confirm it fails
5. **FIX PHASE:**
   a. Implement minimal fix covering ALL identified paths
   b. Run new test + full suite
   c. Iterate until green
6. Ask if user wants to /push

### /analyze — Analysis Only Mode
```
~/.claude/skills/analyze/SKILL.md
```
**ANALYSIS MODE — NO CODE CHANGES.**
1. Read relevant source files
2. Investigate the topic/question
3. Present structured findings:
   - Summary
   - Evidence (file:line references)
   - Options/recommendations
   - Risks
4. Do NOT edit files. Do NOT run state-modifying commands.
5. Wait for user to decide next steps.

### /lessonprep — Lesson Prep Pipeline
```
~/.claude/skills/lessonprep/SKILL.md
```
**Dependency-ordered lesson generation:**

Given unit + lesson (e.g., "Unit 6 Lesson 3"):

```
Step 1: TRANSCRIPT (no dependencies)
  └─ Check: apstats-live-worksheet/u{N}/ for existing transcripts
  └─ If missing: warn that Gemini is dormant, offer AI Studio or Whisper

Step 2: RUBRIC (depends on: Step 1 transcript)
  └─ Check: ai-grading-prompts-u{N}-l{L}.js
  └─ If missing: generate from curriculum_render/data/frameworks.js

Step 3: WORKSHEET (depends on: Step 1 + Step 2)
  └─ Check: u{N}_lesson{L}_live.html
  └─ If missing: generate using live-worksheet skill

Step 4: BLOOKET (depends on: Step 2 rubric)  ← CAN PARALLEL with Step 3
  └─ Check: u{N}_l{L}_blooket.csv
  └─ If missing: generate using blooket-quiz skill

Step 5: REPORT
  └─ List what was created / already existed
  └─ Ask if user wants to commit and push
```

### /cartridge — New Cartridge Generator
```
~/.claude/skills/cartridge/SKILL.md
```
**Dependency-ordered cartridge creation:**

1. Ask for: subject, topic, mode count, difficulty progression
2. **Generate in order (each depends on previous):**
   ```
   Step 1: manifest.json (modes, inputFields, hints, progression gates, animation refs)
     ↓ defines the contract for all other files
   Step 2: generator.js (generateProblem per mode, shuffle-bag, template interpolation)
     ↓ must match manifest.modes[].inputFields
   Step 3: grading-rules.js (gradeField per fieldId, E/P/I scoring)
     ↓ must match generator.js field IDs
   Step 4: ai-grader-prompt.txt ({{placeholders}} matching grading-rules fields)
   ```
3. Register in `cartridges/registry.json`
4. Run `npm test` to verify no regressions
5. Ask if user wants to commit

## Verification
```bash
for skill in push botfix analyze lessonprep cartridge; do
  test -f ~/.claude/skills/$skill/SKILL.md && echo "$skill: OK" || echo "$skill: MISSING"
done
```

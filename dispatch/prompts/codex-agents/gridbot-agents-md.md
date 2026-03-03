# Codex Prompt: Agent C — Grid-bot-v3 AGENTS.md + Codex Skills

## Context

You are working in the grid-bot-v3 repo at `C:\Users\rober\Downloads\Projects\not-school\grid-bot-v3`.
This is a crypto trading bot that doubles as an AP Statistics teaching tool, deployed on Railway.

The project is orchestrated by a multi-LLM system where Claude Code (CC) acts as the hub, and Codex acts as the implementation executor. CC writes specs and prompts, Codex implements them. CC reviews and commits.

The Agent repo at `C:\Users\rober\Downloads\Projects\Agent` tracks routing profiles and observations about this workflow.

## Task

Create three files that make Codex routing-aware when working in grid-bot-v3.

### 1. `AGENTS.md` (repo root)

This is Codex's equivalent of CLAUDE.md — instructions loaded automatically on every session.

**Content should cover**:

- **Project overview**: 3-process stack (Python bot, R Shiny dashboard, Haskell state machine) on Railway
- **Architecture**: Python (infra/, stats/, viz/), R Shiny (shiny/), Haskell (haskell/), Docker+supervisord
- **Routing context**: This project is orchestrated by CC using the Agent repo. CC dispatches tasks to Codex with explicit file ownership and scope constraints. Codex should:
  - Only modify files listed in the prompt's "Files You Own" section
  - Never make architectural decisions — escalate to CC
  - Report what was done, what was tested, what couldn't be verified
  - Follow any data contracts specified in the prompt (exact field names/types)
- **File ownership pattern**: When a prompt specifies owned files, those are the ONLY files Codex should modify. If changes to other files are needed, note them but don't make them.
- **Testing**: `pytest` for Python, `Rscript -e "parse('file.R')"` for R syntax (if Rscript available), `bash -n` for shell scripts
- **Commit convention**: Don't commit — CC handles all commits after review
- **Progress reporting**: After completing work, summarize: files changed, tests run, issues found, what couldn't be verified

### 2. `.agents/skills/phase-report/SKILL.md`

A Codex skill that structures the completion report.

**Skill definition**:
```yaml
---
name: phase-report
description: Generate a structured completion report after finishing a phase of work.
---
```

**Instructions**: After completing the assigned task, generate a report with:
- **Phase**: [phase name/number from the prompt]
- **Files changed**: list with brief description of each change
- **Files created**: list of new files
- **Tests run**: which tests passed/failed, with counts
- **Verification gaps**: what couldn't be verified (e.g., Docker build, R parse, deployment)
- **Issues found**: any blockers, unexpected state, or decisions deferred to CC
- **Data contracts**: if the prompt specified a data contract, confirm the exact field names and types match

### 3. `.agents/skills/auto-commit/SKILL.md`

A Codex skill for committing (only when explicitly instructed by the prompt).

**Skill definition**:
```yaml
---
name: auto-commit
description: Commit changes with a descriptive message following project conventions.
---
```

**Instructions**: When the prompt explicitly says to commit:
- Stage only the files listed in "Files You Own" (never `git add -A`)
- Write a commit message: `Phase [N]: [brief description]`
- Include a body listing files changed
- Do NOT push (CC handles push after review)
- If the prompt does NOT say to commit, do NOT commit

## Files You Create

In grid-bot-v3 (`C:\Users\rober\Downloads\Projects\not-school\grid-bot-v3`):
```
AGENTS.md                              # NEW — project-level Codex instructions
.agents/skills/phase-report/SKILL.md   # NEW — completion report skill
.agents/skills/auto-commit/SKILL.md    # NEW — commit skill
```

## Files You May NOT Modify

- Any existing source code in grid-bot-v3 (infra/, stats/, viz/, shiny/, haskell/)
- Any file in the Agent repo
- `~/.codex/config.toml`
- `.claude/` directories

## Validation

1. Verify AGENTS.md is readable: `cat AGENTS.md | head -5`
2. Verify skill directories exist: `ls .agents/skills/phase-report/SKILL.md .agents/skills/auto-commit/SKILL.md`
3. Verify AGENTS.md is under 32KB (Codex default project_doc_max_bytes): `wc -c AGENTS.md`

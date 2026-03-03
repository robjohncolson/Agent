# Dispatch + Harvest Workflow

This folder now supports both halves of the web UI review loop:
- Phase 1 outbound dispatch: stage prompts and source files in `staging/{specialist}`
- Phase 2 inbound harvest: read `staging/{specialist}/response.md` and archive/diff each review cycle

## One-time setup

1. Edit `dispatch/file-manifests.json`
2. Set `source_root` to your real project path (the codebase being reviewed)
3. Paste each specialist prompt into `dispatch/prompts/{specialist}.md`
4. Fill each specialist `files` list with the manifest paths from your routing doc

## Phase 1 - Outbound Dispatch

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stage-dispatch.ps1
```

Optional: stage only selected specialists.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stage-dispatch.ps1 -Specialists gemini,chatgpt
```

Each specialist staging folder includes:
- `PROMPT.md`
- copied manifest files
- optional Gemini `.R.txt` mirrors
- `response.md` (template file for inbound review output)
- `STAGED_FILES.txt`

Safety: if `response.md` already contains real text, rerunning dispatch fails to prevent accidental deletion. Run Phase 2 harvest first, or override with `-AllowResponseDiscard`.

## Phase 2 - Inbound Harvest

After each web UI specialist responds, save the full review into:
- `staging/{specialist}/response.md`

Then harvest and diff:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\harvest-responses.ps1
```

Optional: harvest only selected specialists.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\harvest-responses.ps1 -Specialists gemini,chatgpt,deepseek
```

Optional: force a specific cycle id.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\harvest-responses.ps1 -CycleId 20260302-cycle-a
```

By default, harvest resets each processed `staging/{specialist}/response.md` back to the template so the next cycle starts cleanly. To keep raw responses in place, pass `-KeepStagingResponses`.

Evidence:
- obs #4 and obs #9: CC synthesis currently depends on three pasted review outputs
- Phase 2 converts that fan-in step to file-based inputs (`latest/{specialist}.md`)

## Output Layout

Dispatch output:

```
staging/
  gemini/
    PROMPT.md
    response.md
    STAGED_FILES.txt
    ...copied source files...
    ...optional .R.txt mirrors...
  chatgpt/
  deepseek/
  grok/
```

Harvest output:

```
staging/
  _harvest/
    latest/
      gemini.md
      chatgpt.md
      deepseek.md
      grok.md
    cycles/
      20260302-101530/
        HARVEST_SUMMARY.md
        responses/
          gemini.md
          chatgpt.md
          deepseek.md
          grok.md
        diffs/
          gemini.diff
          chatgpt.diff
          deepseek.diff
          grok.diff
```

Use `latest/*.md` (one markdown file per specialist) as CC synthesis input. Use `cycles/*/diffs/*.diff` to track what changed between review cycles.

## Phase 5 - Parallel Codex Runner Manifests

`dispatch/parallel-batch.manifest.json` is the Phase 5 execution plan for Codex parallel branches.

It defines:
- Agent branches (`codex/{agent-name}`)
- Enforced file ownership (`owned_paths`)
- Dependency graph (`depends_on`)
- Inter-agent contracts with exact Python/R `json_shape`
- Evidence references (`obs #14`, `#16-18`, `#35`)

## Phase 6 - Routing Intelligence (data-driven dispatch)

`scripts/route-task.ps1` adds profile-driven dispatch planning before staging:

- Uses all 6 profiles to score specialist fit
- Applies confidence-weighted routing
- Infers task type and task mode (`review`, `audit`, `brainstorm`) from task description
- Auto-generates file manifests from task type + project structure
- Auto-generates prompt files from specialist templates

Evidence encoded in `dispatch/routing-rules.json`:

- all 6 profiles as routing inputs
- observation `#30` (file manifest codification)
- 3 confirmed review cycles (`#34` confirms 3/3 fan-out pattern)

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\route-task.ps1 `
  -TaskDescription "Audit AP Stats chart correctness and identify misleading outputs" `
  -SourceRoot "C:\path\to\project"
```

Optional explicit routing controls:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\route-task.ps1 `
  -TaskDescription "Brainstorm architecture options for 3-process deployment" `
  -TaskType architecture-review `
  -TaskMode brainstorm `
  -TopN 3 `
  -MinScore 0.40 `
  -SourceRoot "C:\path\to\project"
```

Generated artifacts:

- `dispatch/routing-plan.generated.json`
- `dispatch/file-manifests.generated.json`
- `dispatch/generated-prompts/{specialist}.md`

Then stage with the generated manifest:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stage-dispatch.ps1 `
  -ManifestPath .\dispatch\file-manifests.generated.json
```

## Phase 7 - Browser Extension (long-term, biggest effort)

Status: design target only, not implemented yet.

- Edge/Chrome extension (Manifest V3) paired with a Windows Native Messaging Host
- Native host watches `staging/` for newly staged bundles
- Extension fills the active web UI text field and attachment zone from staged files

### Automation tiers

1. Manual trigger: click extension action to fill/attach from the current staged bundle
2. Watch mode: extension preloads when new staged content appears for the active specialist
3. Full auto: fill + attach + optional send based on explicit policy/guardrails

### Evidence

- obs #31: user identified manual copy-paste and file relay as the primary friction
- obs #33: all target web UIs support file upload, enabling one file-staging pipeline

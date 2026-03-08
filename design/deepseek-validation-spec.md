# DeepSeek Validation Layer Spec

**Status**: Approved
**Date**: 2026-03-08
**Affects**: `scripts/lib/llm-check.mjs` (new), `scripts/lesson-prep.mjs`, `.env.example` (new)

## Overview

Adds semantic validation to the lesson-prep pipeline using the DeepSeek API. All current validation is structural (file size, CSV format, manifest keys). This spec adds 4 LLM-powered checkpoints that catch content-level issues before they reach students.

## Design Principles

1. **Graceful degradation**: If `DEEPSEEK_API_KEY` is not set, all checks are silently skipped. Pipeline behavior is identical to today.
2. **Non-blocking by default**: LLM checks warn but do not abort. A `--strict-llm` flag makes failures fatal.
3. **Caching**: Results are cached per content hash for the duration of the pipeline run (in-memory Map). No disk caching.
4. **Timeout**: Each LLM call has a 30-second timeout via `AbortSignal.timeout()`.

---

## Core Module: `scripts/lib/llm-check.mjs`

### Exports

```js
export async function checkWithLLM(prompt, content, options?)
// Returns: { ok: boolean, issues: string[], raw: string }

export async function analyzeError(errorOutput, context?)
// Returns: { diagnosis: string, suggestedFix: string, raw: string }
```

### Implementation

- Uses `fetch()` against `https://api.deepseek.com/chat/completions`
- Model: `deepseek-chat`
- API key from `process.env.DEEPSEEK_API_KEY`
- System prompt instructs the model to respond in JSON: `{ "ok": bool, "issues": [...] }`
- Temperature: 0 (deterministic)
- Max tokens: 500
- Timeout: 30s via `AbortSignal.timeout(30000)`
- If API key is missing, returns `{ ok: true, issues: [], raw: "skipped (no API key)" }`

### Error handling

- Network/timeout errors: return `{ ok: true, issues: ["LLM check unavailable: <reason>"], raw: "" }`
- JSON parse failure in response: extract text, return `{ ok: false, issues: ["LLM returned non-JSON response"], raw: text }`

---

## Check 1: Blooket CSV Content Validation

**Where**: `lesson-prep.mjs` → `validateBlooketTask()` (after structural validation passes)
**When**: After step 2 codex generates the Blooket CSV
**What**: Send the first 10 rows of the CSV to DeepSeek with the prompt:

```
You are validating a Blooket quiz CSV for AP Statistics Topic {unit}.{lesson}.
Check for: (1) questions that don't match the topic, (2) incorrect correct answers,
(3) duplicate questions, (4) nonsensical answer choices.
Respond with JSON: { "ok": true/false, "issues": ["..."] }
```

**On failure**: Warn to console. Do not block pipeline.

## Check 2: Animation Script Validation

**Where**: `lesson-prep.mjs` → `validateTaskResult()` when `taskKey === "drills"`
**When**: After step 2 generates Manim .py files, before step 3 renders them
**What**: Read the generated `.py` file content and send to DeepSeek:

```
You are reviewing a Manim animation script for AP Statistics Topic {unit}.{lesson}.
Check for: (1) missing imports, (2) class doesn't extend Scene, (3) undefined variables,
(4) obvious runtime errors. Only flag clear bugs, not style issues.
Respond with JSON: { "ok": true/false, "issues": ["..."] }
```

**On failure**: Warn to console. If `--strict-llm`, abort before render step.

## Check 3: Schoology Post Verification

**Where**: `lesson-prep.mjs` → after step 6 returns successfully
**When**: After Schoology posting completes
**What**: This is a URL reachability check, not an LLM check. For each posted link, do a HEAD request to verify it returns 200. Log results.

Note: This is structural, not semantic, but grouped here because it fills the same "post-pipeline verification" gap.

## Check 4: Error Routing / Diagnosis

**Where**: `lesson-prep.mjs` → error handlers for steps 2, 3, 4
**When**: When a pipeline step fails
**What**: Pass the error output + context to `analyzeError()`:

```
A lesson-prep pipeline step failed. Analyze the error and suggest a fix.
Step: {stepName}
Error output: {truncatedOutput}
Context: Unit {unit}, Lesson {lesson}
```

**Output**: Print the diagnosis and suggested fix to console. Helps the user decide whether to retry or fix manually.

---

## CLI Flags (lesson-prep.mjs)

| Flag | Default | Effect |
|------|---------|--------|
| `--strict-llm` | false | Make LLM check failures fatal (abort pipeline) |
| `--skip-llm` | false | Skip all LLM checks even if API key is set |

---

## Files

| File | Type | Description |
|------|------|-------------|
| `scripts/lib/llm-check.mjs` | New | DeepSeek API wrapper |
| `.env.example` | New | Template with `DEEPSEEK_API_KEY=` |
| `scripts/lesson-prep.mjs` | Modified | Integration of checks 1-4, new CLI flags |
| `.gitignore` | Modified | Add `.env` if not already present |

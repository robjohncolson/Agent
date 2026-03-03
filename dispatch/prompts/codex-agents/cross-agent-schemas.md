# Codex Prompt: Agent B — Cross-Agent Schemas

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.
This repo uses JSON Schema (Draft 2020-12) to define all structured data shapes.

Existing schemas in `schema/` follow a consistent pattern:
- `$schema` pointing to `https://json-schema.org/draft/2020-12/schema`
- `$id` with a relative path
- `title` and `description`
- Strict `additionalProperties: false` on all objects
- Required fields explicitly listed
- Enums for constrained string values

Read `design/cross-agent-spec.md` for the data structures you must formalize as schemas.

## Task

Create three JSON Schema files that define the cross-agent protocol data shapes.

### 1. `schema/cross-agent-request.schema.json`

Defines the combined envelope + payload that the caller writes before invoking a subagent.

**Top-level object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `protocol` | string, const `"cross-agent/v1"` | yes | Protocol version identifier |
| `direction` | string, enum `["cc-to-codex", "codex-to-cc"]` | yes | Which agent calls which |
| `caller` | string, enum `["claude-code", "codex"]` | yes | The invoking agent |
| `call_id` | string, pattern `^[a-f0-9]{12}$` | yes | 12-char hex UUID prefix |
| `depth` | integer, minimum 0 | yes | Current recursion depth |
| `max_depth` | integer, minimum 1 | yes | Maximum allowed recursion depth |
| `timeout_seconds` | integer, minimum 1, maximum 600 | yes | Subprocess timeout |
| `working_dir` | string | yes | Absolute path to the repo root |
| `context` | object | yes | Caller context (see below) |
| `task` | object | yes | Task payload (see below) |

**`context` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_task` | string | yes | Short description of what the caller is doing |
| `why_delegating` | string | yes | Why this subtask suits the other agent |
| `files_relevant` | array of strings | yes | File paths relevant to the task |

**`task` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_type` | string, enum `["implement", "review", "investigate", "validate", "design-question"]` | yes | Category of work |
| `prompt` | string, minLength 1 | yes | Natural language task description |
| `constraints` | object | yes | Execution constraints (see below) |
| `expected_output` | string, enum `["code-changes", "analysis", "answer", "file-list"]` | yes | What kind of result is expected |

**`constraints` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `owned_paths` | array of strings | yes | Glob patterns for files subagent may modify (empty array = unrestricted) |
| `read_only` | boolean | yes | If true, subagent must not modify any files |
| `no_git_commits` | boolean | yes | If true, subagent must not run git commit |
| `max_files_changed` | integer, minimum 0 | yes | Upper bound on changed file count |

`additionalProperties: false` on all objects.

### 2. `schema/cross-agent-result.schema.json`

Defines the structured result the subagent writes after completing its work.

**Top-level object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `protocol` | string, const `"cross-agent/v1"` | yes | Protocol version |
| `call_id` | string, pattern `^[a-f0-9]{12}$` | yes | Matches the request call_id |
| `status` | string, enum `["completed", "failed", "refused", "timeout"]` | yes | Outcome |
| `result` | object | yes | Result payload (see below) |
| `execution` | object | yes | Execution metadata (see below) |

**`result` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `summary` | string | yes | One-paragraph natural language summary |
| `files_changed` | array of strings | yes | List of modified file paths |
| `answer` | string | yes | For question/investigation tasks, the answer text |
| `confidence` | number, minimum 0, maximum 1 | yes | Self-assessed confidence (0.0-1.0) |
| `follow_up_needed` | boolean | yes | Whether caller should take further action |
| `notes` | string | yes | Anything the caller should know |

**`execution` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration_seconds` | number, minimum 0 | yes | Wall-clock time of subagent execution |
| `tokens_used` | integer or null | yes | Token count if available, null otherwise |
| `errors` | array of strings | yes | Error messages encountered during execution |

`additionalProperties: false` on all objects.

### 3. `schema/cross-agent-log.schema.json`

Defines the append-only log that tracks all cross-agent invocations over time.

**Top-level object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | integer, const 1 | yes | Schema version |
| `calls` | array of call objects | yes | Ordered list of all invocations |
| `summary` | object | yes | Aggregate counters (see below) |

**Call object properties** (items in `calls` array):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `call_id` | string | yes | Matches request/result call_id |
| `direction` | string, enum `["cc-to-codex", "codex-to-cc"]` | yes | Direction of the call |
| `task_type` | string, enum `["implement", "review", "investigate", "validate", "design-question"]` | yes | Task category |
| `prompt_summary` | string, maxLength 200 | yes | First ~100 chars of the prompt, truncated |
| `status` | string, enum `["completed", "failed", "refused", "timeout"]` | yes | Outcome |
| `duration_seconds` | number, minimum 0 | yes | Wall-clock time |
| `timestamp` | string, format `date-time` | yes | ISO8601 UTC timestamp of call start |
| `files_changed` | array of strings | yes | Files modified by subagent |
| `depth` | integer, minimum 0 | yes | Recursion depth of this call |

**`summary` object properties:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `total_calls` | integer, minimum 0 | yes | Total invocations |
| `cc_to_codex` | integer, minimum 0 | yes | CC→Codex call count |
| `codex_to_cc` | integer, minimum 0 | yes | Codex→CC call count |
| `completed` | integer, minimum 0 | yes | Successful calls |
| `failed` | integer, minimum 0 | yes | Failed calls |
| `refused` | integer, minimum 0 | yes | Depth-refused calls |
| `avg_duration_seconds` | number, minimum 0 | yes | Running average duration |

`additionalProperties: false` on all objects.

## Files You Create

```
schema/cross-agent-request.schema.json   # NEW
schema/cross-agent-result.schema.json    # NEW
schema/cross-agent-log.schema.json       # NEW
```

## Files You May Read (for style reference)

- `schema/parallel-batch-state.schema.json`
- `schema/parallel-runner-manifest.schema.json`
- `schema/session-state.schema.json`
- `design/cross-agent-spec.md`

## Files You May NOT Modify

- Any existing file in `schema/`
- Anything outside `schema/`

## Validation

After creating the schemas:
1. `python -c "import json; json.load(open('schema/cross-agent-request.schema.json'))"` (valid JSON check)
2. `python -c "import json; json.load(open('schema/cross-agent-result.schema.json'))"` (valid JSON check)
3. `python -c "import json; json.load(open('schema/cross-agent-log.schema.json'))"` (valid JSON check)
4. Verify each schema has `$schema`, `$id`, `title`, `description`, `type: "object"`, `required`, and `additionalProperties: false` at the top level
5. Verify enum values match those listed in this prompt exactly

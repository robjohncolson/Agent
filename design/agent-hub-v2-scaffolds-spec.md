# Agent Hub v2 — Railway-Ready Scaffolds

## Status: SPEC READY (reviewed, updated with Codex audit findings)

## Context

Agent Hub v1 established cross-machine identity, registry, and Supabase checkpoints.
This spec defines three scaffolds that make the existing codebase Railway-deployable
without requiring Railway to exist yet. Each scaffold is independently useful today
and becomes a deployment-ready component when Railway migration happens.

Design constraint: **all code must work identically on a local machine and on Railway.**
Locality is never assumed. Connection details, file paths, and auth tokens flow through
configuration, not hardcoded values.

## Codex Audit Findings (incorporated)

1. **`scripts/lib/paths.mjs` already has a machine detection system** with hardcoded
   profiles for `ColsonR` (work) and `rober` (home). This is a pre-registry version
   of env-config. The right move: refactor `paths.mjs` to read from the v1 registry,
   NOT create a parallel `env-config.mjs`. This avoids breaking 10+ import sites.

2. **CDP `9222` is hardcoded in 8+ scripts**, not 4. Most go through `cdp-connect.mjs`
   (5 scripts), but `index-drive-videos.mjs`, `probe-aistudio.mjs`, and `preflight.mjs`
   bypass the helper. Probe/diagnostic scripts are local-only and don't need abstraction.

3. **Scaffold 3 was over-scoped.** 14 task JSON files is premature. Slim to 3 representative
   task definitions (one per worker type) + the pipeline definition + the runner.

---

## Scaffold 1: Registry-Aware Paths + CDP Endpoint Config

### Problem

`scripts/lib/paths.mjs` has hardcoded machine profiles that duplicate what the v1
registry already stores. `cdp-connect.mjs` hardcodes `localhost:9222`. When Railway
time comes, both need to be configurable without code changes.

### Solution: Refactor paths.mjs + CDP endpoint env var

#### paths.mjs changes

The existing `MACHINES` object becomes a fallback. On startup, `paths.mjs` tries to
read from the registry first:

```js
// 1. Try registry (v1 infrastructure)
let machine;
try {
  const machineId = readMachineId();  // .machine-id or AGENT_MACHINE env var
  const pathsFile = `registry/machine-paths/${machineId}.json`;
  const machinePaths = JSON.parse(fs.readFileSync(pathsFile));
  const machinesFile = JSON.parse(fs.readFileSync('registry/machines.json'));
  machine = {
    worksheetRepo:  machinePaths.repos['apstats-live-worksheet'],
    drillerRepo:    machinePaths.repos['lrsl-driller'],
    curriculumRepo: machinePaths.repos['curriculum-render'],
    python:         machinesFile[machineId]?.python ?? null,
    ffmpegDir:      null,  // resolved dynamically
    miktexDir:      null,  // resolved dynamically
    edgeProfile:    join(machinePaths.base_path, '.edge-debug-profile'),
  };
} catch {
  // 2. Fall back to hardcoded profiles (backwards compat)
  const username = os.userInfo().username;
  machine = MACHINES[username];
}
```

All existing exports (`WORKSHEET_REPO`, `DRILLER_REPO`, `SCRIPTS`, etc.) remain
unchanged. Import sites don't break.

#### cdp-connect.mjs changes

Read `CDP_ENDPOINT` from env, default to `http://127.0.0.1:9222`:

```js
const CDP_ENDPOINT = process.env.CDP_ENDPOINT || `http://127.0.0.1:${CDP_PORT}`;
```

When `CDP_ENDPOINT` is set to a remote URL (e.g., Browserbase), skip the local port
check and Edge auto-launch — go straight to `chromium.connectOverCDP(CDP_ENDPOINT)`.

#### Scripts that bypass cdp-connect.mjs

| Script | Action |
|--------|--------|
| `index-drive-videos.mjs` | **Edit** — read `CDP_ENDPOINT` from env, default to hardcoded |
| `probe-aistudio.mjs` | **No change** — local diagnostic, hardcoded is fine |
| `probe-schoology-folder.mjs` | **No change** — local diagnostic |
| `preflight.mjs` | **No change** — local health check |

### Env vars

| Env var | Default | Notes |
|---------|---------|-------|
| `CDP_ENDPOINT` | `http://127.0.0.1:9222` | Override for hosted browser |
| `AGENT_MACHINE` | (reads .machine-id) | Override for containers |

### Files

| File | Action |
|------|--------|
| `scripts/lib/paths.mjs` | **Edit** — read from registry with hardcoded fallback |
| `scripts/lib/cdp-connect.mjs` | **Edit** — support CDP_ENDPOINT env var |
| `scripts/index-drive-videos.mjs` | **Edit** — read CDP_ENDPOINT from env |

---

## Scaffold 2: Structured Event Log

### Problem

The only data in Supabase is checkpoints — coarse snapshots at natural breakpoints.
There's no visibility into what happened between checkpoints. When a pipeline runs,
the only record is console output that vanishes when the session ends.

A dashboard (v4), realtime monitoring (v5), and automation analysis (v6) all need
the same thing: a structured log of what the system did, when, and what happened.

### Solution: `agent_events` Supabase table + emitter

#### Table schema

```sql
CREATE TABLE IF NOT EXISTS agent_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  machine     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  category    TEXT NOT NULL,
  target_repo TEXT,
  task_id     TEXT,
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_created ON agent_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_repo ON agent_events(target_repo);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON agent_events
  FOR ALL USING (true) WITH CHECK (true);
```

#### Event types

| event_type | category | data payload |
|------------|----------|-------------|
| `pipeline.started` | pipeline | `{ pipeline, unit, lesson, steps }` |
| `pipeline.step.started` | pipeline | `{ pipeline, step, stepKey }` |
| `pipeline.step.completed` | pipeline | `{ pipeline, step, stepKey, duration_ms }` |
| `pipeline.step.failed` | pipeline | `{ pipeline, step, stepKey, error }` |
| `pipeline.completed` | pipeline | `{ pipeline, unit, lesson, duration_ms, results }` |
| `cdp.connected` | browser | `{ browser, endpoint, page_url }` |
| `cdp.error` | browser | `{ action, error }` |
| `codex.dispatched` | agent | `{ task_type, prompt_hash, working_dir }` |
| `codex.completed` | agent | `{ task_type, duration_ms, files_changed }` |
| `codex.failed` | agent | `{ task_type, error }` |
| `git.committed` | git | `{ repo, hash, message, files }` |
| `git.pushed` | git | `{ repo, branch, remote }` |
| `supabase.uploaded` | storage | `{ bucket, path, size_bytes }` |
| `checkpoint.written` | system | `{ trigger, machine, commit }` |

#### Emitter: `scripts/lib/event-log.mjs`

Reads machine ID from `.machine-id` file (or `AGENT_MACHINE` env var).
Uses Supabase REST API directly (same pattern as `supabase-client.mjs`).
All functions are fire-and-forget — never block, never throw.

```js
// Fire and forget — never blocks, never throws
export async function emit(eventType, category, data = {}) { ... }

// Convenience wrappers
export const pipeline = {
  started:       (name, meta) => emit('pipeline.started', 'pipeline', { pipeline: name, ...meta }),
  stepStarted:   (name, step) => emit('pipeline.step.started', 'pipeline', { pipeline: name, step }),
  stepCompleted: (name, step, ms) => emit('pipeline.step.completed', 'pipeline', { pipeline: name, step, duration_ms: ms }),
  stepFailed:    (name, step, err) => emit('pipeline.step.failed', 'pipeline', { pipeline: name, step, error: String(err) }),
  completed:     (name, meta) => emit('pipeline.completed', 'pipeline', { pipeline: name, ...meta }),
};
```

### Files

| File | Action |
|------|--------|
| `scripts/lib/event-log.mjs` | **New** — event emitter |
| `scripts/create-events-table.mjs` | **New** — migration helper (same pattern as checkpoints) |
| `scripts/lesson-prep.mjs` | **Edit** — add emit() calls around existing steps |
| `scripts/agent-checkpoint.mjs` | **Edit** — emit checkpoint.written event |

---

## Scaffold 3: Task Abstraction for Dispatch (Slim)

### Problem

Lesson-prep is a monolithic 500+ line script with inline step logic. To eventually
dispatch steps to different workers (local vs Railway vs hosted browser), the steps
need a declarative format.

### Solution: 3 representative task definitions + pipeline definition + runner

Scope is intentionally slim — prove the format with one task per worker type,
then expand once the format proves out.

#### Task definition format

```json
{
  "id": "ingest",
  "name": "Video ingest via AI Studio",
  "type": "cdp-browser",
  "worker": "scripts/aistudio-ingest.mjs",
  "inputs": {
    "drive_ids": "{{drive_ids}}",
    "unit": "{{unit}}",
    "lesson": "{{lesson}}"
  },
  "outputs": {
    "files": "{{video_context_dir}}/apstat_{{unit}}-{{lesson}}-*"
  },
  "preconditions": {
    "requires_cdp": true,
    "registry_status": { "key": "ingest", "not": "done" }
  },
  "on_failure": {
    "strategy": "retry",
    "delay_minutes": 120,
    "max_retries": 5
  },
  "timeout_minutes": 30
}
```

#### Worker types

| Type | Where it runs | Example task |
|------|---------------|-------------|
| `cdp-browser` | Machine with CDP endpoint | `ingest` |
| `codex-agent` | Any machine with Codex CLI | `content-gen-worksheet` |
| `node-script` | Any machine with Node | `render-animations` |

#### 3 task definitions (one per worker type)

1. `tasks/ingest.json` — type: `cdp-browser`
2. `tasks/content-gen-worksheet.json` — type: `codex-agent`
3. `tasks/render-animations.json` — type: `node-script`

#### Pipeline definition

`pipelines/lesson-prep.json` — the full 12-step dependency graph using all task
types. References task IDs by name. Steps not yet defined as task JSONs get
`"defined": false` so the runner knows to skip them.

```json
{
  "id": "lesson-prep",
  "name": "Full Lesson Prep Pipeline",
  "params": ["unit", "lesson", "drive_ids"],
  "steps": [
    { "task": "ingest", "depends_on": [], "defined": true },
    { "task": "content-gen-worksheet", "depends_on": ["ingest"], "defined": true },
    { "task": "content-gen-blooket", "depends_on": ["ingest"], "defined": false },
    { "task": "content-gen-drills", "depends_on": ["ingest"], "defined": false },
    { "task": "render-animations", "depends_on": ["content-gen-drills"], "defined": true },
    { "task": "upload-animations", "depends_on": ["render-animations"], "defined": false },
    { "task": "upload-blooket", "depends_on": ["content-gen-blooket"], "defined": false },
    { "task": "schoology-post", "depends_on": ["upload-blooket", "content-gen-worksheet"], "defined": false },
    { "task": "verify-schoology", "depends_on": ["schoology-post"], "defined": false },
    { "task": "generate-urls", "depends_on": ["schoology-post", "upload-animations"], "defined": false },
    { "task": "export-registry", "depends_on": ["generate-urls"], "defined": false },
    { "task": "commit-push", "depends_on": ["export-registry"], "defined": false }
  ]
}
```

#### Task runner: `scripts/lib/task-runner.mjs`

Reads a pipeline definition, loads task JSONs, resolves dependencies, executes in
topological order (parallel where edges allow). For each task:

1. Check preconditions (registry status, CDP availability)
2. Resolve inputs (template variables from pipeline params)
3. Emit `pipeline.step.started` event (if event-log available)
4. Execute the worker (spawn the script as a child process with args)
5. Check exit code + validate outputs
6. Emit `pipeline.step.completed` or `pipeline.step.failed`

The runner skips steps with `"defined": false` — those still run through
lesson-prep.mjs's existing inline logic until task JSONs are added.

### Files

| File | Action |
|------|--------|
| `schema/task.schema.json` | **New** — task definition schema |
| `schema/pipeline.schema.json` | **New** — pipeline definition schema |
| `tasks/ingest.json` | **New** — cdp-browser task |
| `tasks/content-gen-worksheet.json` | **New** — codex-agent task |
| `tasks/render-animations.json` | **New** — node-script task |
| `pipelines/lesson-prep.json` | **New** — pipeline definition |
| `scripts/lib/task-runner.mjs` | **New** — task execution engine |

---

## Implementation Dependency Graph

```
Wave 1 (parallel — no dependencies):
  A: paths.mjs registry refactor
  B: event-log.mjs + create-events-table.mjs
  C: task.schema.json + pipeline.schema.json
  D: cdp-connect.mjs CDP_ENDPOINT support

Wave 2 (depends on Wave 1):
  E: Wire event-log into lesson-prep.mjs (depends on B)
  F: 3 task definitions + pipelines/lesson-prep.json (depends on C)
  G: task-runner.mjs (depends on B for event emission, C for schemas)
```

## Railway Migration Surface (Future)

Once all three scaffolds are in place, Railway deployment requires:

1. Dockerfile: Node 22 + git + playwright + Codex CLI
2. `AGENT_MACHINE=railway` env var (or `.machine-id`)
3. `registry/machines.json` — add railway entry
4. `registry/machine-paths/railway.json` — paths inside the container
5. `CDP_ENDPOINT` env var — pointed at hosted browser service
6. Supabase credentials — same as local
7. `ANTHROPIC_API_KEY` — for Claude Code
8. `OPENAI_API_KEY` — for Codex

No script changes needed.

## Non-Goals

- Actually deploying to Railway (this spec only builds the scaffolds)
- Hosted browser provider selection (deferred to Railway migration)
- Dashboard UI (v4 — consumes the event log this spec creates)
- Realtime subscriptions (v5 — layered on top of event log)
- Workflow automation (v6 — analyzes event log patterns)
- Task definitions for all 12 pipeline steps (only 3 for now — expand later)

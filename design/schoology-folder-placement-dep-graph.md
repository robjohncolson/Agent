# Schoology Folder Placement — Dependency Graph

## Wave 1 (independent, parallel)

### Agent A: topic-schedule.json + build-topic-schedule.mjs
- Creates `config/topic-schedule.json` (static topic-to-date mapping)
- Creates `scripts/build-topic-schedule.mjs` (builds schedule from registry + calendars)
- No dependencies on other agents

### Agent B: resolve-folder-path.mjs
- Creates `scripts/lib/resolve-folder-path.mjs`
- Exports `resolveFolderPath(unit, lesson, options)` and `determineSchoolWeek(dateStr)`
- Extracts `determineSchoolWeek()` from `lesson-prep.mjs` into shared module
- Adds future-lesson routing (work-ahead/future with title case Week)
- Adds throw-on-no-date safety
- No dependencies on other agents

## Wave 2 (depends on Wave 1)

### Agent C: lesson-prep.mjs integration
- Depends on: Agent B (resolve-folder-path.mjs must exist)
- Modifies `scripts/lesson-prep.mjs`:
  - Import `resolveFolderPath` from `./lib/resolve-folder-path.mjs`
  - Replace inline `determineSchoolWeek()` with import from resolve-folder-path
  - In legacy Schoology posting (lines ~1359-1391): use `resolveFolderPath()` when no calendar context
  - In task runner context seeding (lines ~1779-1802): use `resolveFolderPath()` when no calendar context

### Agent D: post-to-schoology.mjs guard + --courses
- Depends on: Agent A (for understanding the guard requirement)
- Modifies `scripts/post-to-schoology.mjs`:
  - Add root-posting guard: if no folder flags and not --heal, refuse and exit
  - Add `--courses` flag: comma-separated course IDs, loop posting for each
  - Keep backward compat: `--course` single ID still works

## Wave 3 (depends on Wave 2)

### Agent E: task definition update
- Depends on: Agent D (--courses flag must exist)
- Modifies `tasks/schoology-post.json`:
  - Add `courses` input template variable
- Small change, can be done directly by CC

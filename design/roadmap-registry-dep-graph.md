# Roadmap-Registry Integration — Dependency Graph

## Agents

| ID | Name | Files Owned | Complexity | Executor |
|----|------|-------------|-----------|----------|
| A | build-script | `scripts/build-roadmap-data.mjs` | M | Codex |
| B | html-enhancements | `C:/Users/ColsonR/apstats-live-worksheet/ap_stats_roadmap.html` | L | CC-direct |
| C | pipeline-step | `pipelines/lesson-prep.json` | S | CC-direct |

## Waves

```
Wave 1 (parallel): Agent A, Agent B
  A: Create build-roadmap-data.mjs — reads registry + schedule, outputs roadmap-data.json,
     injects BAKED_REGISTRY into HTML
  B: Modify ap_stats_roadmap.html — CSS for status dots + link icons, loadRegistry() fetch/fallback,
     enhanced cellContent() with link icons, enhanced showTooltip() with links + status badge,
     status dot class in cell creation loop

Wave 2 (after wave 1): Agent C
  C: Add optional "build-roadmap" step to pipelines/lesson-prep.json
     (depends on A for script name)

Wave 3 (integration): Run build, verify output, commit
```

## Contracts

### A → B contract
- B adds `const BAKED_REGISTRY = {};` placeholder on its own line before SCHEDULE
- A's inject function finds `/const BAKED_REGISTRY\s*=\s*\{[^}]*\};/` and replaces it
- B adds `loadRegistry()` that reads from global `REGISTRY` variable
- A's JSON output matches the schema in the spec (`lessons.{key}.urls`, `.status`, `.periods`)

### B → runtime contract
- `REGISTRY.lessons[topicKey]` returns `{ urls, status, periods }` or undefined
- `cellContent(info, ds)` uses `REGISTRY` to add link icons
- `showTooltip()` uses `REGISTRY` to add link list + status badge
- Period toggle (`currentPeriod`) determines which Schoology folder link to show

### A → C contract
- Pipeline step name: `build-roadmap`
- Depends on: `export-registry` (runs after registry is finalized)
- Non-blocking: `"optional": true`

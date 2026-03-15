# Dependency Graph: Supabase Roadmap Merge

Spec: `design/supabase-roadmap-merge-spec.md`

## Task Breakdown

| ID | Task | File(s) | Size | Method |
|---|---|---|---|---|
| A | Supabase overlay + period deep-linking in roadmap HTML | `ap_stats_roadmap_square_mode.html` | M | CC-direct |
| B | Update URL constants in calendar link script | `scripts/update-calendar-links.mjs` | S | CC-direct |
| C | Convert `calendar.html` to compatibility redirect | `calendar.html` | S | CC-direct |
| D | Run link updater to swap Schoology links | (runtime — Edge CDP) | S | Manual |

## Why CC-direct for everything

- **Agent A**: All 4-5 touch points are in one 6241-line file. Codex would need the full file in context to find `loadRegistry()`, `setP()`, `sTip()`, and `showResourcePanel()`. Multi-touch-point coordination within a single file is CC-direct territory.
- **Agents B, C**: Under 10 lines each. Dispatch overhead exceeds implementation cost.
- **Agent D**: Requires live Edge CDP session. Not automatable via Codex.

## Execution Order

```
Wave 1 (parallel):
  Agent A — roadmap HTML: Supabase fetch, merge, period URL param, tooltip/panel updates
  Agent B — update-calendar-links.mjs: change URL constants to roadmap path

Wave 2 (after A verified in browser):
  Agent C — calendar.html: convert to redirect pointing to roadmap
  Agent D — run update-calendar-links.mjs via Edge CDP to swap Schoology links

Wave 3 (commit):
  Stage + commit + push both repos
```

## Verification gates

- After Wave 1: open `ap_stats_roadmap_square_mode.html?period=B` locally, confirm:
  - Period B is selected on load
  - Console shows Supabase fetch completing
  - Tooltip shows "Schoology: Posted" for a known-posted topic
  - Folder link resolves from live Supabase data
  - Switching to E re-fetches and shows correct folder links
  - Page still works fully if Supabase fetch is blocked

- After Wave 2: confirm `calendar.html` redirects to roadmap with correct period param

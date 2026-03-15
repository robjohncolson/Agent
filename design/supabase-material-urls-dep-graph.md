# Dependency Graph: Supabase Material URLs

Spec: `design/supabase-material-urls-spec.md`

## Task Breakdown

| ID | Task | File(s) | Size | Method |
|---|---|---|---|---|
| A | Create `lesson_urls` table + RLS | Supabase SQL | S | CC-direct |
| B | Add `upsertLessonUrls()` | `scripts/lib/supabase-schedule.mjs` | S | CC-direct |
| C | Extend `syncFolderToSupabase()` with sparse materialUrls | `scripts/post-to-schoology.mjs` | S | CC-direct |
| D | Add `lesson_urls` backfill to migration script | `scripts/sync-schedule-to-supabase.mjs` | M | CC-direct |
| E | Roadmap: two-fetch overlay, lesson shells, per-field merge, phase 3 status | `ap_stats_roadmap_square_mode.html` | M | CC-direct |
| F | Run backfill migration | runtime | S | CC-direct |

## Execution Order

```
Wave 1: A (SQL) + B (upsertLessonUrls)
Wave 2 (parallel): C (poster) + D (backfill script) + E (roadmap HTML)
Wave 3: F (run backfill)
Wave 4: Commit + push + verify
```

All CC-direct — no Codex dispatch. Coordination across touch points and large file context make this CC territory.

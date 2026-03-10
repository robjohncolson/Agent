# Agent Hub v4 - Dashboard Dependency Graph

This graph expands the v4 dashboard spec into executable implementation steps, with explicit dependencies and the points where work can be split across parallel tracks.

## Steps

1. Verify external prerequisites: confirm read-only RLS access on `agent_events` and `agent_checkpoints`, lock the `SUPABASE_URL` / `SUPABASE_ANON_KEY` injection approach, and decide how `registry/repos.json` will be bundled or fetched. `[depends on: none]`
2. Implement `dashboard/lib/supabase-client.js` so the static app can initialize the Supabase client from the chosen config contract. `[depends on: 1]`
3. Implement `dashboard/lib/formatters.js` for shared date, duration, staleness, and status-badge formatting helpers. `[depends on: none]`
4. Build `dashboard/index.html` as the SPA shell: tab navigation, filter slots, view mount points, loading/error regions, and script/style wiring. `[depends on: 1]`
5. Build `dashboard/style.css` for the shared dark theme, responsive layout, badge colors, table/feed primitives, and basic load animations. `[depends on: 4]`
6. Implement the `dashboard/app.js` orchestration skeleton: active-tab state, shared filter state, refresh timer lifecycle, fetch coordination, and component interface contracts. `[depends on: 2, 3, 4]`
7. Implement `dashboard/components/event-timeline.js` for the reverse-chronological feed, payload expansion, event/machine/date filters, and timeline polling hooks. `[depends on: 2, 3, 5, 6]`
8. Implement `dashboard/components/pipeline-view.js` for grouping by `pipeline_run_id`, deriving current step/status, expandable run details, and pipeline/date filtering. `[depends on: 2, 3, 5, 6]`
9. Implement `dashboard/components/checkpoint-view.js` for ordered checkpoint history, staleness indicators, horizontal timeline rendering, and gap detection over two hours. `[depends on: 2, 3, 5, 6]`
10. Implement `dashboard/components/repo-health.js` to load `registry/repos.json`, join it with checkpoint freshness data, and render repo status by machine/commit. `[depends on: 1, 2, 3, 5, 6]`
11. Complete the final `dashboard/app.js` integration pass: wire all views into tab switching, connect shared loading/error handling, and enable auto-refresh only where the spec requires it. `[depends on: 7, 8, 9, 10]`
12. Create `dashboard/Dockerfile` to serve the finished static assets with a lightweight HTTP server and satisfy Railway's `GET /` health check. `[depends on: 11]`
13. Write `dashboard/README.md` covering local setup, required env vars, Supabase read-only expectations, repo-health data sourcing, and Railway deployment steps. `[depends on: 1, 11, 12]`
14. Run the implementation verification pass: smoke-test tab navigation, Supabase reads, repo-health cross-referencing, responsive behavior, and containerized `/` health-check behavior. `[depends on: 11, 12, 13]`

## Parallel Waves

- Wave 1: Steps 1 and 3 can run concurrently. Prerequisite validation is independent from formatter utility work.
- Wave 2: Steps 2 and 4 can run concurrently after Step 1. Supabase initialization and SPA shell markup only share the config contract, not implementation details.
- Wave 3: Steps 5 and 6 can run concurrently after their dependencies clear. CSS can proceed from the shell structure while `app.js` establishes data/state contracts.
- Wave 4: Steps 7, 8, 9, and 10 can run concurrently after Steps 2, 3, 5, and 6. The four view components share the same app/lib contracts but do not block one another.
- Wave 5: Step 11 depends on all view components and is the main convergence point.
- Wave 6: Step 12 follows Step 11 once the final static asset set is stable.
- Wave 7: Step 13 follows once deployment details are fixed by Steps 11 and 12.
- Wave 8: Step 14 is the final verification wave after implementation and deployment artifacts are complete.

## Critical Path

1 -> 4 -> 5 -> 6 -> (7, 8, 9, 10) -> 11 -> 12 -> 13 -> 14

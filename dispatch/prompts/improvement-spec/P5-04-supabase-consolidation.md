# Agent: Supabase Consolidation

## Phase
P5-infrastructure | Depends on: wire-grading-proxy-cr, wire-grading-proxy-driller | Working dir: `C:/Users/ColsonR/shared-grading-proxy`

## Objective
Namespace Supabase tables for both education apps into a shared instance with unified auth.

## Dependencies
Both apps must be wired to the shared grading proxy first, so the data flow is:
```
Both apps → shared-grading-proxy → Supabase (shared instance)
```

## Context: Current State

```
curriculum_render uses Supabase for:
  - answers (student responses)
  - peer_data (consensus aggregation)
  - users (identity)

lrsl-driller uses Supabase for:
  - progress (cartridge completion)
  - leaderboard (scores)
  - users (identity)
  - time_tracking
  - avatar_system
  - grid_wars_* (multiplayer)
```

## Proposed Schema

Namespace with prefixes:
```sql
-- Curriculum Render tables
cr_answers (question_id, student_id, value, timestamp)
cr_peer_data (question_id, aggregated_data, updated_at)

-- LRSL-Driller tables
drill_progress (student_id, cartridge_id, mode_id, stars, completed_at)
drill_leaderboard (student_id, cartridge_id, total_points, rank)
drill_time_tracking (student_id, session_start, session_end, duration)
drill_avatar_system (student_id, avatar_config)
drill_grid_wars_* (existing schema, prefixed)

-- Shared tables
shared_users (student_id, username, created_at, last_seen)
shared_grading_log (question_id, student_id, score, provider, timestamp)
```

## Read First
1. `curriculum_render/supabase_config.js` — current Supabase URL and key
2. `lrsl-driller/railway-server/schema-*.sql` — all migration files
3. `lrsl-driller/railway-server/.env.example` — current env vars

## Owned Paths
- `migrations/` (new directory in shared-grading-proxy)

## Implementation
1. Create migration scripts for table renaming
2. Update both apps' Supabase config to point to shared instance
3. Create shared_users table with unified identity
4. Add RLS policies for row-level security

## Constraints
- NO data loss during migration
- Both apps must continue working during transition
- RLS policies must prevent cross-app data leaks
- Existing API keys should work (anon key for reads, service role for writes)

## Verification
```bash
# Run migrations against test database first
supabase db push --linked --dry-run
# Verify both apps can read/write
curl https://shared-instance.supabase.co/rest/v1/shared_users -H "apikey: $ANON_KEY"
```

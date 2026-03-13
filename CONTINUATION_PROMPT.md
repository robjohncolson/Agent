# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Priority: Continue Unit 7 ingest pipeline (7.5 next)**

7.4 is DONE (worksheet, blooket, drills, Schoology B posted). Two loose ends on 7.4:
- `urls.drills` is null in registry — should be `https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u7-mean-ci&level=l16-state-null-hypothesis`
- Period E not posted yet — needs `post-to-schoology.mjs --period E`
- Animations failed (ffmpeg not on PATH — use `render_batch.py` in lrsl-driller)

### Next ingest: 7.5

```bash
node scripts/lesson-prep.mjs --unit 7 --lesson 5 \
  --drive-ids 1h5r9eDoSwjLJye7PeHcz68AI5p-RDFeR 14CEJsy6KqSjm-kPilGkdhzSidogpeRf6 13htsG5jUJZbwNCi9gAr1DEglECxHE-j5
```

Requires Edge with CDP on port 9222 and AI Studio tab open.

### Drive IDs for remaining Unit 7

| Topic | Videos | Drive IDs |
|-------|--------|-----------|
| 7.5 | 3 | `1h5r9eDoSwjLJye7PeHcz68AI5p-RDFeR 14CEJsy6KqSjm-kPilGkdhzSidogpeRf6 13htsG5jUJZbwNCi9gAr1DEglECxHE-j5` |
| 7.6 | 2 | `1fIwr8VpJ1OfuMxmweLAYOL88CLUVpzvF 1dju4ZGQzNLFdFbR5oCoz4e9bzQHapIVk` |
| 7.7 | 4 | `1PVuJqbE0x35eSj5ee4c0Ewn7Ep11ijJH 1bkfmDJMIaDxbg2XTAnRfdpamFMSCFfM- 1ckZVyG_NDocb3UV6A8AZv_yyrbD8QCa0 1njeWzbSUOPWw0fZHWoYBU7uca9RbduBU` |
| 7.8 | 4 | `1_R1wLiRWvyKm3BbKkvw6HtWIkn_gMrTM 1uLGTaehZ2mRh5el69Zu88SnsWfwiKwRR 1CWa1-295Bzw3xc-kKfx6xS-HT53wNJbb 1PAx6MB_d4DDsF5KHYAbxjOf7VUP0_-E5` |
| 7.9 | 6 | `1bofS5d0YSaMbYLDpBah01olGNwx_Ht4r 1329C4d76DZoxl1yQQql_T9SAeoHedObV 13QWXXAt2HXALrQouG0_3za9KwwESGq5m 1bJ-id40s9xbnD2UZp9bzfBAKxUwtOT2q 1Eb9EV7YCqrVyjGqhOw-jTbfuvmk1vHJJ 1BWoDK2CpQFkIjMsZtzrHb3VjiaJCQlw-` |

### Known issues

- **ffmpeg**: Not on system PATH. Manim animations must use `render_batch.py` which sets `config.ffmpeg_executable` directly. Path: `C:/Users/ColsonR/ffmpeg/bin/`
- **Registry clobber bug**: The ingest step can overwrite the entire registry if it creates a new entry. Always verify registry size after pipeline runs. Restore from git if needed: `git show HEAD:state/lesson-registry.json`
- **Schoology verify**: Title patterns don't match what the poster uses — verify failures are often false negatives. Check manually.
- **resolve-blooket-urls.mjs**: New script for batch-resolving Blooket URLs from Schoology CDP scrape. Handles Schoology redirect wrappers.

## Session Commits (2026-03-12/13)

```
fb6e472 fix: backfill 6.1 + 6.2 Blooket URLs — 14/14 calendar lessons ready
6e90b91 fix: backfill missing Blooket/drills/quiz URLs for calendar lessons
```

Downstream (auto-pushed by pipeline):
- `apstats-live-worksheet` `71718dc` — 7.4 worksheet + blooket + roadmap rebuild
- `lrsl-driller` `dae591d` — 7.4 drills (5 levels l16-l20) + animations (unrendered)

## Current State

- **Calendar**: 14/14 lessons ready (was 8/14 at session start)
- **Queue**: 300 total, ~112 completed, ~188 pending, 17 unblocked ingests (7.5-9.5)
- **Registry**: 45 lessons (7.4 added this session)
- **Roadmap**: Rebuilt and baked into square mode HTML

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Registry: `state/lesson-registry.json`
- Work queue: `state/work-queue.json`
- Drive index: `config/drive-video-index.json`
- Blooket uploads: `state/blooket-uploads.json`
- URL resolver: `scripts/resolve-blooket-urls.mjs`
- Roadmap builder: `scripts/build-roadmap-data.mjs`
- U7 cartridge: `lrsl-driller/cartridges/apstats-u7-mean-ci/`
- U7 transcripts: `apstats-live-worksheet/u7/`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.106.0 (`codex exec --full-auto`)
- Edge CDP on port 9222
- Schoology B: `7945275782`, E: `7945275798`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`

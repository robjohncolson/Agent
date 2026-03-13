# Agent Repo — Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

**Priority A: Fix the pipeline to include video links + Blooket in Schoology posts**

The pipeline (`scripts/lesson-prep.mjs`) posts worksheet, drills, and quiz to Schoology but **never posts video links**. The `--with-videos` flag exists in `post-to-schoology.mjs` but the pipeline never passes it. Additionally, Blooket URLs are not rendered in the calendar HTML even though they exist in `roadmap-data.json`.

### Tasks (in order)

1. **Wire `--with-videos` into the pipeline's schoology-post step** — `scripts/lesson-prep.mjs` builds the `post-to-schoology` command; add `--with-videos` to the args.
2. **Populate `registry.urls.videos` during ingest** — Read AP Classroom URLs from `C:/Users/ColsonR/curriculum_render/data/units.js` (function `loadVideoLinks` already exists in `post-to-schoology.mjs:265-306`) and store them in the registry during the ingest or content-gen step.
3. **Include videos in `build-roadmap-data.mjs`** — Currently this script explicitly filters out videos. Remove that filter so roadmap-data.json includes video URLs.
4. **Render Blooket + video links in calendar HTML** — Calendar HTMLs in `apstats-live-worksheet/week_*_calendar.html` don't render clickable material links. Add hyperlinks for all materials (worksheet, drills, quiz, blooket, videos).
5. **Backfill video links to Schoology for all existing lessons (units 1–7)** — 46 lessons have Schoology folders but only 2 have video URLs in the registry. Use `post-to-schoology.mjs --with-videos --only video` to post video links into each lesson's existing folder.
6. **Backfill Period E Schoology posts** — Only 13/46 lessons have Period E folders. The remaining 33 need to be posted.

### Reference data

- Video link source: `C:/Users/ColsonR/curriculum_render/data/units.js`
- Poster: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos`
- Poster (E): add `--course 7945275798`
- `--only video` uses prefix match (posts video1, video2, video3)
- Registry: `state/lesson-registry.json` (46 lessons, only 2 have `urls.videos`)

**Priority B: Continue ingesting Unit 7 (7.6–7.9)**

After the pipeline fix above, continue ingesting lessons. 7.5 is fully done.

### Next ingest: 7.6

```bash
node scripts/lesson-prep.mjs --unit 7 --lesson 6 \
  --drive-ids 1fIwr8VpJ1OfuMxmweLAYOL88CLUVpzvF 1dju4ZGQzNLFdFbR5oCoz4e9bzQHapIVk
```

Requires Edge with CDP on port 9222 and AI Studio tab open.

### Drive IDs for remaining Unit 7

| Topic | Videos | Drive IDs |
|-------|--------|-----------|
| 7.6 | 2 | `1fIwr8VpJ1OfuMxmweLAYOL88CLUVpzvF 1dju4ZGQzNLFdFbR5oCoz4e9bzQHapIVk` |
| 7.7 | 4 | `1PVuJqbE0x35eSj5ee4c0Ewn7Ep11ijJH 1bkfmDJMIaDxbg2XTAnRfdpamFMSCFfM- 1ckZVyG_NDocb3UV6A8AZv_yyrbD8QCa0 1njeWzbSUOPWw0fZHWoYBU7uca9RbduBU` |
| 7.8 | 4 | `1_R1wLiRWvyKm3BbKkvw6HtWIkn_gMrTM 1uLGTaehZ2mRh5el69Zu88SnsWfwiKwRR 1CWa1-295Bzw3xc-kKfx6xS-HT53wNJbb 1PAx6MB_d4DDsF5KHYAbxjOf7VUP0_-E5` |
| 7.9 | 6 | `1bofS5d0YSaMbYLDpBah01olGNwx_Ht4r 1329C4d76DZoxl1yQQql_T9SAeoHedObV 13QWXXAt2HXALrQouG0_3za9KwwESGq5m 1bJ-id40s9xbnD2UZp9bzfBAKxUwtOT2q 1Eb9EV7YCqrVyjGqhOw-jTbfuvmk1vHJJ 1BWoDK2CpQFkIjMsZtzrHb3VjiaJCQlw-` |

### Post-pipeline checklist (per lesson)

1. Run pipeline: `node scripts/lesson-prep.mjs --unit U --lesson L --drive-ids ...`
2. If worksheet/drills timeout, re-run individually
3. Render animations: `cd lrsl-driller && python render_batch.py --lesson NN`
4. Upload animations: `node scripts/batch-upload-animations.mjs`
5. Post Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos`
6. Post Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798`
7. Rebuild roadmap: `node scripts/build-roadmap-data.mjs`
8. Commit + push apstats-live-worksheet and lrsl-driller

### Known issues

- **Blooket auto-upload**: ETIMEDOUT — upload CSVs manually at dashboard.blooket.com
- **ffmpeg**: Not on system PATH. Use `render_batch.py` which sets `config.ffmpeg_executable`. Path: `C:/Users/ColsonR/ffmpeg/bin/`
- **Registry clobber bug**: Ingest step can overwrite registry. Verify size after pipeline runs. Restore: `git show HEAD:state/lesson-registry.json`
- **Schoology verify**: Title patterns don't match poster output — verify failures are often false negatives
- **Codex worksheet timeout**: Re-run: `node scripts/workers/codex-content-gen.mjs --task worksheet --unit U --lesson L`
- **Period B orphans**: First 7.5 post left 2 orphan links (drills + quiz) at Period B top level. Delete manually.
- **Queue stale**: 7.5 queue items show "pending" but work is done. Run `node scripts/reconcile-work-queue.mjs --execute` to sync.

## Session Commits (2026-03-13)

Agent:
```
de8dc2c fix: 7.4 loose ends — drills URL, animation pipeline path fix
```
Uncommitted: `post-to-schoology.mjs` — prefix match for `--only video`, deprecated calendar-link args removed

lrsl-driller:
```
e86cdfc feat: Topic 7.5 drills — 5 levels + Manim animations for mean t-test
125666d fix: render_batch.py auto-discovers lessons from animation filenames
```

apstats-live-worksheet:
```
2b09cd9 feat: Topic 7.5 — worksheet, Blooket, grading, transcripts, roadmap update
3014eef fix: rebuild roadmap with 7.4 drills URL + animation status
```

## Current State

- **Registry**: 46 lessons (units 1–7), 7.5 fully complete
- **Queue**: 300 total, 111 completed, 189 pending, 18 unblocked
- **Schoology B**: 46 lessons with folders, 7.5 has all materials + 3 videos
- **Schoology E**: 13 lessons with folders (33 need backfill)
- **URLs**: 46 worksheets, 23 drills, 44 quizzes, 16 Blookets, 2 with videos
- **Calendar**: 14/14 lessons ready, roadmap rebuilt

## Key Paths

- Pipeline: `scripts/lesson-prep.mjs`
- Registry: `state/lesson-registry.json`
- Work queue: `state/work-queue.json`
- Drive index: `config/drive-video-index.json`
- Video source: `C:/Users/ColsonR/curriculum_render/data/units.js`
- Poster: `scripts/post-to-schoology.mjs`
- Roadmap builder: `scripts/build-roadmap-data.mjs`
- Calendar HTMLs: `C:/Users/ColsonR/apstats-live-worksheet/week_*_calendar.html`
- U7 cartridge: `lrsl-driller/cartridges/apstats-u7-mean-ci/`

## Environment

- Windows 11, Git Bash, Node v22.19.0
- Codex CLI v0.106.0 (`codex exec --full-auto`)
- Edge CDP on port 9222
- Schoology B: `7945275782`, E: `7945275798`
- Manim CE v0.18.1, ffmpeg at `C:/Users/ColsonR/ffmpeg/bin/`

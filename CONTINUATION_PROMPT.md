# Agent Repo - Continuation Prompt

Paste this into a new Claude Code session in the `Agent` directory.

---

## What to do NOW

Pause Unit 8 ingest for now. As of March 16, 2026, Gemini is stalling after about 5 prompts in one session. We used 6 prompts getting `8.3` through ingest and then hit the wall again on the first `8.4` prompt.

Do not use `--auto`. It still overwrites explicit `--unit` / `--lesson` values with calendar detection.

When Gemini has cooled down, resume with `8.4` only:

```bash
node scripts/lesson-prep.mjs --unit 8 --lesson 4 \
  --drive-ids 16dgP2zYBVUN2qzFlGRXKZ5aqErJv8FyQ
```

If `8.4` stalls again, stop instead of hammering more prompts. Start a fresh Gemini session later rather than burning through the remaining Unit 8 lessons.

## Unit 8 Status

- `8.1`: full. Both periods posted. All three repos have the shipped content.
- `8.2`: full. Both periods posted. Drive-ids quoting fix and course-context fix are shipped.
- `8.3`: partial. Ingest done, worksheet done, blooket done, and posted to both periods. Drills are not complete, and one of four new animations did not make it through render/upload cleanly.
- `8.4`: blocked. Ingest stalled at `0/2` files because Gemini rate-limited.
- `8.5`: not started.
- `8.6`: not started.

## Remaining Drive IDs

| Lesson | Status | Drive IDs |
|--------|--------|-----------|
| 8.3 | partial | `1NemHYSwgnig3l3FUeyDYcDdt80aIYfd4 1A3t8-9QW7ubguCrQdApGKf4GkZWb1qBi 1tqgSvs4IHjltdUWtH7WmyqbPWGCMMoXb` |
| 8.4 | blocked by Gemini cooldown | `16dgP2zYBVUN2qzFlGRXKZ5aqErJv8FyQ` |
| 8.5 | not started | `1YHP2ipcZ5Vj35OVgZBYwExUjfU-yB2q1 1mDfMU3wJoLUEQY44eNr1d-XnwXl6aRlt` |
| 8.6 | not started | `1DS_LxyMAABbjaN3VrMjBcDXy0PwbDaP3 1hm-K8vBzjXcx7hTdU2E8-0bIDhdUgiq_ 1v9ENpspNX7MSsuE50ZXoQyizuGOJ35sp` |

## 8.3 Reality Check

Treat `8.3` as partial, not full.

- Ingest artifacts exist for all 3 videos: 6 files total under `C:/Users/ColsonR/apstats-live-worksheet/u8/`.
- Worksheet exists: `C:/Users/ColsonR/apstats-live-worksheet/u8_lesson3_live.html`
- Blooket exists and upload is recorded.
- Agent commit `ebdca48` corrected the registry so `8.3` drills are `pending` and the Codex worksheet/drills timeouts are now 20 minutes.
- The drills cartridge still only contains `8.1-8.2` material in `cartridges/apstats-u8-unexpected-results/`.
- `lrsl-driller` has 4 new `8.3` scene source files, but only 3 uploaded animation files are recorded in `state/animation-uploads.json`.
- Registry status for `8.3` Schoology is `done`, but the detailed Period E material list in the registry only shows the worksheet entry. If exact Period E materials matter, verify in the Schoology UI.

## What shipped in this session

- `6225d91`: fix pipeline posts to both periods, fix drive-ids array quoting
- `024a073`: pipeline add U8 L2 content in `Agent`
- `1f22f17`: pipeline add U8 L2 content in `lrsl-driller`
- `1bd2778`: pipeline add U8 L3 content in `apstats-live-worksheet`
- `90e0e7c`: pipeline add U8 L3 content in `lrsl-driller`
- `1ac3e46`: pipeline add U8 L3 content in `Agent`
- `ebdca48`: correct `8.3` drills status in registry, bump Codex worksheet/drills timeouts from 15m to 20m

## Current Repo State

- `Agent`: HEAD `ebdca48`, clean
- `apstats-live-worksheet`: HEAD `1bd2778`, dirty
- `lrsl-driller`: HEAD `90e0e7c`, dirty

Do not assume the non-Agent repos are clean after pipeline runs. Check `git status` before making cleanup commits.

## Post-pipeline checklist

Pipeline can commit and push automatically, but verify outcomes instead of trusting the summary blindly.

1. Run only one lesson at a time with explicit `--unit` and `--lesson`.
2. If Schoology fails, post manually:
   - Period B: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --no-prompt`
   - Period E: `node scripts/post-to-schoology.mjs --unit U --lesson L --auto-urls --with-videos --course 7945275798 --no-prompt --create-folder "Topic U.L"`
3. If render fails, use `cd C:/Users/ColsonR/lrsl-driller && python render_batch.py --lesson NN`
4. Re-run animation upload with `node scripts/batch-upload-animations.mjs`
5. No `build-roadmap-data.mjs` step is needed. Poster writes to Supabase live.

## Known issues

- Gemini rate limit is now closer to 5 prompts per session, not the earlier 8-10 estimate.
- `8.3` drills are incomplete. The cartridge under `cartridges/apstats-u8-unexpected-results/` still only covers `8.1-8.2`.
- `8.3` has 4 new scene source files, but only 3 uploaded animation files are recorded.
- `--auto` flag bug still exists.
- Duplicate Schoology links still need manual cleanup for `8.1`:
  - Period B: `work-ahead/future > Week 28 > Monday 4/6/26`
  - Period E: `work-ahead/future > Week 28 > Friday 4/10/26`
- `ffmpeg` is not on PATH. Use `render_batch.py`.
- Close all Edge windows before launching the debug instance.

## Key files

- Shared metadata: `scripts/lib/course-metadata.mjs`
- Pipeline: `scripts/lesson-prep.mjs`
- Registry: `state/lesson-registry.json`
- Poster: `scripts/post-to-schoology.mjs`
- Drills cartridge: `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u8-unexpected-results/`
- Worksheet repo: `C:/Users/ColsonR/apstats-live-worksheet/`
- Drive index: `config/drive-video-index.json`

## Environment

- Windows 11
- Node v22.19.0
- Codex CLI v0.114.0
- Schoology B: `7945275782`
- Schoology E: `7945275798`
- Supabase: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Manim CE v0.18.1
- Python: `C:/Users/ColsonR/AppData/Local/Programs/Python/Python312/python.exe`

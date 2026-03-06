# R1: Rewrite upload-animations.mjs

## File to rewrite
`C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs`

## Read first
1. The existing script to understand current structure
2. `C:/Users/ColsonR/lrsl-driller/cartridges/apstats-u6-inference-prop/manifest.json` — look at `"animation"` fields to understand asset naming
3. `C:/Users/ColsonR/lrsl-driller/.env` — for Supabase credentials format
4. `C:/Users/ColsonR/Agent/design/lesson-prep-workflow-spec-v2.md` — section on Supabase Storage Convention

## Problems with current script
1. Default bucket is "animations" — should be "videos"
2. Upload path is `apstats-u{N}/` — should be `animations/{cartridge-id}/`
3. File discovery finds 164 files (all Manim cache) — should only find the 5 new rendered MP4s
4. No mapping from Manim scene names to manifest asset names (e.g. `TestStatisticZScore.mp4` → `TestStatistic.mp4`)

## Requirements

### Usage
```bash
node scripts/upload-animations.mjs --unit 6 --lesson 5
# Optional: --bucket videos --cartridge apstats-u6-inference-prop
```

### Cartridge mapping
Include a config map for unit → cartridge ID:
```js
const CARTRIDGE_MAP = {
  "5": "apstats-u5-sampling-dist",
  "6": "apstats-u6-inference-prop",
};
```

### File discovery
1. Read the cartridge `manifest.json`
2. Find all `"animation": "assets/XXX.mp4"` references in the NEW modes (modes containing the lesson number pattern, e.g. "6.5" in mode name)
3. For each expected asset name (e.g. `TestStatistic.mp4`), find the corresponding rendered MP4 in Manim's output dirs (`media/videos/*/480p15/`, `media/videos/*/720p30/`, etc.)
4. Match by: asset name appears as substring of rendered filename (e.g. `TestStatistic` matches `TestStatisticZScore.mp4`), OR rendered filename contains the asset name

### Upload
- Bucket: `videos` (default, configurable via `--bucket`)
- Path: `animations/{cartridge-id}/{AssetName}.mp4`
- Use `x-upsert: true` header to overwrite existing files
- Use fetch against Supabase REST API: `POST /storage/v1/object/{bucket}/{path}`
- Read SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from `.env`

### Output
Print each upload with public URL:
```
Uploading TestStatistic.mp4 (301 KB) → animations/apstats-u6-inference-prop/TestStatistic.mp4
  → https://xxx.supabase.co/storage/v1/object/public/videos/animations/apstats-u6-inference-prop/TestStatistic.mp4
```

## Do NOT
- Add npm dependencies (use built-in fetch)
- Touch any other files besides the upload script and .env.example
- Upload Manim cache/intermediate files (numbered filenames like `2883825444_*.mp4`)

After creating, verify with `node --check`.

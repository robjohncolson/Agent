# Task: Create Supabase animation upload script

## Create file
`C:/Users/ColsonR/lrsl-driller/scripts/upload-animations.mjs`

## Purpose
Upload rendered Manim MP4 animation files to a Supabase storage bucket from the command line.

## Usage
```bash
node scripts/upload-animations.mjs --unit 6 --lesson 4
```

This should:
1. Find all MP4 files matching `media/videos/*/apstat_{U}{L}_*.mp4` OR look in a `rendered/` directory for MP4s matching the unit+lesson pattern
2. Also check `animations/` for a simpler glob: find the .py files matching `apstat_{U}{L}_*.py` and look for corresponding rendered MP4s in Manim's default output dirs (`media/videos/*/480p15/`, `media/videos/*/720p30/`, `media/videos/*/1080p60/`)
3. Upload each MP4 to the Supabase storage bucket
4. Print the public URLs for each uploaded file

## Implementation
- Use `@supabase/supabase-js` (add to package.json if needed, or use fetch against the REST API directly)
- Read `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env` in the repo root
- Create `.env.example` showing the required variables (do NOT include actual keys)
- Target bucket name: `animations` (configurable via `--bucket` flag)
- Upload path: `apstats-u{U}/{filename}.mp4`
- If `.env` doesn't exist or keys are missing, print a helpful error message

## .env setup
Add to `.gitignore` if not already there:
```
.env
```

Create `.env.example`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Do NOT
- Install supabase CLI globally
- Modify any existing files besides .gitignore
- Touch cartridge code or animation .py files

# Task: Fix video-ingest.mjs naming convention

## File to modify
`C:/Users/ColsonR/apstats-live-worksheet/video-ingest.mjs`

## What exists
The script currently saves output to `u{U}_l{L}_video_context/video{N}_transcript.md` and `video{N}_slides.md`.

## Required changes
1. Change the output directory from `u{U}_l{L}_video_context/` to `u{U}/`
2. Change output filenames to match the established convention:
   - `apstat_{U}-{L}-{V}_transcription.txt` (not `transcript.md`)
   - `apstat_{U}-{L}-{V}_slides.txt` (not `slides.md`)
3. The `{V}` is the video number (1, 2, 3, etc.)
4. The `{U}` is the unit number and `{L}` is the lesson number

## Example
For `node video-ingest.mjs 6 4 video1.mp4 video2.mp4`, output should be:
- `u6/apstat_6-4-1_transcription.txt`
- `u6/apstat_6-4-1_slides.txt`
- `u6/apstat_6-4-2_transcription.txt`
- `u6/apstat_6-4-2_slides.txt`

## Existing files for reference pattern
Look at `C:/Users/ColsonR/apstats-live-worksheet/u6/` for the naming convention already in use.

## Do NOT
- Change the API logic, prompts, or model selection
- Add new dependencies
- Modify `.env` or `.gitignore`

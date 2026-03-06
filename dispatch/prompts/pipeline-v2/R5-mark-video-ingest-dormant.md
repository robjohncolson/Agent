# R5: Mark video-ingest.mjs as dormant

## File to modify
`C:/Users/ColsonR/apstats-live-worksheet/video-ingest.mjs`

## Change
Add a prominent comment block at the very top of the file (after the shebang line), before the existing JSDoc comment:

```javascript
/**
 * ⚠️  DORMANT — Gemini 3.1 Pro has zero free API quota as of March 2026.
 * This script cannot be used with the model needed for video transcription.
 * The working alternative is: Agent/scripts/aistudio-ingest.mjs (CDP browser automation)
 * Keep this script for future use if Gemini 3.1 Pro API quota becomes available.
 */
```

## Do NOT
- Delete the script
- Change any logic
- Modify any other files

That's it — one comment block addition.

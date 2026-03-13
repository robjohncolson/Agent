# Agent B: Include videos in roadmap data

## Task

Modify `scripts/build-roadmap-data.mjs` to:
1. Include AP Classroom video URLs in the roadmap data output
2. Remove the video exclusion filter so video posts count toward "posted" status

## File Ownership

You may ONLY modify: `scripts/build-roadmap-data.mjs`

## Changes Required

### Change 1: Add videos to the urls object (around line 44-49)

Current:
```javascript
const urls = {
  worksheet: entry.urls.worksheet || null,
  drills:    entry.urls.drills || null,
  quiz:      entry.urls.quiz || null,
  blooket:   entry.urls.blooket || null,
};
```

Add:
```javascript
const urls = {
  worksheet: entry.urls.worksheet || null,
  drills:    entry.urls.drills || null,
  quiz:      entry.urls.quiz || null,
  blooket:   entry.urls.blooket || null,
  videos:    entry.urls.apVideos || [],
};
```

### Change 2: Remove the video filter (line 88)

Current:
```javascript
const materialKeys = materials
  ? Object.keys(materials).filter(k => k !== "videos")
  : [];
```

Change to:
```javascript
const materialKeys = materials
  ? Object.keys(materials)
  : [];
```

## Acceptance

- `node scripts/build-roadmap-data.mjs` runs without errors
- Generated `roadmap-data.json` includes `urls.videos` array
- Lessons with video materials posted to Schoology now count as `posted: true`

# Agent B: Update Calendar Link URLs

**File:** `C:/Users/ColsonR/Agent/scripts/update-calendar-links.mjs`
**Method:** CC-direct (~4 lines changed)

## Change

Update the `LINKS` constant URL values from `calendar.html` to `ap_stats_roadmap_square_mode.html`:

```js
// Before:
url: "https://robjohncolson.github.io/apstats-live-worksheet/calendar.html?period=B",
url: "https://robjohncolson.github.io/apstats-live-worksheet/calendar.html?period=E",

// After:
url: "https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=B",
url: "https://robjohncolson.github.io/apstats-live-worksheet/ap_stats_roadmap_square_mode.html?period=E",
```

No other changes needed.

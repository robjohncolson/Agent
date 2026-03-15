# Agent B: Dynamic Calendar Page

## Overview
Create `calendar.html` — a single-page dynamic calendar that fetches the topic schedule from Supabase and renders a week-grid view. Replaces the static `week_*_calendar.html` files.

## Target File
`C:/Users/ColsonR/apstats-live-worksheet/calendar.html` — **NEW**

## Requirements

### Data Source
- Supabase URL: `https://hgvnytaqmuybzbotosyj.supabase.co`
- Anon key: hardcoded constant in the JS (this is a public read-only key — safe to embed in client code)
- Anon key value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhndm55dGFxbXV5Ynpib3Rvc3lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxNTE5MTMsImV4cCI6MjA4MDcyNzkxM30.-LcH_zly4pXoX_2Vra-RbH9twPvUj6xAJp66xPi02tU`
- Table: `topic_schedule`
- REST query: `GET /rest/v1/topic_schedule?period=eq.{period}&select=topic,date,title,status,schoology_folder_id&order=date.asc`
- Headers: `apikey: {anon_key}`

### Week Calculation (port from Node.js)
Port this `determineSchoolWeek` logic to browser JavaScript:

```javascript
// Known anchor: week 23 starts Monday March 2, 2026
const ANCHOR_MONDAY = new Date(2026, 2, 2); // month is 0-indexed
const ANCHOR_WEEK = 23;

function determineSchoolWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const target = new Date(year, month - 1, day);

  // Get Monday of target week
  const dow = target.getDay(); // 0=Sun
  const targetMonday = new Date(target);
  targetMonday.setDate(target.getDate() - ((dow + 6) % 7));

  const msDiff = targetMonday.getTime() - ANCHOR_MONDAY.getTime();
  const weekDiff = Math.round(msDiff / (7 * 24 * 60 * 60 * 1000));
  const weekNum = ANCHOR_WEEK + weekDiff;

  let quarter;
  if (weekNum <= 20) quarter = 'S2';
  else if (weekNum <= 30) quarter = 'Q3';
  else quarter = 'Q4';

  return { quarter, weekNum };
}
```

### UI Layout

1. **Header bar**: "AP Statistics — Topic Calendar" with period toggle buttons (B / E)
2. **Week grid**: One row per week, 5 columns (Mon–Fri)
   - Week label on the left: "Week 23 (Q3)", "Week 24 (Q3)", etc.
   - Each day cell shows the date and any topics scheduled for that day
3. **Topic cards** inside day cells:
   - Title: "Topic 7.3" (bold) + subtitle from `title` field
   - Color-coded by `status`:
     - `scheduled` → gray (#e2e8f0) border-left accent
     - `posted` → blue (#3b82f6) border-left accent
     - `taught` → green (#22c55e) border-left accent
4. **Today highlight**: Current date cell gets a subtle yellow (#fef9c3) background
5. **Auto-scroll**: On load, scroll to the current week

### Period Selector
- URL parameter: `?period=B` or `?period=E` (default: B)
- Toggle buttons at top switch between periods and update URL without reload
- Re-fetches data on period change

### Date Range
- Show weeks from the earliest to latest date in the fetched data
- Fill in empty day cells (no topic) with just the date number

### Styling
- Self-contained — all CSS inline in a `<style>` block
- Clean, modern look — system font stack, subtle borders, responsive
- Mobile-friendly: stack days vertically on narrow screens
- No external dependencies (no Tailwind, no Bootstrap)

### Error Handling
- If Supabase fetch fails, show a banner: "Could not load schedule. Check your connection."
- Loading state: show a spinner or "Loading..." text

## Final URL
`https://robjohncolson.github.io/apstats-live-worksheet/calendar.html?period=B`

## Do NOT
- Do not use any npm packages, build tools, or frameworks
- Do not create multiple files — everything in one `calendar.html`
- Do not modify any other files
- Do not hardcode topic data — it must come from Supabase at runtime

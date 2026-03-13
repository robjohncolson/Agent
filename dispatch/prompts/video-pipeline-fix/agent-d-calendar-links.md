# Agent D: Calendar HTML link enhancement (CC-direct)

## Task

Add clickable material links to the calendar HTML files. Create a shared JavaScript file that fetches `roadmap-data.json` at runtime and injects material hyperlinks into each lesson's period block.

## File Ownership

All work in: `C:/Users/ColsonR/apstats-live-worksheet/`
- `calendar-linker.js` (create)
- All 9 `week_*_calendar.html` files (add script tag + CSS)

## calendar-linker.js Design

### How it works:
1. On `DOMContentLoaded`, fetch `roadmap-data.json` (relative URL — same repo)
2. Find all `.period-block` elements
3. For each, extract the topic ID from `.topic-tag` text (e.g., "6.6")
4. Look up `roadmapData.lessons["6.6"].urls`
5. Create a `.materials-row` div with linked badges for each available material:
   - Worksheet (blue) — icon: 📝
   - Drills (green) — icon: 🎯
   - Quiz (orange) — icon: 📋
   - Blooket (purple) — icon: 🎮
   - Videos (red) — one badge per video entry — icon: 🎬
6. Append the materials row after the last `.detail-row` in the period block

### Badge HTML:
```html
<a href="URL" target="_blank" class="material-link material-worksheet">📝 Worksheet</a>
```

### Handle edge cases:
- If `roadmap-data.json` fails to load, silently do nothing
- If a lesson has no entry in roadmap data, skip it
- If a period block has multiple topic tags (e.g., "6.4" + "6.5"), use the first topic
- Videos field may be an array of `{url, title}` objects — create one badge per video

## CSS to add (in each calendar HTML's `<style>` block)

```css
.materials-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    margin-top: 0.3rem;
    padding-top: 0.3rem;
    border-top: 1px dashed var(--gray-300);
}
.material-link {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 500;
    text-decoration: none;
    transition: opacity 0.2s;
}
.material-link:hover { opacity: 0.8; }
.material-worksheet { background: #e3f2fd; color: #1565c0; }
.material-drills { background: #e8f5e9; color: #2e7d32; }
.material-quiz { background: #fff3e0; color: #e65100; }
.material-blooket { background: #f3e5f5; color: #7b1fa2; }
.material-videos { background: #ffebee; color: #c62828; }
```

## Calendar HTML structure (for reference)

```html
<div class="period-block period-b">
    <div class="period-label">📘 Period B</div>
    <div><span class="topic-tag">6.6</span></div>
    <div class="content-title">Concluding a Test for p</div>
    <div class="detail-row">
        <span class="detail-label">Due:</span>
        <span><span class="due-item">Quiz 6.4</span></span>
    </div>
    <div class="detail-row">
        <span class="detail-label">Assign:</span>
        <span><span class="assign-item">Drills 6.6</span></span>
    </div>
    <!-- materials-row will be injected here by calendar-linker.js -->
</div>
```

## HTML modifications

Add before `</head>` in each calendar HTML:
```html
<script src="calendar-linker.js" defer></script>
```

Add the CSS above into each file's existing `<style>` block (before the closing `</style>` tag).

## Calendar files (all 9):
- week_mar2_calendar.html
- week_mar9_calendar.html
- week_mar16_calendar.html
- week_mar23_calendar.html
- week_mar30_calendar.html
- week_apr6_calendar.html
- week_apr13_calendar.html
- week_apr27_calendar.html
- week_may4_calendar.html

## Acceptance

- Opening any calendar HTML shows clickable material badges
- Badges link to correct URLs from roadmap-data.json
- Missing materials are omitted (no empty badges)
- Multiple videos show as separate badges
- Works when served from GitHub Pages (relative fetch)

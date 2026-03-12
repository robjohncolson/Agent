# Agent A — Drill URL Truth Table

## Task

Create `scripts/lib/drill-url-table.mjs` — a self-contained module exporting the correct drill URLs for all 11 Unit 6 lessons plus title-matching helpers.

## Owned Files

- `scripts/lib/drill-url-table.mjs` (create)

## Requirements

### Exports

```javascript
// Base URL shared by all drills
export const DRILL_BASE_URL = 'https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop';

// Map: lesson number (1–11) → level ID string
export const LEVEL_IDS = { 1: 'l01-identify-evidence', 2: 'l04-identify-procedure', ... };

// Returns the full correct drill URL for a lesson, or null if not in map
export function getCorrectDrillUrl(lesson) { ... }

// Returns true if `title` looks like a drill link for `lessonNum`
// Match: /drill/i in title AND lesson number present (e.g., "6.3" or just "Drill")
export function isDrillTitle(title, lessonNum) { ... }

// Canonical drill link title for posting: "Topic 6.N — Drills"
export function drillTitle(lessonNum) { ... }
```

### URL Table (exact values)

| Lesson | Level ID |
|--------|----------|
| 1 | `l01-identify-evidence` |
| 2 | `l04-identify-procedure` |
| 3 | `l12-interpret-ci` |
| 4 | `l17-state-null` |
| 5 | `l24-test-statistic` |
| 6 | `l29-compare-pvalue-alpha` |
| 7 | `l35-identify-error-type` |
| 8 | `l44-identify-two-prop-ci` |
| 9 | `l49-interpret-two-prop-claim-interval` |
| 10 | `l17-hypotheses-610` |
| 11 | `l21-test-statistic-611` |

### `isDrillTitle(title, lessonNum)` logic

- Case-insensitive check for "drill" in the title
- Also verify lesson number appears: look for `6.{lessonNum}` pattern OR just accept any drill title if lessonNum is not specified
- Examples that should match:
  - `"Topic 6.3 — Drills"` (canonical)
  - `"Drills — 6.3"` (alt format)
  - `"Topic 6.3 - Drills"` (en-dash variant)
- Examples that should NOT match:
  - `"Topic 6.3 — Follow-Along Worksheet"` (not a drill)
  - `"Topic 6.4 — Drills"` when lessonNum=3 (wrong lesson)

### Constraints

- No imports — this module is pure data + simple functions
- Use ES module syntax (`export`)
- No dependencies on any other project files
- Unit number is always 6 (hardcoded for this use case)

## Acceptance Criteria

- [ ] `getCorrectDrillUrl(5)` returns `'https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop&level=l24-test-statistic'`
- [ ] `getCorrectDrillUrl(99)` returns `null`
- [ ] `isDrillTitle("Topic 6.3 — Drills", 3)` returns `true`
- [ ] `isDrillTitle("Topic 6.4 — Drills", 3)` returns `false`
- [ ] `drillTitle(7)` returns `"Topic 6.7 — Drills"`
- [ ] All 11 level IDs match the table exactly

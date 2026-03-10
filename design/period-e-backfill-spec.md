# Period E Schoology Backfill — Spec

**Author**: Agent (2026-03-10)
**Status**: Ready for implementation

---

## Problem

Period E's Schoology course (7945275798) has almost no automated content. Only one folder exists with manually-posted 6.3 links. Period E is ~3 lessons behind Period B, but all the content URLs already exist in the lesson registry. We need to:

1. Add `--period` support to `schoology-manage.mjs`
2. Build out E's folder structure with all lesson links, calendar-aware
3. Separate past vs. future content using a `work-ahead/future` folder

## Current State — Period E (7945275798)

```
Top level:
  [link] CALENDAR (now to end of year)
  [link] Math Practice Website
  [link] apStat Consensus-based quizzes!
  [link] After School Help
  [link] AP Classroom Join Code (AML7ND)
  [folder] S1 (970439290)
  [folder] S2 (979668603)
  [folder] Q3 (979668645) → contains weeks 20-23
  [folder] Week 24 (986478216) → EMPTY
  [folder] monday (3/9/26) (986806670) → 6.3 links (manually posted, leave as-is)
```

### Existing Content (leave untouched)

`monday (3/9/26)` already has these manually-posted links for 6.3:
- apstats_6-3 blooket
- ap classroom video 6-3-3
- APSTATS 6-3 drills
- quiz 6-2
- ap classroom video 6-3-2
- apstats_6-3 follow along
- ap classroom video 6-3-1

## Calendar — Period E Schedule (source of truth)

Today is Tuesday 3/10/26. E does not meet Tuesdays.

| Date | Day | Lesson(s) | Past/Future | Week |
|------|-----|-----------|-------------|------|
| Mon 3/9 | Monday | 6.3 | PAST (already posted) | 24 |
| Wed 3/11 | Wednesday | 6.4 + 6.5 | FUTURE | 24 |
| Fri 3/13 | Friday | 6.6 | FUTURE | 24 |
| Mon 3/16 | Monday | 6.7 | FUTURE | 25 |
| Wed 3/18 | Wednesday | 6.8 + 6.9 | FUTURE | 25 |
| Fri 3/20 | Friday | 6.10 | FUTURE | 25 |
| Mon 3/23 | Monday | 6.11 | FUTURE | 26 |
| Wed 3/25 | Wednesday | 7.1 + 7.2 | FUTURE | 26 |
| Fri 3/27 | Friday | 7.3 | FUTURE (not in registry) | 26 |

## Target Folder Structure — Period E

```
Top level:
  monday (3/9/26)/              ← LEAVE AS-IS (has 6.3 links)
  work-ahead/future/ (red)      ← CREATE
    Week 24/                    ← MOVE existing empty folder into here
      Wednesday 3/11/26/        ← CREATE (6.4 + 6.5 links)
      Friday 3/13/26/           ← CREATE (6.6 links)
    Week 25/                    ← CREATE
      Monday 3/16/26/           ← CREATE (6.7 links)
      Wednesday 3/18/26/        ← CREATE (6.8 + 6.9 links)
      Friday 3/20/26/           ← CREATE (6.10 links)
    Week 26/                    ← CREATE
      Monday 3/23/26/           ← CREATE (6.11 links)
      Wednesday 3/25/26/        ← CREATE (7.1 + 7.2 links)
```

Note: Friday 3/27 (7.3) is skipped — not yet in the registry.

## Link Naming Convention

Identical to Period B:
```
Live Worksheet — {U}.{L}
Drills — {U}.{L}
Quiz — {U}.{L}
Blooket — {U}.{L}
```

Only post links that have URLs. Skip nulls silently.

## Registry URL Availability

| Lesson | Worksheet | Drills | Quiz | Blooket |
|--------|-----------|--------|------|---------|
| 6.4 | Y | Y | Y | - |
| 6.5 | Y | Y | Y | - |
| 6.6 | Y | Y | Y | Y |
| 6.7 | Y | Y | Y | Y |
| 6.8 | Y | Y | Y | - |
| 6.9 | Y | Y | Y | - |
| 6.10 | Y | Y | Y | Y |
| 6.11 | Y | Y | Y | Y |
| 7.1 | Y | - | - | Y |
| 7.2 | Y | Y | Y | Y |

## Implementation

### Part 1: Add `--period` flag to `schoology-manage.mjs`

Add a course ID map and parse `--period` from args:

```js
const COURSE_IDS = {
  B: "7945275782",
  E: "7945275798",
};
```

All commands accept `--period B|E` (default B). The selected course ID is passed to all command functions.

### Part 2: Backfill plan data file

`dispatch/period-e-backfill-plan.json` — a JSON file encoding the exact folder structure and links to create:

```json
{
  "courseId": "7945275798",
  "actions": [
    { "type": "create-folder", "name": "work-ahead/future", "color": "red", "in": null },
    { "type": "move-folder", "name": "Week 24", "into": "work-ahead/future" },
    { "type": "create-folder", "name": "Wednesday 3/11/26", "in": "Week 24" },
    { "type": "post-links", "folder": "Wednesday 3/11/26", "lessons": ["6.4", "6.5"] },
    ...
  ]
}
```

### Part 3: Backfill execution script

`scripts/schoology-backfill.mjs` — reads a plan JSON and executes it against Schoology via CDP. Reusable for any period/plan.

```bash
node scripts/schoology-backfill.mjs dispatch/period-e-backfill-plan.json
```

The script:
1. Connects via CDP
2. Reads the plan JSON
3. Reads the lesson registry for URLs
4. Executes each action in order using `schoology-dom.mjs` helpers
5. Skips actions whose folders already exist (idempotent)
6. For `post-links` actions, looks up each lesson's URLs in the registry, posts available ones

### Part 4: Course ID constants

Add to `scripts/lib/schoology-dom.mjs`:
```js
export const COURSE_IDS = { B: "7945275782", E: "7945275798" };
```

---

## Dependency Graph

```
Layer 0 (no deps, parallel):
  [A] Add COURSE_IDS to schoology-dom.mjs + --period flag to schoology-manage.mjs
  [B] Create period-e-backfill-plan.json (data file)

Layer 1 (depends on A):
  [C] Write schoology-backfill.mjs (generic plan executor)

Layer 2 (manual, depends on B + C):
  [D] Execute: node scripts/schoology-backfill.mjs dispatch/period-e-backfill-plan.json
```

A and B are fully independent and parallelizable via Codex.
C depends on A (needs COURSE_IDS export) but can also be parallelized if the import is specified in the prompt.
D is manual execution (requires live browser).

---

## Constants

```
Period B course ID: 7945275782
Period E course ID: 7945275798
Materials URL pattern: https://lynnschools.schoology.com/course/{courseId}/materials
E's Week 24 folder ID: 986478216
```

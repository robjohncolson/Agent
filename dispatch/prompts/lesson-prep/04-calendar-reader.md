# Task: Create calendar reader script

## Create file
`C:/Users/ColsonR/Agent/scripts/whats-tomorrow.mjs`

## Purpose
Parse the weekly calendar HTML to show what topics are scheduled for tomorrow (or a given date).

## Usage
```bash
node scripts/whats-tomorrow.mjs                    # defaults to tomorrow
node scripts/whats-tomorrow.mjs --date 2026-03-05  # specific date
```

## Output format
```
Thursday, Mar 5

Period B:
  Topic: 6.4 — Setting Up a Test for a Population Proportion
  Due:   Quiz 6.1-6.2
  Assign: Drills 6.4, Quiz 6.3

Period E:
  Topic: 5.8 — Sampling Distributions for Differences in Sample Means
  Due:   Quiz 5-6
  Assign: U5 PC, Drills 5.8, Quiz 5-7
```

## Implementation

1. Find the right calendar file:
   - Look in `C:/Users/ColsonR/apstats-live-worksheet/` for files matching `week*_calendar.html`
   - Parse each to find the one containing the target date
   - Calendar HTML contains day columns with `day-date` divs showing dates like "Mar 5"

2. Parse the HTML:
   - Use regex or simple string parsing (no DOM library needed — the HTML structure is predictable)
   - Each day is in a `day-column` div
   - Day header contains `day-name` (Monday, Tuesday...) and `day-date` (Mar 5)
   - Period blocks contain `topic-tag` spans, `due-item` spans, and `assign-item` spans
   - Periods are identified by color classes: `period-b` and period without a class (or `period-e`)

3. Match the target date:
   - Parse "Mar 5" style dates from the HTML
   - Compare with the target date
   - Handle the case where the calendar file hasn't been created yet (print helpful message)

## Date handling
- Default to tomorrow based on system clock
- Parse `--date YYYY-MM-DD` flag if provided
- Convert to month abbreviation + day for matching against calendar HTML

## Do NOT
- Add npm dependencies (use built-in Node.js only)
- Modify any existing files
- Create multiple files

/**
 * folder-name-standardizer.mjs — Standardize Schoology folder titles to
 * "{DayOfWeek} {M/D/YY}" format.
 *
 * Handles the full zoo of naming conventions accumulated across the school year:
 *   Monday(September 29th, 2025) apstat  →  Monday 9/29/25
 *   THURSDAY NOV 13 2025                 →  Thursday 11/13/25
 *   friday (3/6/26)                      →  Friday 3/6/26
 *   Thursday (2/26)                      →  Thursday 2/26/26
 *   Friday 3/20/26                       →  Friday 3/20/26  (already correct)
 */

// ── Month name → number mapping ─────────────────────────────────────────────

const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const DAYS_OF_WEEK = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Capitalize first letter, lowercase rest: "THURSDAY" → "Thursday" */
function normalizeDayOfWeek(raw) {
  const lower = raw.toLowerCase().trim();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Resolve month name (full or 3-letter abbreviation) to number. */
function monthNameToNumber(name) {
  return MONTH_MAP[name.toLowerCase().trim()] ?? null;
}

/**
 * Normalize a 2- or 4-digit year to 2-digit string.
 * 2025 → "25", 26 → "26", 2026 → "26"
 */
function normalizeYear(y) {
  const n = typeof y === 'string' ? parseInt(y, 10) : y;
  if (n >= 2000) return String(n - 2000);
  return String(n);
}

/**
 * Infer 2-digit year when the year is missing entirely.
 * School year convention: Aug-Dec = 2025, Jan-Jul = 2026.
 * (This covers the 2025-2026 school year; good enough for this corpus.)
 */
function inferYear(month) {
  return month >= 8 ? '25' : '26';
}

/** Strip ordinal suffixes: "29th" → "29", "2nd" → "2", "3rd" → "3" */
function stripOrdinal(s) {
  return s.replace(/(?:st|nd|rd|th)$/i, '');
}

// ── Regex pattern chain (most specific → least specific) ─────────────────────

/**
 * Each pattern returns { dayOfWeek, month, day, year } or null.
 * They are tried in order; first match wins.
 */
const PATTERNS = [

  // 1. {Day}({MonthName} {Nth}, {Year}) anything
  //    "Monday(September 29th, 2025) apstat"
  //    "Tuesday(September 23th, 2025) apstat"
  {
    name: 'day-paren-monthname-nth-year',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s*\\(\\s*(\\w+)\\s+(\\d+\\w*)\\s*,?\\s*(\\d{4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(stripOrdinal(m[3]), 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 2. {Day} ({MonthName} {Nth}, {Year})
  //    "Thursday (October 2nd, 2025) apstat"
  //    "Tuesday (October 7th, 2025)"
  {
    name: 'day-space-paren-monthname-nth-year',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\w+)\\s+(\\d+\\w*)\\s*,?\\s*(\\d{4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(stripOrdinal(m[3]), 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 3. {Day} ({MonthName} {D} {Year})
  //    "Thursday (jan 29 2026)"
  {
    name: 'day-paren-monthname-d-year',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\w+)\\s+(\\d+)\\s+(\\d{4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 4. {Day} ({MonthName} {D}, {Year})  — with comma, no ordinal
  //    "Monday (October 20, 2025)"
  {
    name: 'day-paren-monthname-d-comma-year',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\w+)\\s+(\\d+)\\s*,\\s*(\\d{4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 5. {Day} {MonthName} {D} {Year}
  //    "THURSDAY NOV 13 2025", "friday november 14 2025", "monday nov 10 2025"
  {
    name: 'day-monthname-d-year',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+(\\w+)\\s+(\\d+)\\s+(\\d{4})$`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 6. {Day} ({MonthName} {Nth} {Year}) — no comma between day and year
  //    "Friday (November 7 2025)"
  {
    name: 'day-paren-monthname-nth-year-nocomma',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\w+)\\s+(\\d+\\w*)\\s+(\\d{4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(stripOrdinal(m[3]), 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 7. {Day} ({M/D/YY}) or {Day} ({M/D/YYYY})
  //    "Tuesday (1/20/26)", "friday (3/6/26)", "Friday (1/23/26)"
  {
    name: 'day-paren-slash-date',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\d{1,2})/(\\d{1,2})/(\\d{2,4})\\s*\\)`,
      'i'
    ),
    extract(m) {
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month: parseInt(m[2], 10),
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 8. {Day} ({M/D}) — no year, infer from school year
  //    "Thursday (2/26)", "friday (2/13)"
  {
    name: 'day-paren-slash-noyear',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(\\s*(\\d{1,2})/(\\d{1,2})\\s*\\)$`,
      'i'
    ),
    extract(m) {
      const month = parseInt(m[2], 10);
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(m[3], 10),
        year: inferYear(month),
      };
    },
  },

  // 9. {Day} {M/D/YYYY}
  //    "monday 1/12/2026"
  {
    name: 'day-slash-date-4y',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+(\\d{1,2})/(\\d{1,2})/(\\d{4})$`,
      'i'
    ),
    extract(m) {
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month: parseInt(m[2], 10),
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 10. {Day} {M/D/YY}
  //     "Tuesday 3/10/26", "thursday 1/8/26", "friday 1/9/25"
  {
    name: 'day-slash-date-2y',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+(\\d{1,2})/(\\d{1,2})/(\\d{2})$`,
      'i'
    ),
    extract(m) {
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month: parseInt(m[2], 10),
        day: parseInt(m[3], 10),
        year: normalizeYear(m[4]),
      };
    },
  },

  // 11. {Day} {M/D} — no year, infer
  //     "Friday 2/6"
  {
    name: 'day-slash-noyear',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+(\\d{1,2})/(\\d{1,2})$`,
      'i'
    ),
    extract(m) {
      const month = parseInt(m[2], 10);
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(m[3], 10),
        year: inferYear(month),
      };
    },
  },

  // 12. {Day} ({MonthName} {D}, {Year}) — month name in parens with comma
  //     Catches any remaining "Day (Month D, Year)" variants
  {
    name: 'day-space-monthname-d-year-loose',
    regex: new RegExp(
      `^(${DAYS_OF_WEEK.join('|')})\\s+\\(?\\s*(\\w+)\\s+(\\d+\\w*)\\s*,?\\s+(\\d{4})\\s*\\)?`,
      'i'
    ),
    extract(m) {
      const month = monthNameToNumber(m[2]);
      if (!month) return null;
      return {
        dayOfWeek: normalizeDayOfWeek(m[1]),
        month,
        day: parseInt(stripOrdinal(m[3]), 10),
        year: normalizeYear(m[4]),
      };
    },
  },
];

// ── Target format regex (for detecting already-correct names) ────────────────

const TARGET_FORMAT = new RegExp(
  `^(${DAYS_OF_WEEK.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join('|')}) \\d{1,2}/\\d{1,2}/\\d{2}$`
);

// ── Skip criteria regexes ────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /^Q[1-4]$/i,                        // Quarter folders
  /^S[1-2]$/i,                        // Semester folders
  /^weeks?\s*\d/i,                    // Week folders: "week 20", "Week4", "Weeks 1 - 3"
  /^week\s*\d+\s*-\s*\d+/i,          // "Weeks 1 - 3"
  /topic\s+\d+\.\d+/i,               // Topic folders: "Topic 6.10"
  /^work-ahead/i,                     // Work-ahead/future
  /^deprecated$/i,                    // Deprecated
  /^CALENDAR\b/i,                     // Calendar items
  /^Math Practice/i,                  // Non-day folders
  /^apStat Consensus/i,              // Non-day folders
  /^After School/i,                   // Non-day folders
  /^AP Classroom/i,                   // Non-day folders
  /^All AP/i,                         // Non-day folders
  /^math games/i,                     // Non-day folders
  /^Blooket/i,                        // Non-day folders
  /^Goals$/i,                         // Non-day folders
  /^Week Calendar/i,                  // Calendar items
];

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Standardize a Schoology folder title to "{DayOfWeek} {M/D/YY}" format.
 * @param {string} title - Original folder title
 * @returns {{ standardized: string, parsed: { dayOfWeek: string, month: number, day: number, year: number }|null, changed: boolean }}
 */
export function standardizeFolderName(title) {
  if (!title || typeof title !== 'string') {
    return { standardized: title, parsed: null, changed: false };
  }

  const trimmed = title.trim();

  // Try each pattern in order
  for (const pattern of PATTERNS) {
    const m = trimmed.match(pattern.regex);
    if (m) {
      const parsed = pattern.extract(m);
      if (parsed) {
        const standardized = `${parsed.dayOfWeek} ${parsed.month}/${parsed.day}/${parsed.year}`;
        return {
          standardized,
          parsed: {
            dayOfWeek: parsed.dayOfWeek,
            month: parsed.month,
            day: parsed.day,
            year: typeof parsed.year === 'string' ? parseInt(parsed.year, 10) : parsed.year,
          },
          changed: standardized !== trimmed,
        };
      }
    }
  }

  // No pattern matched — return unchanged
  return { standardized: trimmed, parsed: null, changed: false };
}

/**
 * Check whether a folder title looks like a day-level folder (contains a day-of-week name).
 * @param {string} title
 * @returns {boolean}
 */
export function isDayFolder(title) {
  if (!title) return false;
  const lower = title.toLowerCase().trim();
  return DAYS_OF_WEEK.some(day => lower.startsWith(day));
}

/**
 * Check whether a folder title should be skipped (quarters, weeks, topics, etc.).
 * @param {string} title
 * @returns {{ skip: boolean, reason: string }}
 */
export function shouldSkipFolder(title) {
  if (!title) return { skip: true, reason: 'empty title' };

  const trimmed = title.trim();

  // Already matches target format exactly
  if (TARGET_FORMAT.test(trimmed)) {
    return { skip: true, reason: 'already standardized' };
  }

  // Known non-day folder patterns
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(trimmed)) {
      return { skip: true, reason: 'non-day folder' };
    }
  }

  // Does it start with a day of week? If not, skip it — it's not a day folder.
  if (!isDayFolder(trimmed)) {
    return { skip: true, reason: 'no day-of-week prefix' };
  }

  return { skip: false, reason: '' };
}

/**
 * Batch standardize all day-level folders in the tree.
 * Only targets leaf-level day folders (depth >= 3 typically), skips quarter/week/topic folders.
 * @param {object} tree - scraped schoology-tree.json
 * @returns {{ renames: { folderId: string, oldTitle: string, newTitle: string }[], skipped: { folderId: string, title: string, reason: string }[] }}
 */
export function planFolderRenames(tree) {
  const renames = [];
  const skipped = [];

  const folders = tree?.folders ?? {};

  for (const [folderId, folder] of Object.entries(folders)) {
    const title = folder.title;

    // Check skip criteria
    const { skip, reason } = shouldSkipFolder(title);
    if (skip) {
      // Only log skipped day-like folders (not every structural folder)
      if (isDayFolder(title)) {
        skipped.push({ folderId, title, reason });
      }
      continue;
    }

    // Try to standardize
    const result = standardizeFolderName(title);

    if (!result.parsed) {
      // Day-of-week prefix detected but no date pattern matched
      skipped.push({ folderId, title, reason: 'unparseable date' });
      continue;
    }

    if (!result.changed) {
      // Already correct (shouldn't reach here since TARGET_FORMAT check above catches it)
      skipped.push({ folderId, title, reason: 'already standardized' });
      continue;
    }

    renames.push({
      folderId,
      oldTitle: title,
      newTitle: result.standardized,
    });
  }

  // Sort renames by the parsed date for readable output
  renames.sort((a, b) => {
    const pa = standardizeFolderName(a.oldTitle).parsed;
    const pb = standardizeFolderName(b.oldTitle).parsed;
    if (!pa || !pb) return 0;
    const ya = pa.year < 50 ? pa.year + 2000 : pa.year + 1900;
    const yb = pb.year < 50 ? pb.year + 2000 : pb.year + 1900;
    return (ya * 10000 + pa.month * 100 + pa.day) - (yb * 10000 + pb.month * 100 + pb.day);
  });

  return { renames, skipped };
}

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
 * Use DeepSeek to parse folder titles that regex couldn't handle.
 * Batches all unparseable day-folder titles into a single API call.
 *
 * @param {string[]} titles - Folder titles that start with a day-of-week but failed regex parsing
 * @returns {Promise<Map<string, { dayOfWeek: string, month: number, day: number, year: string }>>}
 */
export async function batchResolveUnparseableWithAI(titles) {
  const resultMap = new Map();
  if (!titles || titles.length === 0) return resultMap;

  // Dynamic import to avoid hard dependency
  let callDeepSeekRaw;
  try {
    const mod = await import('./schoology-classify-ai.mjs');
    // We need to reuse the .env loading and fetch logic, so we'll build our own prompt
    // and use the module's cache infrastructure
    callDeepSeekRaw = async (prompt) => {
      // Load .env for API key (the module does this on import)
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        console.warn('[folder-ai] DEEPSEEK_API_KEY not set — skipping AI lookup');
        return null;
      }
      try {
        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: 2000,
          }),
        });
        if (!response.ok) {
          console.error(`[folder-ai] DeepSeek API error: ${response.status}`);
          return null;
        }
        const data = await response.json();
        return data?.choices?.[0]?.message?.content?.trim() || null;
      } catch (err) {
        console.error(`[folder-ai] DeepSeek API call failed: ${err.message}`);
        return null;
      }
    };
  } catch {
    console.warn('[folder-ai] Could not load AI module');
    return resultMap;
  }

  // Ensure .env is loaded for API key
  if (!process.env.DEEPSEEK_API_KEY) {
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { AGENT_ROOT } = await import('./paths.mjs');
      const envPath = join(AGENT_ROOT, '.env');
      const envContent = readFileSync(envPath, 'utf-8');
      for (const rawLine of envContent.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m && !process.env[m[1].trim()]) {
          process.env[m[1].trim()] = m[2].trim();
        }
      }
    } catch { /* .env missing */ }
  }

  const numbered = titles.map((t, i) => `${i + 1}. "${t}"`).join('\n');

  const prompt = `You are a date parser for Schoology course folder names from an AP Statistics class (2025-2026 school year, Aug 2025 - Jun 2026).

Each folder title below starts with a day of the week but has a non-standard date format that automated regex couldn't parse. Extract the date from each.

For each title, return a JSON object: {"dayOfWeek": "Monday", "month": 3, "day": 9, "year": "26"} or null if genuinely not a date.

Rules:
- dayOfWeek should be properly capitalized (e.g., "Monday" not "monday")
- month is 1-12 integer
- day is 1-31 integer
- year is 2-digit string: "25" for 2025, "26" for 2026
- School year: Aug-Dec = 2025, Jan-Jul = 2026
- If a title has "apstat" or similar suffix, ignore it — focus on the date

Titles:
${numbered}

Return ONLY a JSON array, e.g.: [{"dayOfWeek":"Monday","month":9,"day":29,"year":"25"}, null, ...]`;

  const raw = await callDeepSeekRaw(prompt);
  if (!raw) return resultMap;

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[folder-ai] No JSON array found in AI response');
      return resultMap;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return resultMap;

    for (let i = 0; i < Math.min(parsed.length, titles.length); i++) {
      const entry = parsed[i];
      if (!entry) continue;

      // Validate
      if (typeof entry.dayOfWeek === 'string' &&
          typeof entry.month === 'number' && entry.month >= 1 && entry.month <= 12 &&
          typeof entry.day === 'number' && entry.day >= 1 && entry.day <= 31 &&
          (typeof entry.year === 'string' || typeof entry.year === 'number')) {
        resultMap.set(titles[i], {
          dayOfWeek: entry.dayOfWeek.charAt(0).toUpperCase() + entry.dayOfWeek.slice(1).toLowerCase(),
          month: entry.month,
          day: entry.day,
          year: String(entry.year).length > 2 ? normalizeYear(entry.year) : String(entry.year),
        });
      }
    }
  } catch (err) {
    console.warn(`[folder-ai] Failed to parse AI response: ${err.message}`);
  }

  return resultMap;
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

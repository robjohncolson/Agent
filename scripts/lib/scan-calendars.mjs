/**
 * scan-calendars.mjs — Parse weekly calendar HTML files and return
 * a sorted, deduplicated list of Period B lessons.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_DIR } from "./paths.mjs";

/**
 * Scan all calendar HTML files in CALENDAR_DIR and extract Period B lessons.
 * @returns {Array<{unit:number, lesson:number, date:Date, dateLabel:string, dayName:string, title:string}>}
 */
export function scanCalendars() {
  const files = readdirSync(CALENDAR_DIR).filter(f => /_calendar\.html$/i.test(f));
  if (!files.length) return [];

  const entries = [];

  for (const file of files) {
    const html = readFileSync(join(CALENDAR_DIR, file), "utf-8");
    const daySections = html.split(/<div\s+class="day-column">/);

    for (let i = 1; i < daySections.length; i++) {
      const sec = daySections[i];

      const nameMatch = sec.match(/<div\s+class="day-name">\s*(.*?)\s*<\/div>/);
      const dateMatch = sec.match(/<div\s+class="day-date">\s*(.*?)\s*<\/div>/);
      if (!nameMatch || !dateMatch) continue;

      const dayName = nameMatch[1];
      const dateLabel = dateMatch[1];

      // Find Period B block (class must contain "period-b")
      const pbMatch = sec.match(
        /<div\s+class="period-block[^"]*period-b[^"]*">([\s\S]*?)(?=<div\s+class="period-block|$)/
      );
      if (!pbMatch) continue;

      const pbBlock = pbMatch[1];

      // Extract all topic tags
      const tagRe = /<span\s+class="topic-tag[^"]*">\s*(.*?)\s*<\/span>/g;
      let tagMatch;
      const tags = [];
      while ((tagMatch = tagRe.exec(pbBlock)) !== null) tags.push(tagMatch[1]);

      // Extract content title
      const titleMatch = pbBlock.match(/<div\s+class="content-title">\s*(.*?)\s*<\/div>/);
      const title = titleMatch ? titleMatch[1] : "";

      const date = new Date(`${dateLabel}, 2026`);

      for (const tag of tags) {
        const m = tag.match(/(\d+)\.(\d+)/);
        if (!m) continue;
        entries.push({
          unit: Number(m[1]),
          lesson: Number(m[2]),
          date,
          dateLabel,
          dayName,
          title,
        });
      }
    }
  }

  // Deduplicate by "unit.lesson" — keep earliest date
  const seen = new Map();
  for (const e of entries) {
    const key = `${e.unit}.${e.lesson}`;
    const prev = seen.get(key);
    if (!prev || e.date < prev.date) seen.set(key, e);
  }

  // Sort by date ascending
  return [...seen.values()].sort((a, b) => a.date - b.date);
}

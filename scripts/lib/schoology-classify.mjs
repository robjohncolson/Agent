// Match "Topic X.Y" or "X.Y" or "X-Y" patterns in titles
// Examples:
//   "Topic 6.10 — Follow-Along Worksheet" → {unit:6, lesson:10}
//   "apstats 5-7 blooket" → {unit:5, lesson:7}
//   "Quiz 6.9" → {unit:6, lesson:9} (this is the quiz FOR 6.9, assigned the day after)
//   "u2l7 blooket" → {unit:2, lesson:7}
//   "Unit 1 Lesson 8 video" → {unit:1, lesson:8}
//   "apclassroom video 6-2-1" → {unit:6, lesson:2}
//   "unit 4 L{10,11,12} blooket" → skip (multi-lesson)
export function parseTopicFromTitle(title) {
  if (!title) return null;
  const t = title.trim();

  // Skip multi-lesson titles like "L{10,11,12}" or "lessons 3,4,5"
  if (/\{.*,.*\}/.test(t) || /lessons?\s+\d+\s*,\s*\d+/i.test(t)) return null;
  // Skip "l1 l2" style multi-lessons
  if (/l\d+\s*,?\s*l\d+/i.test(t)) return null;
  // Skip compound references like "6-1,2" or "l1&2"
  if (/\d+[,&]\d+/.test(t)) return null;

  // "Topic X.Y" — strongest signal
  let m = t.match(/Topic\s+(\d+)\.(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "Quiz X.Y" — the quiz tests topic X.Y
  m = t.match(/Quiz\s+(\d+)\.(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2], isQuiz: true };

  // "quiz X-Y"
  m = t.match(/quiz\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2], isQuiz: true };

  // "Unit X Lesson Y" style
  m = t.match(/Unit\s*(\d+)\s*(?:Lesson|L)\s*(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "uXlY" style (e.g., "u2l7")
  m = t.match(/u(\d+)\s*l(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "apstats X-Y" or "apstat X-Y" (e.g., "apstats 5-7 blooket")
  m = t.match(/apstats?\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "apclassroom video X-Y" (e.g., "apclassroom video 6-2-1" → 6.2)
  m = t.match(/apclassroom\s+video\s+(\d+)-(\d+)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "X-Y follow along" or "X-Y drills" or "X-Y blooket" (loose)
  m = t.match(/(\d+)-(\d+)\s+(?:follow|drill|blooket|vid)/i);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "Title — X.Y" or "Title - X.Y" (e.g., "Live Worksheet — 7.2", "Drills — 7.2")
  m = t.match(/[—–\-]\s*(\d+)\.(\d+)\s*$/);
  if (m) return { unit: +m[1], lesson: +m[2] };

  // "X.Y" bare (e.g., in folder descriptions like "6.6 Concluding a Test")
  m = t.match(/^(\d+)\.(\d+)\b/);
  if (m) return { unit: +m[1], lesson: +m[2] };

  return null;
}

// Classify material type from title
export function classifyMaterial(title) {
  if (!title) return 'unknown';
  const t = title.toLowerCase();

  if (/follow.?along|worksheet|wksheet/.test(t)) return 'worksheet';
  if (/drill/.test(t)) return 'drills';
  if (/blooket/.test(t)) return 'blooket';
  if (/quiz/.test(t)) return 'quiz';
  if (/video|vid\b/.test(t)) return 'video';
  if (/math\s*practice\s*website/.test(t)) return 'drills'; // MPW hosts drills
  if (/context/.test(t)) return 'context';
  if (/poster|gallery|calendar|trading|join\s*code/.test(t)) return 'meta';
  return 'unknown';
}

export default {
  parseTopicFromTitle,
  classifyMaterial
};

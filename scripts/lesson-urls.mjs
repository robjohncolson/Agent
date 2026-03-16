#!/usr/bin/env node
// lesson-urls.mjs - Generate student-facing URLs for a lesson and copy to clipboard.
// Usage: node scripts/lesson-urls.mjs --unit 6 --lesson 4

import { execSync } from "node:child_process";
import { computeUrls, resolveDrillsLink } from "./lib/course-metadata.mjs";
import { getLesson } from "./lib/lesson-registry.mjs";

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--unit" || args[i] === "-u") && args[i + 1]) {
      unit = parseInt(args[++i], 10);
    } else if ((args[i] === "--lesson" || args[i] === "-l") && args[i + 1]) {
      lesson = parseInt(args[++i], 10);
    }
  }

  if (!unit || !lesson) {
    console.error("Usage: node scripts/lesson-urls.mjs --unit <U> --lesson <L>");
    console.error("  -u, --unit    Unit number  (required)");
    console.error("  -l, --lesson  Lesson number (required)");
    process.exit(1);
  }

  return { unit, lesson };
}

const { unit, lesson } = parseArgs(process.argv);
const computedUrls = computeUrls(unit, lesson);
const drillsLink = resolveDrillsLink(unit, lesson);

const worksheetUrl =
  computedUrls.worksheet ||
  `https://robjohncolson.github.io/apstats-live-worksheet/u${unit}_lesson${lesson}_live.html`;

let drillsUrl;
if (drillsLink.status === "resolved" || drillsLink.status === "no-manifest") {
  drillsUrl = drillsLink.url;
} else if (drillsLink.status === "no-mode") {
  drillsUrl = `${drillsLink.url}  [mode not auto-detected]`;
} else {
  drillsUrl = `[no cartridge mapped for unit ${unit}]`;
}

const quizUrl = computedUrls.quiz || "[no quiz]";

const registryEntry = getLesson(unit, lesson);
const blooketUrl =
  registryEntry?.urls?.blooket ||
  "[upload CSV to blooket.com and paste URL here]";

const output = `=== Lesson ${unit}.${lesson} URLs ===

Worksheet:  ${worksheetUrl}
Drills:     ${drillsUrl}
Quiz:       ${quizUrl}
Blooket:    ${blooketUrl}
`;

process.stdout.write(output);

try {
  execSync("clip.exe", { input: output });
  console.log("\n(Copied to clipboard)");
} catch {
  console.error("\n(Could not copy to clipboard - clip.exe not available)");
}

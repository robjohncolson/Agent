#!/usr/bin/env node
import { loadRegistry, getLesson } from "./lib/lesson-registry.mjs";
import { SCRIPTS, AGENT_ROOT } from "./lib/paths.mjs";
import { execSync } from "node:child_process";
import prompts from "prompts";

// ── ANSI helpers ────────────────────────────────────────────────────────────
const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED   = "\x1b[31m";
const CYAN  = "\x1b[36m";
const RESET = "\x1b[0m";

// ── Skip options ────────────────────────────────────────────────────────────
const SKIP_OPTIONS = [
  { title: "Skip video ingest",      value: "--skip-ingest",    statusKey: "ingest" },
  { title: "Skip render animations", value: "--skip-render",    statusKey: "animations" },
  { title: "Skip upload animations", value: "--skip-upload",    statusKey: "animations" },
  { title: "Skip Blooket upload",    value: "--skip-blooket",   statusKey: "blooketUpload" },
  { title: "Skip Schoology post",    value: "--skip-schoology", statusKey: "schoology" },
];

// ── Ctrl+C handler ──────────────────────────────────────────────────────────
const onCancel = () => { process.exit(0); };

// ── Helpers ─────────────────────────────────────────────────────────────────

function runScript(cmd) {
  try {
    execSync(cmd, { stdio: "inherit", cwd: AGENT_ROOT });
  } catch (err) {
    console.error(`\nCommand failed with exit code ${err.status}`);
  }
}

function getPreselected(unit, lesson) {
  const entry = getLesson(unit, lesson);
  if (!entry) return [];
  const indices = [];
  for (let i = 0; i < SKIP_OPTIONS.length; i++) {
    const st = entry.status?.[SKIP_OPTIONS[i].statusKey];
    if (st === "done" || st === "skipped" || st === "scraped") {
      indices.push(i);
    }
  }
  return indices;
}

function buildSkipArgs(selected) {
  return selected.map((v) => v).join(" ");
}

function formatStatus(val) {
  switch (val) {
    case "done":    return `${GREEN}✓ done${RESET}`;
    case "skipped": return `${GREEN}✓ skipped${RESET}`;
    case "scraped": return `${GREEN}✓ scraped${RESET}`;
    case "failed":  return `${RED}✗ failed${RESET}`;
    case "running": return `${YELLOW}⟳ running${RESET}`;
    case "pending": return `${YELLOW}○ pending${RESET}`;
    default:        return `${DIM}○ ${val || "pending"}${RESET}`;
  }
}

function formatLessonSummary(key, entry) {
  const status = entry.status || {};
  const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
  const doneCount = steps.filter((s) => {
    const v = status[s];
    return v === "done" || v === "skipped" || v === "scraped";
  }).length;
  const topic = entry.topic || "(no topic)";
  return `${key} — ${topic} [${doneCount}/7 done]`;
}

async function promptUnitLesson() {
  const { unit } = await prompts({
    type: "number", name: "unit",
    message: "Unit number (1-9):", min: 1, max: 9,
  }, { onCancel });
  const { lesson } = await prompts({
    type: "number", name: "lesson",
    message: "Lesson number (1-15):", min: 1, max: 15,
  }, { onCancel });
  return { unit, lesson };
}

async function showSkipToggles(unit, lesson) {
  const preselected = getPreselected(unit, lesson);
  const { skips } = await prompts({
    type: "multiselect", name: "skips",
    message: "Toggle steps to skip:",
    choices: SKIP_OPTIONS.map((opt, i) => ({
      title: opt.title, value: opt.value, selected: preselected.includes(i),
    })),
  }, { onCancel });
  return skips || [];
}

// ── Menu actions ────────────────────────────────────────────────────────────

async function prepTomorrow() {
  console.log(`\n${BOLD}Detecting tomorrow's lesson...${RESET}\n`);
  let stdout;
  try {
    stdout = execSync(`node "${SCRIPTS.whatsTomorrow}"`, {
      encoding: "utf-8", cwd: AGENT_ROOT,
    });
  } catch (err) {
    console.error(`\nFailed to run whats-tomorrow (exit ${err.status})`);
    return;
  }

  const match = stdout.match(/Topic:\s+(\d+)\.(\d+)/);
  if (!match) {
    console.log("Could not auto-detect tomorrow's lesson.");
    console.log(`${DIM}Output was:${RESET}\n${stdout}`);
    return;
  }

  const unit = parseInt(match[1], 10);
  const lesson = parseInt(match[2], 10);
  console.log(`Detected: ${CYAN}Unit ${unit}, Lesson ${lesson}${RESET}\n`);

  const entry = getLesson(unit, lesson);
  if (entry) {
    const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
    console.log(`${DIM}Current status:${RESET}`);
    for (const s of steps) {
      console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
    }
    console.log();
  }

  const skips = await showSkipToggles(unit, lesson);
  const skipStr = buildSkipArgs(skips);
  const cmd = `node scripts/lesson-prep.mjs --auto${skipStr ? " " + skipStr : ""}`;
  console.log(`\n${DIM}> ${cmd}${RESET}\n`);
  runScript(cmd);
}

async function prepSpecific() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;

  const entry = getLesson(unit, lesson);
  if (entry) {
    const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
    console.log(`\n${DIM}Current status for ${unit}.${lesson}:${RESET}`);
    for (const s of steps) {
      console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
    }
    console.log();
  }

  const skips = await showSkipToggles(unit, lesson);
  const skipStr = buildSkipArgs(skips);
  const cmd = `node scripts/lesson-prep.mjs --unit ${unit} --lesson ${lesson}${skipStr ? " " + skipStr : ""}`;
  console.log(`\n${DIM}> ${cmd}${RESET}\n`);
  runScript(cmd);
}

async function viewStatus() {
  const registry = loadRegistry();
  const keys = Object.keys(registry);
  if (keys.length === 0) {
    console.log("\nNo lessons in registry.\n");
    return;
  }

  const choices = keys.map((k) => ({
    title: formatLessonSummary(k, registry[k]),
    value: k,
  }));
  choices.push({ title: `${DIM}Back${RESET}`, value: "__back__" });

  const { selected } = await prompts({
    type: "select", name: "selected",
    message: "Select a lesson to view details:",
    choices,
  }, { onCancel });

  if (!selected || selected === "__back__") return;

  const entry = registry[selected];
  const topic = entry.topic || "(no topic)";
  const header = `Lesson ${selected} — ${topic}`;
  console.log(`\n${BOLD}${header}${RESET}`);
  console.log(`${DIM}${"─".repeat(header.length)}${RESET}`);

  const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
  for (const s of steps) {
    console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
  }

  const urls = entry.urls || {};
  const urlKeys = Object.keys(urls).filter((k) => urls[k]);
  if (urlKeys.length > 0) {
    console.log(`\n${BOLD}URLs:${RESET}`);
    for (const k of urlKeys) {
      console.log(`  ${k.padEnd(18)} ${CYAN}${urls[k]}${RESET}`);
    }
  }
  console.log();
}

async function getLessonUrls() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;
  const cmd = `node "${SCRIPTS.lessonUrls}" --unit ${unit} --lesson ${lesson}`;
  console.log(`\n${DIM}> ${cmd}${RESET}\n`);
  runScript(cmd);
}

async function runPreflight() {
  console.log(`\n${BOLD}Running preflight checks...${RESET}\n`);
  runScript("node scripts/preflight.mjs");
}

async function utilityTools() {
  while (true) {
    console.log(`\n${BOLD}Utility Tools${RESET}`);
    console.log(`${DIM}─────────────${RESET}`);

    const { action } = await prompts({
      type: "select", name: "action",
      message: "Choose a tool:",
      choices: [
        { title: "Reindex Drive videos",        value: "reindex" },
        { title: "Scrape Schoology URLs",        value: "scrape" },
        { title: "Upload Blooket set (manual)",  value: "blooket" },
        { title: "Post to Schoology (manual)",   value: "schoology" },
        { title: `${DIM}Back${RESET}`,           value: "__back__" },
      ],
    }, { onCancel });

    if (!action || action === "__back__") return;

    if (action === "reindex") {
      runScript(`node "${SCRIPTS.indexDriveVideos}"`);
    } else if (action === "scrape") {
      runScript("node scripts/scrape-schoology-urls.mjs");
    } else if (action === "blooket") {
      const { unit, lesson } = await promptUnitLesson();
      if (unit == null || lesson == null) continue;
      runScript(`node "${SCRIPTS.uploadBlooket}" --unit ${unit} --lesson ${lesson}`);
    } else if (action === "schoology") {
      const { unit, lesson } = await promptUnitLesson();
      if (unit == null || lesson == null) continue;
      runScript(`node "${SCRIPTS.postSchoology}" --unit ${unit} --lesson ${lesson}`);
    }
  }
}

// ── Main menu loop ──────────────────────────────────────────────────────────

async function main() {
  while (true) {
    console.log(`\n${BOLD}Lesson-Prep Pipeline${RESET}`);
    console.log(`${DIM}─────────────────────${RESET}`);

    const { action } = await prompts({
      type: "select", name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Prep for tomorrow (auto-detect)", value: "auto" },
        { title: "Prep specific lesson",             value: "specific" },
        { title: "View lesson status",               value: "status" },
        { title: "Get lesson URLs",                   value: "urls" },
        { title: "Run preflight check",               value: "preflight" },
        { title: "Utility tools",                     value: "utils" },
        { title: `${RED}Quit${RESET}`,                value: "quit" },
      ],
    }, { onCancel });

    if (!action || action === "quit") {
      process.exit(0);
    }

    switch (action) {
      case "auto":      await prepTomorrow(); break;
      case "specific":  await prepSpecific(); break;
      case "status":    await viewStatus(); break;
      case "urls":      await getLessonUrls(); break;
      case "preflight": await runPreflight(); break;
      case "utils":     await utilityTools(); break;
    }
  }
}

main().catch(console.error);

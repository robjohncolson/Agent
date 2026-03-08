#!/usr/bin/env node
import { loadRegistry, getLesson, getSchoologyLinks } from "./lib/lesson-registry.mjs";
import { SCRIPTS, AGENT_ROOT } from "./lib/paths.mjs";
import { execSync } from "node:child_process";
import prompts from "prompts";
import { scanCalendars } from "./lib/scan-calendars.mjs";
import chalk from "chalk";
import { formatStatus, formatLinkStatus, dashboardTable, progressBar } from "./lib/tui.mjs";

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

async function prepNextUndeveloped() {
  const calendarLessons = scanCalendars();
  const registry = loadRegistry();
  const STATUS_KEYS = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];

  const undeveloped = [];
  for (const item of calendarLessons) {
    const entry = getLesson(item.unit, item.lesson);
    if (!entry) {
      undeveloped.push({ ...item, doneCount: 0, label: "not started" });
      continue;
    }
    const doneCount = STATUS_KEYS.filter((s) => {
      const v = entry.status?.[s];
      return v === "done" || v === "skipped" || v === "scraped";
    }).length;
    if (doneCount < STATUS_KEYS.length) {
      undeveloped.push({ ...item, doneCount, label: `${doneCount}/7 done` });
    }
  }

  if (undeveloped.length === 0) {
    console.log("\nAll calendar lessons are fully prepped!\n");
    return;
  }

  console.log(`\n${chalk.bold("Undeveloped Lessons (Period B)")}`);
  console.log(chalk.dim("─".repeat(30)));

  const choices = undeveloped.map((item) => {
    const icon = item.doneCount === 0 ? "○" : "◐";
    const datePad = item.dateLabel.padEnd(6);
    const ul = `${item.unit}.${item.lesson}`.padStart(5);
    const title = item.title.length > 40 ? item.title.slice(0, 37) + "..." : item.title;
    const tag = `[${item.label}]`;
    return {
      title: `${chalk.yellow(icon)} ${datePad} ${ul}  — ${title.padEnd(42)} ${tag}`,
      value: `${item.unit}:${item.lesson}`,
    };
  });
  choices.push({ title: chalk.dim("Back"), value: "__back__" });

  const { selected } = await prompts({
    type: "select", name: "selected",
    message: "Pick a lesson to prep:",
    choices,
  }, { onCancel });

  if (!selected || selected === "__back__") return;

  const [unit, lesson] = selected.split(":").map(Number);

  const entry = getLesson(unit, lesson);
  if (entry) {
    console.log(`\n${chalk.dim(`Current status for ${unit}.${lesson}:`)}`);
    for (const s of STATUS_KEYS) {
      console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
    }
    console.log();
  }

  const skips = await showSkipToggles(unit, lesson);
  const skipStr = buildSkipArgs(skips);
  const cmd = `node scripts/lesson-prep.mjs --unit ${unit} --lesson ${lesson}${skipStr ? " " + skipStr : ""}`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
  runScript(cmd);
}

async function prepTomorrow() {
  console.log(`\n${chalk.bold("Detecting tomorrow's lesson...")}\n`);
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
    console.log(`${chalk.dim("Output was:")}\n${stdout}`);
    return;
  }

  const unit = parseInt(match[1], 10);
  const lesson = parseInt(match[2], 10);
  console.log(`Detected: ${chalk.cyan(`Unit ${unit}, Lesson ${lesson}`)}\n`);

  const entry = getLesson(unit, lesson);
  if (entry) {
    const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
    console.log(chalk.dim("Current status:"));
    for (const s of steps) {
      console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
    }
    console.log();
  }

  const skips = await showSkipToggles(unit, lesson);
  const skipStr = buildSkipArgs(skips);
  const cmd = `node scripts/lesson-prep.mjs --auto${skipStr ? " " + skipStr : ""}`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
  runScript(cmd);
}

async function prepSpecific() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;

  const entry = getLesson(unit, lesson);
  if (entry) {
    const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
    console.log(`\n${chalk.dim(`Current status for ${unit}.${lesson}:`)}`);
    for (const s of steps) {
      console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
    }
    console.log();
  }

  const skips = await showSkipToggles(unit, lesson);
  const skipStr = buildSkipArgs(skips);
  const cmd = `node scripts/lesson-prep.mjs --unit ${unit} --lesson ${lesson}${skipStr ? " " + skipStr : ""}`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
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
  choices.push({ title: chalk.dim("Back"), value: "__back__" });

  const { selected } = await prompts({
    type: "select", name: "selected",
    message: "Select a lesson to view details:",
    choices,
  }, { onCancel });

  if (!selected || selected === "__back__") return;

  const entry = registry[selected];
  const topic = entry.topic || "(no topic)";
  const header = `Lesson ${selected} — ${topic}`;
  console.log(`\n${chalk.bold(header)}`);
  console.log(chalk.dim("─".repeat(header.length)));

  const steps = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
  for (const s of steps) {
    console.log(`  ${s.padEnd(16)} ${formatStatus(entry.status?.[s])}`);
  }

  // Show per-link Schoology detail
  const scLinks = getSchoologyLinks(entry.unit, entry.lesson);
  if (scLinks) {
    console.log(`\n${chalk.bold("Schoology Links:")}`);
    for (const [linkKey, linkEntry] of Object.entries(scLinks)) {
      console.log(`  ${linkKey.padEnd(16)} ${formatLinkStatus(linkEntry)}`);
    }
  }

  const urls = entry.urls || {};
  const urlKeys = Object.keys(urls).filter((k) => urls[k]);
  if (urlKeys.length > 0) {
    console.log(`\n${chalk.bold("URLs:")}`);
    for (const k of urlKeys) {
      console.log(`  ${k.padEnd(18)} ${chalk.cyan(urls[k])}`);
    }
  }
  console.log();
}

async function showDashboard() {
  const registry = loadRegistry();
  const keys = Object.keys(registry);
  if (keys.length === 0) {
    console.log("\nNo lessons in registry.\n");
    return;
  }

  const STATUS_STEPS = ["ingest", "worksheet", "drills", "blooketCsv", "blooketUpload", "animations", "schoology"];
  const entries = keys.map((k) => {
    const e = registry[k];
    const doneCount = STATUS_STEPS.filter((s) => {
      const v = e.status?.[s];
      return v === "done" || v === "skipped" || v === "scraped";
    }).length;
    return { key: k, topic: e.topic, doneCount, totalSteps: STATUS_STEPS.length };
  });

  console.log(`\n${chalk.bold("Lesson Dashboard")}`);
  console.log(dashboardTable(entries));
  console.log();
}

async function getLessonUrls() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;
  const cmd = `node "${SCRIPTS.lessonUrls}" --unit ${unit} --lesson ${lesson}`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
  runScript(cmd);
}

async function runPreflight() {
  console.log(`\n${chalk.bold("Running preflight checks...")}\n`);
  runScript("node scripts/preflight.mjs");
}

async function healSchoologyLinks() {
  const { unit, lesson } = await promptUnitLesson();
  if (unit == null || lesson == null) return;

  const entry = getLesson(unit, lesson);
  if (!entry) {
    console.log(chalk.yellow(`\nNo registry entry for ${unit}.${lesson}. Run the pipeline first.\n`));
    return;
  }

  const cmd = `node scripts/post-to-schoology.mjs --unit ${unit} --lesson ${lesson} --auto-urls --heal --no-prompt`;
  console.log(chalk.dim(`\n> ${cmd}\n`));
  runScript(cmd);
}

async function utilityTools() {
  while (true) {
    console.log(`\n${chalk.bold("Utility Tools")}`);
    console.log(chalk.dim("─────────────"));

    const { action } = await prompts({
      type: "select", name: "action",
      message: "Choose a tool:",
      choices: [
        { title: "Reindex Drive videos",        value: "reindex" },
        { title: "Scrape Schoology URLs",        value: "scrape" },
        { title: "Upload Blooket set (manual)",  value: "blooket" },
        { title: "Post to Schoology (manual)",   value: "schoology" },
        { title: chalk.dim("Back"),              value: "__back__" },
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
    console.log(`\n${chalk.bold("Lesson-Prep Pipeline")}`);
    console.log(chalk.dim("─────────────────────"));

    const { action } = await prompts({
      type: "select", name: "action",
      message: "What would you like to do?",
      choices: [
        { title: "Prep next undeveloped",              value: "next" },
        { title: "Prep for tomorrow (auto-detect)", value: "auto" },
        { title: "Prep specific lesson",             value: "specific" },
        { title: "View lesson status",               value: "status" },
        { title: "Get lesson URLs",                   value: "urls" },
        { title: "Run preflight check",               value: "preflight" },
        { title: "Utility tools",                     value: "utils" },
        { title: "Dashboard",                         value: "dashboard" },
        { title: "Heal Schoology links",              value: "heal" },
        { title: chalk.red("Quit"),                   value: "quit" },
      ],
    }, { onCancel });

    if (!action || action === "quit") {
      process.exit(0);
    }

    switch (action) {
      case "next":      await prepNextUndeveloped(); break;
      case "auto":      await prepTomorrow(); break;
      case "specific":  await prepSpecific(); break;
      case "status":    await viewStatus(); break;
      case "urls":      await getLessonUrls(); break;
      case "preflight": await runPreflight(); break;
      case "utils":     await utilityTools(); break;
      case "dashboard": await showDashboard(); break;
      case "heal":      await healSchoologyLinks(); break;
    }
  }
}

main().catch(console.error);

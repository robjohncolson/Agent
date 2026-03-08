#!/usr/bin/env node
/**
 * tui.mjs — TUI utilities for the lesson-prep pipeline.
 * Provides spinners (ora), colorized formatters (chalk), and layout helpers.
 */

import chalk from "chalk";
import ora from "ora";

export function createSpinner(text) {
  return ora({ text, spinner: "dots" });
}

export function formatStatus(val) {
  switch (val) {
    case "done":
      return chalk.green("✓ done");
    case "skipped":
      return chalk.green("✓ skipped");
    case "scraped":
      return chalk.green("✓ scraped");
    case "failed":
      return chalk.red("✗ failed");
    case "running":
      return chalk.yellow("⟳ running");
    case "pending":
      return chalk.yellow("○ pending");
    default:
      return chalk.dim(`○ ${val || "pending"}`);
  }
}

export function formatLinkStatus(linkEntry) {
  if (!linkEntry || typeof linkEntry !== "object") {
    return chalk.dim("—");
  }

  const s = linkEntry.status;
  const ts = linkEntry.postedAt || linkEntry.attemptedAt || "";
  const time = ts ? chalk.dim(` (${ts.slice(0, 16)})`) : "";

  switch (s) {
    case "done":
      return chalk.green(`✓ posted${time}`);
    case "failed":
      return chalk.red(`✗ failed${time}`);
    case "skipped":
      return chalk.yellow("— skipped");
    default:
      return chalk.dim(`○ ${s || "unknown"}`);
  }
}

export function stepBanner(stepNum, title) {
  return chalk.bold(`=== Step ${stepNum}: ${title} ===`);
}

export function progressBar(current, total, width = 20) {
  const pct = total === 0 ? 0 : Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

export function dashboardTable(entries) {
  const header = `${chalk.bold("Lesson".padEnd(8))}${chalk.bold("Topic".padEnd(40))}${chalk.bold("Progress")}`;
  const divider = chalk.dim("─".repeat(68));
  const rows = entries.map((e) => {
    const bar = progressBar(e.doneCount, e.totalSteps);
    return `${e.key.padEnd(8)}${(e.topic || "(no topic)").slice(0, 38).padEnd(40)}${bar}`;
  });
  return [header, divider, ...rows].join("\n");
}

export function errorPanel(title, message) {
  const border = chalk.red("─".repeat(60));
  return [border, chalk.red.bold(`  ✗ ${title}`), `  ${message}`, border].join("\n");
}

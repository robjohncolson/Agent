#!/usr/bin/env node
/**
 * handoff.mjs — Gather live Agent repo state for session continuation.
 *
 * Reads state files, git status/log, and produces a structured summary
 * that Claude Code uses to generate CONTINUATION_PROMPT.md.
 *
 * Usage:
 *   node scripts/handoff.mjs              # print summary to stdout
 *   node scripts/handoff.mjs --save       # also write to CONTINUATION_PROMPT.md
 *   node scripts/handoff.mjs --json       # output raw JSON (for programmatic use)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function gatherState() {
  const session = readJSON("state/session.json");
  const queue = readJSON("state/work-queue.json");
  const registry = readJSON("state/lesson-registry.json");
  const schoology = readJSON("state/schoology-tree.json");

  // Git info
  const branch = git("branch --show-current");
  const status = git("status --short");
  const recentCommits = git("log --oneline -10");
  const lastCommit = git("log -1 --format=%H");

  // Queue stats
  let queueStats = null;
  if (queue?.actions) {
    const completed = queue.actions.filter((a) => a.status === "completed");
    const pending = queue.actions.filter((a) => a.status !== "completed");
    const completedIds = new Set(completed.map((a) => a.id));
    const unblocked = pending.filter((a) =>
      a.dependsOn.every((d) => completedIds.has(d))
    );

    const pendingByUnit = {};
    for (const a of pending) {
      const u = String(a.unit);
      pendingByUnit[u] = (pendingByUnit[u] || 0) + 1;
    }

    queueStats = {
      total: queue.actions.length,
      completed: completed.length,
      pending: pending.length,
      unblocked: unblocked.length,
      unblockedIds: unblocked.slice(0, 10).map((a) => a.id),
      pendingByUnit,
    };
  }

  // Registry stats
  let registryStats = null;
  if (registry) {
    const keys = Object.keys(registry).filter((k) => !k.startsWith("$"));
    const units = new Set(keys.map((k) => k.split(".")[0]));
    const withDrills = keys.filter((k) => registry[k]?.drillUrl);
    const withWorksheet = keys.filter(
      (k) => registry[k]?.status?.worksheet === "done"
    );
    const withBlooket = keys.filter(
      (k) => registry[k]?.status?.blooketCsv === "done"
    );
    registryStats = {
      totalLessons: keys.length,
      units: [...units].sort((a, b) => Number(a) - Number(b)),
      withDrills: withDrills.length,
      withWorksheet: withWorksheet.length,
      withBlooket: withBlooket.length,
    };
  }

  // Schoology stats
  let schoologyStats = null;
  if (schoology) {
    const courses = Object.keys(schoology);
    const courseInfo = {};
    for (const cid of courses) {
      const tree = schoology[cid];
      if (!tree || typeof tree !== "object") continue;
      const folders = Object.keys(tree).length;
      let materials = 0;
      for (const folder of Object.values(tree)) {
        if (folder?.materials) {
          materials += Object.keys(folder.materials).length;
        }
      }
      courseInfo[cid] = { folders, materials };
    }
    schoologyStats = courseInfo;
  }

  return {
    timestamp: new Date().toISOString(),
    session,
    git: { branch, status, recentCommits, lastCommit },
    queue: queueStats,
    registry: registryStats,
    schoology: schoologyStats,
  };
}

function formatMarkdown(state) {
  const lines = [];
  const ts = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });

  lines.push(`# Agent Repo — Session Handoff (${ts} EST)`);
  lines.push("");

  // Session state
  if (state.session) {
    lines.push("## Session State");
    lines.push("");
    lines.push(`- **Active task**: ${state.session.active_task || "none"}`);
    lines.push(
      `- **Last checkpoint**: ${state.session.last_checkpoint_at || "never"}`
    );
    lines.push(`- **Agent commit**: ${state.session.agent_commit || "unknown"}`);
    lines.push("");
  }

  // Git
  lines.push("## Git Status");
  lines.push("");
  lines.push(`- **Branch**: ${state.git.branch}`);
  lines.push(`- **Last commit**: ${state.git.lastCommit?.slice(0, 7)}`);
  if (state.git.status) {
    lines.push("");
    lines.push("```");
    lines.push(state.git.status);
    lines.push("```");
  }
  lines.push("");
  lines.push("### Recent Commits");
  lines.push("");
  lines.push("```");
  lines.push(state.git.recentCommits);
  lines.push("```");
  lines.push("");

  // Work queue
  if (state.queue) {
    lines.push("## Work Queue");
    lines.push("");
    lines.push(
      `- **Total**: ${state.queue.total} | **Completed**: ${state.queue.completed} | **Pending**: ${state.queue.pending}`
    );
    lines.push(`- **Unblocked (ready)**: ${state.queue.unblocked}`);
    lines.push(
      `- **Pending by unit**: ${JSON.stringify(state.queue.pendingByUnit)}`
    );
    if (state.queue.unblockedIds.length > 0) {
      lines.push("");
      lines.push("Next unblocked actions:");
      for (const id of state.queue.unblockedIds) {
        lines.push(`  - \`${id}\``);
      }
    }
    lines.push("");
  }

  // Registry
  if (state.registry) {
    lines.push("## Lesson Registry");
    lines.push("");
    lines.push(`- **Total lessons**: ${state.registry.totalLessons}`);
    lines.push(`- **Units covered**: ${state.registry.units.join(", ")}`);
    lines.push(`- **With drill URLs**: ${state.registry.withDrills}`);
    lines.push(`- **Worksheets done**: ${state.registry.withWorksheet}`);
    lines.push(`- **Blooket CSVs done**: ${state.registry.withBlooket}`);
    lines.push("");
  }

  // Schoology
  if (state.schoology) {
    lines.push("## Schoology Tree");
    lines.push("");
    for (const [cid, info] of Object.entries(state.schoology)) {
      const label =
        cid === "7945275782"
          ? "Period B"
          : cid === "7945275798"
            ? "Period E"
            : cid;
      lines.push(
        `- **${label}** (${cid}): ${info.folders} folders, ${info.materials} materials`
      );
    }
    lines.push("");
  }

  // Key paths
  lines.push("## Key Paths");
  lines.push("");
  lines.push("| File | Role |");
  lines.push("|------|------|");
  lines.push(
    "| `scripts/lesson-prep.mjs` | Pipeline orchestrator |"
  );
  lines.push(
    "| `scripts/post-to-schoology.mjs` | CDP Schoology link poster |"
  );
  lines.push("| `scripts/lib/cdp-connect.mjs` | CDP helper for Edge |");
  lines.push("| `scripts/queue-status.mjs` | Work queue status |");
  lines.push(
    "| `runner/cross-agent.py` | CC↔Codex delegation runner |"
  );
  lines.push(
    "| `config/topic-schedule.json` | Per-period topic-to-date mapping |"
  );
  lines.push("| `state/lesson-registry.json` | Lesson registry |");
  lines.push("| `state/work-queue.json` | Work queue |");
  lines.push("| `state/schoology-tree.json` | Schoology folder/material tree |");
  lines.push("");

  // Environment
  lines.push("## Environment");
  lines.push("");
  lines.push("- Windows 11 Education, no admin (ColsonR)");
  lines.push("- Edge CDP port 9222 — Schoology signed in");
  lines.push("- Node v22.19.0, Python 3.12, ManimCE v0.18.1");
  lines.push("- TLS: `NODE_TLS_REJECT_UNAUTHORIZED=0` (corporate proxy)");
  lines.push("- Schoology Period B: `7945275782`, Period E: `7945275798`");
  lines.push(
    "- lrsl-driller: `C:/Users/ColsonR/lrsl-driller` (Vercel auto-deploy)"
  );
  lines.push("");

  return lines.join("\n");
}

// --- Main ---
const args = process.argv.slice(2);
const save = args.includes("--save");
const jsonMode = args.includes("--json");

const state = gatherState();

if (jsonMode) {
  console.log(JSON.stringify(state, null, 2));
} else {
  const md = formatMarkdown(state);
  console.log(md);
  if (save) {
    writeFileSync("CONTINUATION_PROMPT.md", md + "\n");
    console.log("\n--- Saved to CONTINUATION_PROMPT.md ---");
  }
}

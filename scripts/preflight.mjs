#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import {
  PYTHON,
  FFMPEG_DIR,
  MIKTEX_DIR,
  EDGE_PATH,
  WORKSHEET_REPO,
  DRILLER_REPO,
  CURRICULUM_REPO,
} from "./lib/paths.mjs";

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";
const USE_COLOR = Boolean(process.stdout.isTTY);

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

const counts = {
  OK: 0,
  WARN: 0,
  FAIL: 0,
};

function toDisplayPath(value) {
  return String(value).replace(/\\/g, "/");
}

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function quoteArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function runCommand(command) {
  return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
}

function findExecutable(binaryName) {
  try {
    const output = runCommand(`${WHICH_CMD} ${binaryName}`);
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || "";
  } catch {
    return "";
  }
}

function isDirectory(dirPath) {
  if (!dirPath || !existsSync(dirPath)) return false;
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function statusTag(status) {
  const padded = status.padEnd(4);
  if (!USE_COLOR) {
    return `[${padded}]`;
  }

  const color =
    status === "OK" ? ANSI.green : status === "WARN" ? ANSI.yellow : ANSI.red;
  return `[${color}${padded}${ANSI.reset}]`;
}

function printResult(status, message) {
  counts[status] += 1;
  console.log(`  ${statusTag(status)} ${message}`);
}

function checkCommandVersion(command) {
  try {
    runCommand(command);
    return true;
  } catch {
    return false;
  }
}

function resolveBinaryInDir(dirPath, binaryName) {
  const names = IS_WIN
    ? [`${binaryName}.exe`, `${binaryName}.cmd`, `${binaryName}.bat`]
    : [binaryName];

  for (const name of names) {
    const full = path.join(dirPath, name);
    if (existsSync(full)) return full;
  }

  return path.join(dirPath, IS_WIN ? `${binaryName}.exe` : binaryName);
}

function reportToolFromExecutable(label, executablePath, versionArgs = "--version") {
  const command = `${quoteArg(executablePath)} ${versionArgs}`;
  const ok = checkCommandVersion(command);
  if (ok) {
    printResult("OK", `${label}: ${toDisplayPath(executablePath)}`);
  } else {
    printResult("FAIL", `${label}: ${toDisplayPath(executablePath)} (not runnable)`);
  }
}

function checkNodeTool() {
  printResult("OK", `Node.js ${process.version}`);
}

function checkPythonTool() {
  const configured = safeTrim(PYTHON);
  let pythonExec = configured;

  if (!pythonExec) {
    pythonExec = findExecutable("python");
  }

  if (!pythonExec) {
    printResult("FAIL", "Python: not found");
    return;
  }

  let displayPath = pythonExec;
  if (!/[\\/]/.test(pythonExec)) {
    const resolved = findExecutable(pythonExec);
    if (resolved) displayPath = resolved;
  }

  const command = `${quoteArg(pythonExec)} --version`;
  if (checkCommandVersion(command)) {
    printResult("OK", `Python: ${toDisplayPath(displayPath)}`);
  } else {
    printResult("FAIL", `Python: ${toDisplayPath(displayPath)} (not runnable)`);
  }
}

function checkToolDir({
  label,
  configuredDir,
  binaryName,
  versionArgs = "--version",
}) {
  let toolDir = safeTrim(configuredDir);

  if (!toolDir) {
    const resolved = findExecutable(binaryName);
    if (resolved) {
      toolDir = path.dirname(resolved);
    }
  }

  if (!toolDir) {
    printResult("FAIL", `${label}: not found`);
    return;
  }

  const executablePath = resolveBinaryInDir(toolDir, binaryName);
  reportToolFromExecutable(label, executablePath, versionArgs);
}

function checkCodexCli() {
  const whereCodex = findExecutable("codex");
  if (whereCodex) {
    reportToolFromExecutable("Codex CLI", whereCodex, "--version");
    return;
  }

  const appData = safeTrim(process.env.APPDATA);
  const fallbackJs = appData
    ? path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
    : "";

  if (fallbackJs && existsSync(fallbackJs)) {
    const ok = checkCommandVersion(`node ${quoteArg(fallbackJs)} --version`);
    if (ok) {
      printResult("OK", `Codex CLI: ${toDisplayPath(fallbackJs)}`);
    } else {
      printResult("FAIL", `Codex CLI: ${toDisplayPath(fallbackJs)} (not runnable)`);
    }
    return;
  }

  printResult("FAIL", "Codex CLI: not found");
}

async function checkPlaywrightTool() {
  try {
    await import("playwright");
    printResult("OK", "Playwright: installed");
  } catch {
    printResult("FAIL", "Playwright: not installed (run: npm install playwright)");
  }
}

function checkEdgeTool() {
  const edge = safeTrim(EDGE_PATH);
  if (!edge) {
    printResult("FAIL", "Edge: path not configured");
    return;
  }

  if (existsSync(edge)) {
    printResult("OK", `Edge: ${toDisplayPath(edge)}`);
  } else {
    printResult("FAIL", `Edge: ${toDisplayPath(edge)} (not found)`);
  }
}

function checkRepo(name, repoPath) {
  const repo = safeTrim(repoPath);
  if (!repo) {
    printResult("FAIL", `${name}: path not configured`);
    return;
  }

  const gitDir = path.join(repo, ".git");
  if (isDirectory(repo) && isDirectory(gitDir)) {
    printResult("OK", `${name}: ${toDisplayPath(repo)}`);
  } else if (!isDirectory(repo)) {
    printResult("FAIL", `${name}: ${toDisplayPath(repo)} (missing directory)`);
  } else {
    printResult("FAIL", `${name}: ${toDisplayPath(repo)} (missing .git)`);
  }
}

function fetchCdpTabs() {
  return new Promise((resolve, reject) => {
    const req = http.get("http://localhost:9222/json", (res) => {
      if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
        res.resume();
        reject(new Error(`CDP HTTP ${res.statusCode}`));
        return;
      }

      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const tabs = JSON.parse(data);
          if (!Array.isArray(tabs)) {
            reject(new Error("Invalid CDP response"));
            return;
          }
          resolve(tabs);
        } catch {
          reject(new Error("Invalid CDP response"));
        }
      });
    });

    req.setTimeout(2000, () => {
      req.destroy(new Error("CDP request timeout"));
    });
    req.on("error", reject);
  });
}

function hasMatchingTab(tabs, matcher) {
  return tabs.some((tab) => {
    const url = safeTrim(tab?.url).toLowerCase();
    const title = safeTrim(tab?.title).toLowerCase();
    return matcher({ url, title });
  });
}

async function checkBrowserSessions() {
  let tabs;
  try {
    tabs = await fetchCdpTabs();
    printResult("OK", "Edge DevTools protocol accessible");
  } catch {
    printResult("FAIL", "Edge not running with --remote-debugging-port=9222");
    return;
  }

  const schoologyOk = hasMatchingTab(tabs, ({ url }) => url.includes("schoology.com"));
  if (schoologyOk) {
    printResult("OK", "Schoology: signed in");
  } else {
    printResult("WARN", "Schoology: not signed in (navigate to lynnschools.schoology.com)");
  }

  const blooketOk = hasMatchingTab(tabs, ({ url }) => {
    if (!url.includes("blooket.com")) return false;
    return !/(\/(login|signup|register)([/?#]|$)|accounts\.blooket\.com)/i.test(url);
  });
  if (blooketOk) {
    printResult("OK", "Blooket: signed in");
  } else {
    printResult("WARN", "Blooket: not signed in");
  }

  const aiStudioOk = hasMatchingTab(tabs, ({ url }) => url.includes("aistudio.google.com"));
  if (aiStudioOk) {
    printResult("OK", "AI Studio: signed in");
  } else {
    printResult("WARN", "AI Studio: not signed in");
  }
}

async function main() {
  console.log("=== Pipeline Preflight Check ===\n");

  console.log("[Tools]");
  checkNodeTool();
  checkPythonTool();
  checkToolDir({ label: "FFmpeg", configuredDir: FFMPEG_DIR, binaryName: "ffmpeg", versionArgs: "-version" });
  checkToolDir({ label: "MiKTeX", configuredDir: MIKTEX_DIR, binaryName: "pdflatex", versionArgs: "--version" });
  checkCodexCli();
  await checkPlaywrightTool();
  checkEdgeTool();

  console.log("\n[Repos]");
  checkRepo("apstats-live-worksheet", WORKSHEET_REPO);
  checkRepo("lrsl-driller", DRILLER_REPO);
  checkRepo("curriculum_render", CURRICULUM_REPO);

  console.log("\n[Browser (CDP port 9222)]");
  await checkBrowserSessions();

  console.log(`\nSummary: ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL`);
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
}

main().catch((error) => {
  printResult("FAIL", `Unexpected error: ${error.message}`);
  console.log(`\nSummary: ${counts.OK} OK, ${counts.WARN} WARN, ${counts.FAIL} FAIL`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * verify-paths.mjs — Check that all exported paths from paths.mjs resolve.
 * Usage: node scripts/verify-paths.mjs
 */

import { existsSync } from "node:fs";
import * as P from "./lib/paths.mjs";

const checks = [
  ["AGENT_ROOT",          P.AGENT_ROOT],
  ["WORKSHEET_REPO",      P.WORKSHEET_REPO],
  ["DRILLER_REPO",        P.DRILLER_REPO],
  ["CURRICULUM_REPO",     P.CURRICULUM_REPO],
  ["CONFIG_DIR",          P.CONFIG_DIR],
  ["CARTRIDGES_DIR",      P.CARTRIDGES_DIR],
  ["PYTHON",              P.PYTHON],
  ["FFMPEG_DIR",          P.FFMPEG_DIR],
  ["MIKTEX_DIR",          P.MIKTEX_DIR],
  ["EDGE_PATH",           P.EDGE_PATH],
  ["EDGE_DEBUG_PROFILE",  P.EDGE_DEBUG_PROFILE],
  ["UNITS_JS_PATH",       P.UNITS_JS_PATH],
];

let ok = 0;
let warn = 0;

for (const [name, value] of checks) {
  const exists = value && existsSync(value);
  const status = exists ? "OK  " : "WARN";
  console.log(`  ${status} ${name.padEnd(22)} ${value}`);
  if (exists) ok++; else warn++;
}

console.log(`\n${ok} OK, ${warn} WARN`);

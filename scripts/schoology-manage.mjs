#!/usr/bin/env node
/**
 * schoology-manage.mjs — Schoology folder structure management CLI via CDP.
 *
 * Commands:
 *   list [--in <folder>] [--recursive]              List folders and links
 *   tree [--depth <n>]                              Recursive folder tree
 *   create-folder <name> [--in <parent>] [--color]  Create a folder
 *   move-folder <name> --into <target> [--from <parent>]  Move a folder
 *   post-link <title> <url> --in <folder>           Post a link material
 *
 * Examples:
 *   node scripts/schoology-manage.mjs list
 *   node scripts/schoology-manage.mjs list --in "work-ahead/future"
 *   node scripts/schoology-manage.mjs list --recursive
 *   node scripts/schoology-manage.mjs tree --depth 2
 *   node scripts/schoology-manage.mjs create-folder "Week 26" --color green
 *   node scripts/schoology-manage.mjs create-folder "Friday 3/27/26" --in "work-ahead/future"
 *   node scripts/schoology-manage.mjs move-folder "week 25" --into "work-ahead/future"
 *   node scripts/schoology-manage.mjs move-folder "Thursday 3/19/26" --into "work-ahead/future" --from "week 25"
 *   node scripts/schoology-manage.mjs post-link "Worksheet — 7.2" "https://..." --in "Friday 3/20/26"
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { cmdList, cmdTree } from "./lib/schoology-commands-list.mjs";
import { cmdCreateFolder } from "./lib/schoology-commands-create.mjs";
import { cmdMoveFolder } from "./lib/schoology-commands-move.mjs";
import { cmdPostLink } from "./lib/schoology-commands-postlink.mjs";
import { VALID_COLORS } from "./lib/schoology-dom.mjs";

const COURSE_ID = "7945275782";

// ── Arg helpers ──────────────────────────────────────────────────────────────

function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  return args[idx + 1] || null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printUsage() {
  console.error(`
Schoology Folder Manager — CLI

Usage: node scripts/schoology-manage.mjs <command> [options]

Commands:
  list [--in <folder>] [--recursive]
    List folders and links at a given level.

  tree [--depth <n>]
    Show full recursive folder tree with box-drawing characters.

  create-folder <name> [--in <parent>] [--color <color>]
    Create a folder. Colors: ${VALID_COLORS.join(", ")}

  move-folder <name> --into <target> [--from <parent>]
    Move a folder into another folder.

  post-link <title> <url> --in <folder>
    Post a link material into a folder.

Folder references can be names or numeric IDs.
`.trim());
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  try {
    switch (command) {
      case "list": {
        const inFolder = getFlag(args, "--in");
        const recursive = hasFlag(args, "--recursive");
        await cmdList(page, COURSE_ID, { inFolder, recursive });
        break;
      }

      case "tree": {
        const depthStr = getFlag(args, "--depth");
        const depth = depthStr ? parseInt(depthStr, 10) : Infinity;
        await cmdTree(page, COURSE_ID, { depth });
        break;
      }

      case "create-folder": {
        const name = args[1];
        if (!name || name.startsWith("--")) {
          console.error('Usage: create-folder <name> [--in <parent>] [--color <color>]');
          process.exit(1);
        }
        const inFolder = getFlag(args, "--in");
        const color = getFlag(args, "--color");
        console.log(`\nCreating folder: "${name}"${inFolder ? ` in "${inFolder}"` : ""}${color ? ` (${color})` : ""}...\n`);
        await cmdCreateFolder(page, COURSE_ID, { name, inFolder, color });
        break;
      }

      case "move-folder": {
        const name = args[1];
        const into = getFlag(args, "--into");
        const from = getFlag(args, "--from");
        if (!name || name.startsWith("--") || !into) {
          console.error('Usage: move-folder <name> --into <target> [--from <parent>]');
          process.exit(1);
        }
        console.log(`\nMoving "${name}" into "${into}"${from ? ` (from "${from}")` : ""}...\n`);
        await cmdMoveFolder(page, COURSE_ID, { name, into, from });
        break;
      }

      case "post-link": {
        const title = args[1];
        const url = args[2];
        const inFolder = getFlag(args, "--in");
        if (!title || !url || title.startsWith("--") || !inFolder) {
          console.error('Usage: post-link <title> <url> --in <folder>');
          process.exit(1);
        }
        console.log(`\nPosting link: "${title}" into "${inFolder}"...\n`);
        await cmdPostLink(page, COURSE_ID, { title, url, inFolder });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    console.log("\nDisconnecting from browser (CDP). Browser remains open.");
    await browser?.close().catch(() => {});
  }
}

main().catch(e => { console.error(e); process.exit(1); });

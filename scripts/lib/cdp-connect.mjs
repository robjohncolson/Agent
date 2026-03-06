/**
 * cdp-connect.mjs — Shared CDP connection utility for all Playwright CDP scripts.
 *
 * Checks if port 9222 is listening, auto-launches Edge if not, then connects
 * via chromium.connectOverCDP and returns { browser, page }.
 *
 * Usage:
 *   import { connectCDP } from "./lib/cdp-connect.mjs";
 *   const { browser, page } = await connectCDP(chromium, { preferUrl: "aistudio" });
 */

import { spawn } from "node:child_process";
import net from "node:net";

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const USER_DATA_DIR = "C:\\Users\\ColsonR\\.edge-debug-profile";
const LAUNCH_WAIT_SECONDS = 10;

/**
 * Check if a TCP port is listening by attempting a connection.
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Connect to a browser via Chrome DevTools Protocol on port 9222.
 *
 * If nothing is listening on port 9222, attempts to launch Edge with
 * --remote-debugging-port=9222 and waits up to 10 seconds for it to start.
 *
 * @param {object} chromium - The Playwright chromium object (from `import("playwright").then(pw => pw.chromium)`)
 * @param {object} [options]
 * @param {string|null} [options.preferUrl=null] - If provided, try to find an existing tab whose URL contains this string.
 * @returns {Promise<{browser: object, page: object}>}
 */
export async function connectCDP(chromium, { preferUrl = null } = {}) {
  let isListening = await checkPort(CDP_PORT);

  if (!isListening) {
    console.log("No browser with debugging found on port 9222.");
    console.log("Launching Edge with remote debugging...");

    try {
      const child = spawn(
        EDGE_PATH,
        [
          `--remote-debugging-port=${CDP_PORT}`,
          `--user-data-dir=${USER_DATA_DIR}`,
        ],
        { detached: true, stdio: "ignore" }
      );
      child.unref();
    } catch (err) {
      console.error(`Failed to launch Edge: ${err.message}`);
      console.error(`\nPlease start Edge manually with remote debugging:\n`);
      console.error(`  "${EDGE_PATH}" --remote-debugging-port=${CDP_PORT}\n`);
      console.error(`Or run the helper script:\n`);
      console.error(`  scripts\\start-edge-debug.cmd\n`);
      process.exit(1);
    }

    // Wait for the port to become available
    for (let i = 0; i < LAUNCH_WAIT_SECONDS; i++) {
      await sleep(1000);
      isListening = await checkPort(CDP_PORT);
      if (isListening) {
        console.log(`Edge is ready (took ${i + 1}s).`);
        break;
      }
    }

    if (!isListening) {
      console.error(`\nEdge did not start within ${LAUNCH_WAIT_SECONDS} seconds.`);
      console.error(`Please start Edge manually with remote debugging:\n`);
      console.error(`  "${EDGE_PATH}" --remote-debugging-port=${CDP_PORT}\n`);
      console.error(`Or run the helper script:\n`);
      console.error(`  scripts\\start-edge-debug.cmd\n`);
      process.exit(1);
    }
  }

  // Verify CDP is responding with version info
  try {
    const response = await fetch(`${CDP_URL}/json/version`);
    if (response.ok) {
      const info = await response.json();
      console.log(`CDP: Found browser — ${info.Browser || "unknown"}`);
    }
  } catch {
    console.error("CDP port is open but /json/version did not respond.");
    console.error("The process on port 9222 may not be a Chromium-based browser.");
    process.exit(1);
  }

  // Connect via Playwright
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    console.error("CDP: Connected but no browser contexts found.");
    process.exit(1);
  }

  const context = contexts[0];
  const pages = context.pages();

  // Try to find a tab matching the preferred URL pattern
  let page = null;
  if (preferUrl) {
    page = pages.find((p) => p.url().includes(preferUrl));
  }
  if (!page) {
    page = pages[0];
  }
  if (!page) {
    page = await context.newPage();
  }

  console.log(`CDP: Connected. Using page: ${page.url()}`);
  return { browser, page };
}

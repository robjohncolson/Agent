#!/usr/bin/env node
/**
 * aistudio-ingest.mjs — Automate Google AI Studio video transcription via Playwright
 *
 * Connects to an already-running browser via Chrome DevTools Protocol (CDP) so the
 * user's Google session is available. CDP is the only supported connection mode
 * (required on this school machine).
 *
 * Default model: Gemini 3.1 Pro (zero API quota — web UI only).
 *
 * Usage:
 *   node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 \
 *     --drive-ids "1JE4_U3BNx90g66fasqu1yRNgslGkpwaI" "1_C9FAHoG_78nqXAcBh-REYx7a79zC7Cl"
 *
 *   node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 \
 *     --files "./u6/videos/6-5-1.mp4" "./u6/videos/6-5-2.mp4"
 *
 * Start Edge with remote debugging first:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 */

import fs from "fs";
import path from "path";
import { connectCDP } from "./lib/cdp-connect.mjs";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Constants ────────────────────────────────────────────────────────────────

const AI_STUDIO_URL = "https://aistudio.google.com/prompts/new_chat";
const OUTPUT_BASE = "C:/Users/ColsonR/apstats-live-worksheet";

const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max per response
const POLL_INTERVAL_MS = 2000;               // check every 2s

const PROMPTS = {
  transcription: `Transcribe this video with timestamps. Format each segment as:

**[MM:SS]** <transcribed text>

Include all spoken content. Be thorough and accurate.`,

  slides: `Describe each slide or visual change in this video with timestamps. Format as:

**[MM:SS]** — **Slide title or topic**
<Description of what's shown: text, formulas, graphs, diagrams, examples, key definitions>

Be thorough — capture all text on each slide, any formulas, graph labels, and visual details that a student would need to follow along.`,
};

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let unit = null;
  let lesson = null;
  const driveIds = [];
  const files = [];
  let dryRun = false;
  let model = "Gemini 3.1 Pro";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--unit" || arg === "-u") {
      unit = args[++i];
    } else if (arg === "--lesson" || arg === "-l") {
      lesson = args[++i];
    } else if (arg === "--drive-ids") {
      i++;
      while (i < args.length && !args[i].startsWith("-")) {
        driveIds.push(args[i]);
        i++;
      }
      i--; // back up for the for-loop increment
    } else if (arg === "--files") {
      i++;
      while (i < args.length && !args[i].startsWith("-")) {
        files.push(args[i]);
        i++;
      }
      i--;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--model") {
      model = args[++i];
    }
  }

  if (!unit || !lesson) {
    console.error(
      "Usage: node scripts/aistudio-ingest.mjs --unit <U> --lesson <L> [options]\n\n" +
        "Options:\n" +
        "  -u, --unit        Unit number (required)\n" +
        "  -l, --lesson      Lesson number (required)\n" +
        "  --drive-ids       Space-separated Google Drive file IDs\n" +
        "  --files           Space-separated local video file paths\n" +
        "  --model           AI Studio model name (default: \"Gemini 3.1 Pro\")\n" +
        "  --dry-run         Open browser but don't submit prompts\n\n" +
        "Connects via CDP to an already-running browser (start with scripts/start-edge-debug.cmd).\n" +
        "Default model is Gemini 3.1 Pro (zero API quota, web UI only).\n"
    );
    process.exit(1);
  }

  if (driveIds.length === 0 && files.length === 0) {
    console.error("Error: provide at least one --drive-ids or --files argument.");
    process.exit(1);
  }

  return { unit, lesson, driveIds, files, dryRun, model };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function outputPath(unit, lesson, videoNum, suffix) {
  const dir = path.join(OUTPUT_BASE, `u${unit}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `apstat_${unit}-${lesson}-${videoNum}_${suffix}.txt`);
}

/**
 * Wait for AI Studio's response to finish streaming.
 *
 * Strategy:
 *   1. Wait for a model response container to appear.
 *   2. Poll the text content length until a substantial response appears (>500 chars).
 *   3. Also check for the reappearance of the send button / disappearance of stop button.
 *   4. Hard timeout at RESPONSE_TIMEOUT_MS.
 */
async function waitForResponse(page, turnCountBefore = 0) {
  console.log("    Waiting for response to complete...");

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

  // Step 1: Wait for a MODEL response turn to appear
  // User turns contain "User" text, model turns contain "Model" text
  console.log(`    Watching for model response turn...`);

  // Track the total text length in the chat before submission
  const chatTextBefore = await page.evaluate(() => {
    const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
    let total = 0;
    for (const turn of turns) total += turn.innerText.length;
    return total;
  }).catch(() => 0);

  let responseReady = false;
  const turnDeadline = Date.now() + 300000; // 5 min
  const startTime = Date.now();

  while (Date.now() < turnDeadline) {
    // Check if model is still generating (Stop button visible)
    const status = await page.evaluate((prevCount) => {
      const btn = document.querySelector("button.ctrl-enter-submits");
      const isGenerating = btn && btn.innerText.includes("Stop");

      const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
      const totalTurns = turns.length;

      // Get the LAST turn's length (the most recent response)
      let lastTurnLen = 0;
      if (turns.length > 0) {
        lastTurnLen = turns[turns.length - 1].innerText.length;
      }

      return { isGenerating, lastTurnLen, totalTurns };
    }, turnCountBefore).catch(() => ({ isGenerating: false, lastTurnLen: 0, totalTurns: 0 }));

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Response is ready when: not generating AND the last turn has substantial content
    // AND there are more turns than before (a new response appeared)
    if (!status.isGenerating && status.lastTurnLen > 500 && status.totalTurns > turnCountBefore) {
      process.stdout.write("\n");
      console.log(`    Model response complete. (${status.lastTurnLen} chars, ${elapsed}s)`);
      responseReady = true;
      break;
    }

    if (status.isGenerating) {
      process.stdout.write(`\r    Gemini is generating... ${elapsed}s (${status.lastTurnLen} chars so far)`);
    } else if (status.totalTurns <= turnCountBefore) {
      process.stdout.write(`\r    Waiting for new response turn... ${elapsed}s`);
    } else if (status.lastTurnLen < 500) {
      process.stdout.write(`\r    Waiting for substantial response... ${elapsed}s`);
    }

    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  if (!responseReady) {
    process.stdout.write("\n");
    console.log("    WARNING: Response may not be complete. Check the browser.");
    console.log("    Press Enter when the response is ready...");
    await waitForUserInput();
  }

  // Step 2: Find the LAST turn (the most recent model response)
  let responseEl = null;
  const selectorDeadline = Date.now() + 30_000;

  while (!responseEl && Date.now() < selectorDeadline) {
    try {
      const turnHandle = await page.evaluateHandle(() => {
        const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
        // Return the last turn — the most recent response
        let bestTurn = null;
        let bestLen = 0;
        // Take the last turn that has substantial content
        for (let i = turns.length - 1; i >= 0; i--) {
          const len = turns[i].innerText.length;
          if (len > 100) {
            bestTurn = turns[i];
            bestLen = len;
            bestTurn = turn;
          }
        }
        return bestTurn;
      });

      if (turnHandle && await turnHandle.evaluate(el => el !== null).catch(() => false)) {
        responseEl = turnHandle.asElement();
        const len = await responseEl.evaluate(el => el.innerText.length);
        console.log(`    Found response turn (${len} chars).`);
      }
    } catch {
      // retry
    }

    if (!responseEl) {
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }

  if (!responseEl) {
    console.log("    WARNING: Could not find response container via known selectors.");
    console.log("    Falling back to waiting for send button to reappear...");
  }

  // Response is already confirmed complete by Step 1. Extract the text now.
  if (responseEl) {
    try {
      const text = await responseEl.innerText();
      const lines = text.split("\n").length;
      console.log(`    Extracted ${lines} lines, ${text.length} chars.`);
      return text;
    } catch (e) {
      console.log(`    Error extracting from turn element: ${e.message}`);
    }
  }

  // Fallback: extract via evaluate
  const fallbackText = await page.evaluate(() => {
    const turns = document.querySelectorAll("ms-chat-turn, .chat-turn");
    let best = "";
    for (const turn of turns) {
      if (turn.innerText.length > best.length) best = turn.innerText;
    }
    return best;
  }).catch(() => "");

  if (fallbackText.length > 50) {
    const lines = fallbackText.split("\n").length;
    console.log(`    Extracted via fallback: ${lines} lines, ${fallbackText.length} chars.`);
    return fallbackText;
  }

  console.log("    WARNING: Could not extract response text.");
  return "";
}

/**
 * Type text into the AI Studio prompt input and submit.
 */
async function typeAndSubmit(page, promptText) {
  // Find the prompt input area — try several selectors
  const inputSelectors = [
    'textarea[aria-label="Type something"]',
    'textarea[aria-label="Enter a prompt"]',
    "textarea.prompt-input",
    'div[contenteditable="true"]',
    'textarea[placeholder*="Type"]',
    'textarea[placeholder*="Enter"]',
    "textarea",
    ".ql-editor",
    'div[role="textbox"]',
  ];

  let inputEl = null;
  for (const sel of inputSelectors) {
    try {
      inputEl = await page.$(sel);
      if (inputEl) {
        console.log(`    Found input element: ${sel}`);
        break;
      }
    } catch {
      // try next
    }
  }

  if (!inputEl) {
    throw new Error("Could not find prompt input element. AI Studio UI may have changed.");
  }

  // Click to focus the textarea
  await inputEl.click();
  await page.waitForTimeout(500);

  // Type the prompt using keyboard (triggers Angular change detection properly)
  // Use clipboard paste for speed — typing char by char is too slow
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, promptText).catch(() => {});

  // Paste via Ctrl+V
  await page.keyboard.down("Control");
  await page.keyboard.press("v");
  await page.keyboard.up("Control");
  await page.waitForTimeout(1000);

  // Verify the prompt was entered
  const enteredText = await inputEl.evaluate(el => el.value || el.innerText).catch(() => "");
  if (enteredText.length < 20) {
    // Clipboard paste didn't work — try fill() as fallback
    console.log("    Clipboard paste didn't work, trying fill()...");
    await inputEl.fill(promptText);
    await page.waitForTimeout(500);
  }

  console.log(`    Prompt entered (${enteredText.length} chars). Submitting with Ctrl+Enter...`);

  // Submit using Ctrl+Enter — the keyboard shortcut shown on AI Studio's Run button
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");

  await page.waitForTimeout(1000);
}

/**
 * Wait for media (video) to finish processing after attachment.
 * AI Studio shows a processing state while uploading/analyzing the video.
 * The Run button is not clickable until processing is complete.
 */
async function waitForMediaReady(page) {
  const maxWait = 180000; // 3 minutes — videos can take a while
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const status = await page.evaluate(() => {
      // Check for any loading/processing indicators
      const spinners = document.querySelectorAll(
        '[class*="spinner"], [class*="loading"], [class*="progress"], ' +
        '[class*="processing"], [class*="uploading"], mat-spinner, ' +
        'mat-progress-bar, mat-progress-spinner, [role="progressbar"]'
      );
      let hasSpinner = false;
      for (const s of spinners) {
        if (s.offsetParent !== null && s.offsetWidth > 0) {
          hasSpinner = true;
          break;
        }
      }

      // Check the Run/Add button state (button text changes: "Add" when empty, "Run" with prompt)
      const allBtns = document.querySelectorAll('button');
      let runBtnEnabled = false;
      for (const btn of allBtns) {
        if (btn.classList.contains('ctrl-enter-submits')) {
          runBtnEnabled = !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
          break;
        }
      }

      // Check for media chip/thumbnail that indicates processing complete
      const mediaChips = document.querySelectorAll(
        '[class*="media-chip"], [class*="file-chip"], [class*="video-preview"], ' +
        '[class*="attachment"], [class*="thumb"]'
      );
      let hasMediaChip = mediaChips.length > 0;

      return { hasSpinner, runBtnEnabled, hasMediaChip };
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Require at least 10 seconds of wait — video processing takes time
    if (!status.hasSpinner && status.runBtnEnabled && elapsed >= 10) {
      console.log(`    Video ready! (${elapsed}s)`);
      return;
    }

    if (status.hasSpinner) {
      process.stdout.write(`\r    Processing video... ${elapsed}s`);
    } else if (!status.runBtnEnabled) {
      process.stdout.write(`\r    Waiting for Run button to enable... ${elapsed}s`);
    }

    await page.waitForTimeout(pollInterval);
  }

  process.stdout.write("\n");
  console.log("    WARNING: Media processing timed out. Attempting to continue anyway...");
}

/**
 * Look up the filename for a Drive ID from the video index.
 */
function getFilenameForDriveId(driveId) {
  const indexPath = "C:/Users/ColsonR/Agent/config/drive-video-index.json";
  try {
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      const match = index.videos.find(v => v.file_id === driveId);
      if (match) return match.filename;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Attach a file from Google Drive via the native Drive picker in AI Studio.
 *
 * Strategy:
 * 1. Click paperclip → "Google Drive" to open the picker
 * 2. Access the picker iframe via page.frames() (CDP allows cross-origin)
 * 3. Search for the file by name in the picker
 * 4. Click the result and confirm selection
 * 5. Falls back to manual picker if automation fails
 */
async function attachDriveFile(page, driveId) {
  console.log(`    Attaching Drive file: ${driveId}`);
  const filename = getFilenameForDriveId(driveId);
  if (filename) console.log(`    Filename: ${filename}`);

  // Step 1: Click paperclip / attach button
  const attachSelectors = [
    'button[aria-label*="Insert images"]',
    'button[aria-label*="Add"]',
    'button[aria-label*="file"]',
    'button[aria-label*="Upload"]',
    'button[aria-label*="Attach"]',
    'button[aria-label*="Insert"]',
    'button[aria-label*="media"]',
  ];

  let clicked = false;
  for (const sel of attachSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        console.log(`    Clicked attach button.`);
        clicked = true;
        await page.waitForTimeout(1500);
        break;
      }
    } catch { /* try next */ }
  }

  if (!clicked) {
    const allButtons = await page.$$("button");
    for (const btn of allButtons) {
      try {
        const label = (await btn.getAttribute("aria-label") || "").toLowerCase();
        const tooltip = (await btn.getAttribute("mattooltip") || "").toLowerCase();
        if (label.includes("insert") || label.includes("media") || label.includes("add") ||
            tooltip.includes("file") || tooltip.includes("media")) {
          await btn.click();
          console.log(`    Clicked attach button (broad match).`);
          clicked = true;
          await page.waitForTimeout(1500);
          break;
        }
      } catch { /* continue */ }
    }
  }

  // Step 2: Click "Google Drive" option
  if (clicked) {
    const menuItems = await page.$$("button, a, li, div[role='menuitem'], mat-option, span[role='menuitem']");
    for (const item of menuItems) {
      try {
        const text = (await item.innerText() || "").toLowerCase();
        if (text.includes("drive") && text.length < 30) {
          await item.click();
          console.log(`    Clicked "Google Drive" option.`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch { /* continue */ }
    }
  }

  // Step 3: Find and interact with the Drive picker iframe
  let pickerAutomated = false;
  // Use the full filename for exact matching — stripping only "Copy of" prefix
  // Keep the .mp4 extension to make the search more specific and avoid fuzzy mismatches
  const searchName = filename ? filename.replace(/^Copy of (Copy of )?/i, "") : null;

  if (searchName) {
    console.log(`    Searching picker for: "${searchName}"`);

    // Wait for picker iframe to appear
    await page.waitForTimeout(2000);

    // Try accessing picker frames
    const frames = page.frames();
    for (const frame of frames) {
      const url = frame.url();
      if (!url.includes("picker") && !url.includes("drive")) continue;

      try {
        // Look for search input in the picker
        const searchInput = await frame.$('input[type="text"], input[aria-label*="Search"], input[placeholder*="Search"]');
        if (searchInput) {
          console.log(`    Found picker search box.`);
          await searchInput.click();
          await searchInput.fill(searchName);
          await frame.waitForTimeout(2000);

          // Press Enter to search
          await searchInput.press("Enter");
          await frame.waitForTimeout(3000);

          // Click the first result
          const resultSelectors = [
            'div[data-id]',
            'tr[data-id]',
            '.picker-item',
            '.a-s-zd-qa',
            '[role="option"]',
            '[role="gridcell"]',
          ];

          for (const sel of resultSelectors) {
            const results = await frame.$$(sel);
            if (results.length > 0) {
              // Verify the first result matches our expected filename
              let bestResult = results[0];
              const expectedBase = searchName.replace(/\.mp4$/i, "");

              for (const r of results) {
                const rText = (await r.innerText().catch(() => "")).toLowerCase();
                if (rText.includes(expectedBase.toLowerCase())) {
                  bestResult = r;
                  console.log(`    Verified match: "${rText.substring(0, 60)}"`);
                  break;
                }
              }

              await bestResult.click();
              console.log(`    Selected file in picker.`);
              await frame.waitForTimeout(1000);

              // Double-click or click Select/Insert button
              const selectBtns = await frame.$$('button');
              for (const btn of selectBtns) {
                const text = (await btn.innerText().catch(() => "")).toLowerCase();
                if (text.includes("select") || text.includes("insert") || text.includes("open")) {
                  await btn.click();
                  console.log(`    Confirmed selection.`);
                  pickerAutomated = true;
                  break;
                }
              }

              if (!pickerAutomated) {
                // Try double-click on the result
                await bestResult.dblclick();
                console.log(`    Double-clicked to select.`);
                pickerAutomated = true;
              }
              break;
            }
          }
          break;
        }
      } catch (e) {
        console.log(`    Picker frame interaction failed: ${e.message}`);
      }
    }

    // If frame access didn't work, try keyboard navigation
    if (!pickerAutomated) {
      console.log(`    Trying keyboard navigation in picker...`);
      try {
        // Type in search — the picker might have focus
        await page.keyboard.type(searchName, { delay: 50 });
        await page.waitForTimeout(2000);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(3000);
        // Try Enter again to select the first result
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2000);
        pickerAutomated = true;
        console.log(`    Submitted via keyboard.`);
      } catch (e) {
        console.log(`    Keyboard navigation failed: ${e.message}`);
      }
    }
  }

  // Step 4: Wait for attachment to appear
  if (pickerAutomated || clicked) {
    console.log(`    Waiting for attachment to appear...`);
    const maxWait = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await page.waitForTimeout(1500);

      const hasFile = await page.evaluate(() => {
        const body = document.body.innerText.toLowerCase();
        return body.includes(".mp4") || body.includes("tokens") ||
               body.includes("video") || body.includes("processing") ||
               body.includes("uploading");
      }).catch(() => false);

      if (hasFile) {
        console.log(`    File attached!`);
        await page.waitForTimeout(2000);
        return true;
      }
    }
  }

  // Fallback: manual
  if (!pickerAutomated) {
    console.log("");
    console.log(`    >> Pick the video in the Drive picker.`);
    if (filename) console.log(`    >> Look for: "${filename}"`);
    console.log(`    >> Press Enter when attached.`);
    await waitForUserInput();
  }

  await page.waitForTimeout(3000);
  return true;
}

/**
 * Attach a local file via the file input element.
 */
async function attachLocalFile(page, filePath) {
  const absPath = path.resolve(filePath);
  console.log(`    Attaching local file: ${absPath}`);

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  // Try to find a file input element (may be hidden)
  let fileInput = await page.$('input[type="file"]');

  if (!fileInput) {
    // Click the upload/attach button to reveal the file input
    const uploadBtnSelectors = [
      'button[aria-label="Add file"]',
      'button[aria-label="Upload"]',
      'button[aria-label="Insert media"]',
      'button:has-text("Upload")',
      'button:has-text("Add file")',
    ];

    for (const sel of uploadBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch {
        // continue
      }
    }

    // Look for "Upload file" or "From computer" option
    const fromComputer = await page.$('text="Upload file", text="From computer", button:has-text("Upload file"), div:has-text("Upload file")').catch(() => null);
    if (fromComputer) {
      // Set up file chooser listener before clicking
      const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null),
        fromComputer.click(),
      ]);

      if (fileChooser) {
        await fileChooser.setFiles(absPath);
        console.log("    File attached via file chooser.");
        await page.waitForTimeout(3000);
        return true;
      }
    }

    // Try again for hidden file input
    fileInput = await page.$('input[type="file"]');
  }

  if (fileInput) {
    await fileInput.setInputFiles(absPath);
    console.log("    File attached via input element.");
    await page.waitForTimeout(3000);
    return true;
  }

  // Fallback: use file chooser event with the generic attach button
  const allButtons = await page.$$("button");
  for (const btn of allButtons) {
    try {
      const text = (await btn.innerText()).toLowerCase();
      const label = (await btn.getAttribute("aria-label") || "").toLowerCase();
      if (
        text.includes("upload") ||
        text.includes("add file") ||
        text.includes("insert") ||
        label.includes("upload") ||
        label.includes("add file")
      ) {
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null),
          btn.click(),
        ]);
        if (fileChooser) {
          await fileChooser.setFiles(absPath);
          console.log("    File attached via file chooser (fallback).");
          await page.waitForTimeout(3000);
          return true;
        }
      }
    } catch {
      // continue
    }
  }

  // Manual fallback
  console.log("");
  console.log("    ==========================================");
  console.log("    MANUAL STEP NEEDED: Upload the video file");
  console.log(`    Path: ${absPath}`);
  console.log("    ==========================================");
  console.log("    Please upload the file manually in the browser,");
  console.log("    then press Enter in this terminal to continue.");
  console.log("");

  await waitForUserInput();
  return true;
}

/**
 * Wait for user to press Enter in the terminal.
 */
function waitForUserInput() {
  return new Promise((resolve) => {
    process.stdin.setRawMode?.(false);
    process.stdout.write("    Press Enter to continue...");
    process.stdin.once("data", () => {
      resolve();
    });
    process.stdin.resume();
  });
}

/**
 * Navigate to a new AI Studio chat.
 */
async function navigateToNewChat(page) {
  console.log("    Navigating to new AI Studio chat...");
  await page.goto(AI_STUDIO_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  // Dismiss any welcome dialogs or cookie banners
  const dismissSelectors = [
    'button:has-text("Got it")',
    'button:has-text("Dismiss")',
    'button:has-text("Close")',
    'button:has-text("Accept")',
    'button[aria-label="Close"]',
    'button[aria-label="Dismiss"]',
  ];

  for (const sel of dismissSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);
      }
    } catch {
      // continue
    }
  }

  await page.waitForTimeout(1000);
}

/**
 * Select the model in AI Studio's model dropdown.
 */
async function selectModel(page, modelName) {
  console.log(`    Selecting model: ${modelName}`);

  // Look for model selector
  const modelSelectors = [
    'button[aria-label*="model"]',
    'button[aria-label*="Model"]',
    'div[class*="model-selector"]',
    'button[class*="model"]',
    '[data-test-id="model-selector"]',
    'mat-select[aria-label*="model"]',
  ];

  for (const sel of modelSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const currentText = await el.innerText().catch(() => "");
        if (currentText.toLowerCase().includes(modelName.toLowerCase())) {
          console.log(`    Model already selected: ${currentText}`);
          return;
        }

        await el.click();
        await page.waitForTimeout(1000);

        // Look for the model option in the dropdown
        const option = await page.$(`text="${modelName}"`).catch(() => null);
        if (option) {
          await option.click();
          console.log(`    Model selected: ${modelName}`);
          await page.waitForTimeout(1000);
          return;
        }

        // Try partial match
        const options = await page.$$('mat-option, li[role="option"], div[role="option"], button[role="menuitem"]');
        for (const opt of options) {
          const text = await opt.innerText();
          if (text.toLowerCase().includes(modelName.toLowerCase())) {
            await opt.click();
            console.log(`    Model selected: ${text.trim()}`);
            await page.waitForTimeout(1000);
            return;
          }
        }

        // Close dropdown if nothing matched
        await page.keyboard.press("Escape");
        break;
      }
    } catch {
      // continue
    }
  }

  console.log(`    Could not auto-select model "${modelName}". It may already be selected or the UI has changed.`);
}

// ── Main workflow ────────────────────────────────────────────────────────────

async function processVideo(page, opts, videoIdentifier, videoNum, isDriveId) {
  const { unit, lesson, dryRun } = opts;
  const label = `Video ${videoNum}`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`${label}: ${isDriveId ? `Drive ID ${videoIdentifier}` : videoIdentifier}`);
  console.log("=".repeat(60));

  const promptEntries = Object.entries(PROMPTS);
  let isFirstPrompt = true;
  let needsNewChat = false;

  // Check if all outputs for this video already exist (skip entirely)
  const allDone = promptEntries.every(([key]) => {
    const f = outputPath(unit, lesson, videoNum, key);
    return fs.existsSync(f) && fs.statSync(f).size > 500;
  });
  if (allDone) {
    console.log(`\n  All outputs for ${label} already exist. Skipping entirely.`);
    return;
  }

  // If first prompt was already done but second wasn't, we need a fresh chat for the second
  const firstDone = fs.existsSync(outputPath(unit, lesson, videoNum, promptEntries[0][0]))
    && fs.statSync(outputPath(unit, lesson, videoNum, promptEntries[0][0])).size > 500;
  if (firstDone) {
    needsNewChat = true;
  }

  for (const [promptKey, promptText] of promptEntries) {
    const suffix = promptKey; // "transcription" or "slides"
    const outFile = outputPath(unit, lesson, videoNum, suffix);

    console.log(`\n  --- ${label} / ${promptKey} ---`);

    // Resume logic: skip if output file already exists with substantial content
    if (fs.existsSync(outFile) && fs.statSync(outFile).size > 500) {
      console.log(`    SKIPPING — already have ${fs.statSync(outFile).size} bytes in ${path.basename(outFile)}`);
      continue;
    }

    if (isFirstPrompt || needsNewChat) {
      // Need a new chat: either first prompt, or resuming mid-video
      await navigateToNewChat(page);
      await selectModel(page, opts.model);

      if (isDriveId) {
        await attachDriveFile(page, videoIdentifier);
      } else {
        await attachLocalFile(page, videoIdentifier);
      }

      // Wait for media to finish processing before submitting
      console.log("    Waiting for video to finish processing...");
      await waitForMediaReady(page);
      isFirstPrompt = false;
      needsNewChat = false;
    } else {
      // Subsequent prompts: stay in same chat, video is already loaded
      console.log("    Continuing in same chat (video already attached)...");
      await page.waitForTimeout(1000);
    }

    if (dryRun) {
      console.log("    [DRY RUN] Would submit prompt:");
      console.log(`    ${promptText.split("\n")[0]}...`);
      console.log(`    Output would be saved to: ${outFile}`);
      continue;
    }

    // Count existing turns BEFORE submitting so we can detect the NEW response
    const turnCountBefore = await page.evaluate(() => {
      return document.querySelectorAll("ms-chat-turn, .chat-turn").length;
    }).catch(() => 0);

    // Type and submit the prompt
    console.log("    Submitting prompt...");
    await typeAndSubmit(page, promptText);

    // Wait for the response — pass turn count so it waits for a NEW turn
    let responseText = await waitForResponse(page, turnCountBefore);

    if (!responseText || responseText.length < 50) {
      console.log("    WARNING: Response text appears too short or empty.");
      console.log("    The browser is still open — you can manually copy the response.");
      console.log("    Press Enter to continue to the next prompt...");
      await waitForUserInput();
    }

    // Save the response
    if (responseText && responseText.trim().length > 0) {
      const header = `# ${label} — ${promptKey === "transcription" ? "Transcript" : "Slide Descriptions"}\n# Unit ${unit}, Lesson ${lesson}\n\n`;
      fs.writeFileSync(outFile, header + responseText.trim() + "\n");
      console.log(`    Saved: ${outFile}`);
      console.log(`    Length: ${responseText.trim().length} characters`);
    } else {
      console.log(`    ERROR: No response text captured for ${promptKey}.`);
      console.log(`    Expected output file: ${outFile}`);
    }
  }
}


async function main() {
  const opts = parseArgs(process.argv);

  // Dynamic import — so arg parsing works even without playwright installed
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    console.error("Error: 'playwright' package not found.");
    console.error("Install it with:  npm install playwright");
    console.error("Then run:          npx playwright install chromium");
    process.exit(1);
  }

  console.log("\nAI Studio Video Ingest — Playwright Automation (CDP)");
  console.log(`Unit: ${opts.unit}  Lesson: ${opts.lesson}`);
  console.log(`Model: ${opts.model}`);
  console.log(`Drive IDs: ${opts.driveIds.length > 0 ? opts.driveIds.join(", ") : "(none)"}`);
  console.log(`Local files: ${opts.files.length > 0 ? opts.files.join(", ") : "(none)"}`);
  console.log(`Dry run: ${opts.dryRun}`);
  console.log();

  // Ensure output directory exists
  const outDir = path.join(OUTPUT_BASE, `u${opts.unit}`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output directory: ${outDir}`);

  // ── Connect to the browser via CDP ──────────────────────────────────────
  console.log(`Attempting CDP connection...`);
  const { browser, page } = await connectCDP(chromium, { preferUrl: "aistudio.google.com" });

  // Build the list of videos to process
  const videos = [];
  for (const driveId of opts.driveIds) {
    videos.push({ id: driveId, isDriveId: true });
  }
  for (const filePath of opts.files) {
    videos.push({ id: filePath, isDriveId: false });
  }

  const totalPrompts = videos.length * Object.keys(PROMPTS).length;
  console.log(`\nProcessing ${videos.length} video(s), ${totalPrompts} prompts total.\n`);

  try {
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      await processVideo(page, opts, video.id, i + 1, video.isDriveId);
    }

    console.log(`\n${"=".repeat(60)}`);
    if (opts.dryRun) {
      console.log("Dry run complete. No prompts were submitted.");
    } else {
      console.log(`Done! Processed ${videos.length} video(s).`);
      console.log(`Output directory: ${outDir}`);
    }
    console.log("=".repeat(60));
  } catch (err) {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // CDP mode: disconnect without closing the user's browser
  console.log("\nDisconnecting from browser (CDP). Your browser remains open.");
  if (browser) {
    await browser.close();  // close() on a CDP browser just disconnects
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

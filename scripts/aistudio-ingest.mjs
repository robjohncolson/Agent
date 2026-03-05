#!/usr/bin/env node
/**
 * aistudio-ingest.mjs — Automate Google AI Studio video transcription via Playwright
 *
 * Connects to an already-running browser via Chrome DevTools Protocol (CDP) so the
 * user's Google session is available. Falls back to launching a new persistent
 * context if --launch is passed.
 *
 * Usage (preferred — CDP, connect to existing browser):
 *   node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 \
 *     --drive-ids "1JE4_U3BNx90g66fasqu1yRNgslGkpwaI" "1_C9FAHoG_78nqXAcBh-REYx7a79zC7Cl"
 *
 *   node scripts/aistudio-ingest.mjs --unit 6 --lesson 5 \
 *     --files "./u6/videos/6-5-1.mp4" "./u6/videos/6-5-2.mp4"
 *
 * Usage (fallback — launch new browser):
 *   node scripts/aistudio-ingest.mjs --launch --unit 6 --lesson 5 --drive-ids "abc123"
 *
 * Start Edge with remote debugging:
 *   scripts/start-edge-debug.cmd
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 */

import fs from "fs";
import path from "path";

// Playwright is imported dynamically in main() so that arg parsing and --help
// work even if the package isn't installed yet.
let chromium;

// ── Constants ────────────────────────────────────────────────────────────────

const AI_STUDIO_URL = "https://aistudio.google.com/prompts/new_chat";
const CDP_URL = "http://127.0.0.1:9222";
const USER_DATA_DIR = "C:/Users/ColsonR/.playwright-profile";
const OUTPUT_BASE = "C:/Users/ColsonR/apstats-live-worksheet";

const RESPONSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max per response
const RESPONSE_STABLE_MS = 5000;             // text must be stable for 5s
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
  let model = "Gemini 2.5 Pro";
  let useCDP = true;   // CDP is the default connection mode
  let launch = false;   // --launch falls back to launching a new browser

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
    } else if (arg === "--cdp") {
      useCDP = true;
      launch = false;
    } else if (arg === "--launch") {
      launch = true;
      useCDP = false;
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
        "  --model           AI Studio model name (default: \"Gemini 2.5 Pro\")\n" +
        "  --dry-run         Open browser but don't submit prompts\n" +
        "  --cdp             Connect via CDP to an already-running browser (default)\n" +
        "  --launch          Launch a new persistent browser instead of CDP\n"
    );
    process.exit(1);
  }

  if (driveIds.length === 0 && files.length === 0) {
    console.error("Error: provide at least one --drive-ids or --files argument.");
    process.exit(1);
  }

  return { unit, lesson, driveIds, files, dryRun, model, useCDP, launch };
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
 *   2. Poll the text content length until it stabilizes (no change for RESPONSE_STABLE_MS).
 *   3. Also check for the reappearance of the send button / disappearance of stop button.
 *   4. Hard timeout at RESPONSE_TIMEOUT_MS.
 */
async function waitForResponse(page) {
  console.log("    Waiting for response to complete...");

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;

  // Wait for any model response content to appear (try several selectors)
  const responseSelectors = [
    ".response-container",
    ".model-response",
    '[data-test-id="response"]',
    "ms-chat-turn-container .turn-content",
    ".chat-turn-container .turn-content",
    ".markdown-content",
    'div[class*="response"]',
    'div[class*="model-turn"]',
    'div[class*="assistant"]',
  ];

  let responseEl = null;
  const selectorDeadline = Date.now() + 60_000; // 60s to find the response container

  while (!responseEl && Date.now() < selectorDeadline) {
    for (const sel of responseSelectors) {
      try {
        const els = await page.$$(sel);
        if (els.length > 0) {
          // Take the last one (most recent response)
          responseEl = els[els.length - 1];
          console.log(`    Found response element: ${sel}`);
          break;
        }
      } catch {
        // selector not found, try next
      }
    }
    if (!responseEl) {
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }
  }

  if (!responseEl) {
    console.log("    WARNING: Could not find response container via known selectors.");
    console.log("    Falling back to waiting for send button to reappear...");
  }

  // Now poll until the response text stabilizes
  let lastText = "";
  let lastChangeTime = Date.now();

  while (Date.now() < deadline) {
    await page.waitForTimeout(POLL_INTERVAL_MS);

    // Check if the send/submit button is enabled again (indicates generation complete)
    const sendButtonReady = await page.evaluate(() => {
      // Look for the run/send button that is not disabled
      const buttons = document.querySelectorAll('button[aria-label="Run"], button[aria-label="Send"], button[data-test-id="send-button"]');
      for (const btn of buttons) {
        if (!btn.disabled && btn.offsetParent !== null) return true;
      }
      // Also check if stop button is gone
      const stopBtn = document.querySelector('button[aria-label="Stop"], button[data-test-id="stop-button"]');
      if (!stopBtn || stopBtn.offsetParent === null) return true;
      return false;
    });

    // Get current response text
    let currentText = "";
    if (responseEl) {
      try {
        currentText = await responseEl.innerText();
      } catch {
        // Element might have been replaced; try to re-find it
        for (const sel of responseSelectors) {
          try {
            const els = await page.$$(sel);
            if (els.length > 0) {
              responseEl = els[els.length - 1];
              currentText = await responseEl.innerText();
              break;
            }
          } catch {
            // continue
          }
        }
      }
    }

    if (currentText !== lastText) {
      lastText = currentText;
      lastChangeTime = Date.now();
      const lines = currentText.split("\n").length;
      process.stdout.write(`\r    Streaming... ${lines} lines received`);
    }

    // Consider done if: text has stabilized AND (send button is ready OR we've waited long enough)
    const stableFor = Date.now() - lastChangeTime;
    if (currentText.length > 0 && stableFor >= RESPONSE_STABLE_MS && sendButtonReady) {
      process.stdout.write("\n");
      console.log("    Response complete.");
      return currentText;
    }

    // Also accept if text is stable for a very long time even without button signal
    if (currentText.length > 0 && stableFor >= RESPONSE_STABLE_MS * 3) {
      process.stdout.write("\n");
      console.log("    Response appears complete (stable text, no button signal).");
      return currentText;
    }
  }

  process.stdout.write("\n");
  console.log("    WARNING: Response timed out. Extracting whatever text is available.");
  return lastText || "";
}

/**
 * Extract the response text from the page. Tries multiple strategies.
 */
async function extractResponseText(page) {
  // Strategy 1: find model response turns and take the last one
  const strategies = [
    // AI Studio model turns
    async () => {
      const turns = await page.$$('div[class*="model-turn"], div[class*="response"], .model-response');
      if (turns.length > 0) {
        return await turns[turns.length - 1].innerText();
      }
      return null;
    },
    // Markdown content blocks
    async () => {
      const blocks = await page.$$(".markdown-content, .rendered-markdown");
      if (blocks.length > 0) {
        return await blocks[blocks.length - 1].innerText();
      }
      return null;
    },
    // Chat turn containers — take every other one (model turns)
    async () => {
      const turns = await page.$$(".chat-turn, .turn-content, ms-chat-turn-container");
      if (turns.length >= 2) {
        // Last turn should be the model response
        return await turns[turns.length - 1].innerText();
      }
      return null;
    },
    // Fallback: grab all text from the main content area
    async () => {
      const main = await page.$("main, .chat-container, .conversation");
      if (main) {
        return await main.innerText();
      }
      return null;
    },
  ];

  for (const strategy of strategies) {
    try {
      const text = await strategy();
      if (text && text.trim().length > 50) {
        return text.trim();
      }
    } catch {
      // try next strategy
    }
  }

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

  // Click to focus and type the prompt
  await inputEl.click();
  await page.waitForTimeout(500);

  // Use fill for textarea, or type for contenteditable
  const tagName = await inputEl.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === "textarea" || tagName === "input") {
    await inputEl.fill(promptText);
  } else {
    // contenteditable — type character by character is too slow, use clipboard
    await page.evaluate((text) => {
      const el = document.querySelector('div[contenteditable="true"], div[role="textbox"]');
      if (el) {
        el.innerText = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, promptText);
  }

  await page.waitForTimeout(500);

  // Click the send/run button
  const sendSelectors = [
    'button[aria-label="Run"]',
    'button[aria-label="Send"]',
    'button[aria-label="Send message"]',
    'button[data-test-id="send-button"]',
    'button[class*="send"]',
    'button[class*="run"]',
    'button[class*="submit"]',
  ];

  let submitted = false;
  for (const sel of sendSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isEnabled()) {
        await btn.click();
        console.log(`    Clicked submit button: ${sel}`);
        submitted = true;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!submitted) {
    // Fallback: try Enter key
    console.log("    No submit button found, trying Enter key...");
    await inputEl.press("Enter");
  }

  await page.waitForTimeout(1000);
}

/**
 * Attach a file from Google Drive using its file ID.
 *
 * This navigates the Drive picker UI within AI Studio. If the picker approach
 * fails, it falls back to constructing the file URL and pasting it.
 */
async function attachDriveFile(page, driveId) {
  console.log(`    Attaching Drive file: ${driveId}`);

  // Look for the attachment / add file button
  const attachSelectors = [
    'button[aria-label="Add file"]',
    'button[aria-label="Insert media"]',
    'button[aria-label="Upload"]',
    'button[aria-label="Attach"]',
    'button[class*="upload"]',
    'button[class*="attach"]',
    'button[class*="media"]',
    // Material icon buttons with attachment icons
    'button:has(mat-icon)',
  ];

  let attachBtn = null;
  for (const sel of attachSelectors) {
    try {
      const btns = await page.$$(sel);
      for (const btn of btns) {
        const text = await btn.innerText().catch(() => "");
        const label = await btn.getAttribute("aria-label").catch(() => "");
        if (
          text.toLowerCase().includes("add") ||
          text.toLowerCase().includes("upload") ||
          text.toLowerCase().includes("file") ||
          text.toLowerCase().includes("media") ||
          text.toLowerCase().includes("insert") ||
          text.toLowerCase().includes("+") ||
          label?.toLowerCase().includes("add") ||
          label?.toLowerCase().includes("file") ||
          label?.toLowerCase().includes("media") ||
          label?.toLowerCase().includes("insert")
        ) {
          attachBtn = btn;
          break;
        }
      }
      if (attachBtn) break;
    } catch {
      // try next
    }
  }

  if (!attachBtn) {
    // Try a broader search for buttons near the input
    const allButtons = await page.$$("button");
    for (const btn of allButtons) {
      try {
        const text = (await btn.innerText()).toLowerCase();
        const label = (await btn.getAttribute("aria-label") || "").toLowerCase();
        if (
          text.includes("add file") ||
          text.includes("upload") ||
          text.includes("insert") ||
          label.includes("add file") ||
          label.includes("upload") ||
          label.includes("insert media")
        ) {
          attachBtn = btn;
          console.log(`    Found attach button with text: "${text}" / label: "${label}"`);
          break;
        }
      } catch {
        // continue
      }
    }
  }

  if (attachBtn) {
    await attachBtn.click();
    await page.waitForTimeout(2000);

    // Look for Google Drive option in the menu/dialog that appears
    const driveOption = await page.$(
      'text="Google Drive", button:has-text("Google Drive"), [aria-label*="Drive"], a:has-text("Google Drive"), div:has-text("Google Drive")'
    ).catch(() => null);

    if (driveOption) {
      await driveOption.click();
      await page.waitForTimeout(3000);

      // The Drive picker opens — we need to search for the file by ID
      // Try typing the file ID into the picker search
      const pickerSearch = await page.$('input[type="text"], input[aria-label*="Search"]').catch(() => null);
      if (pickerSearch) {
        await pickerSearch.fill(driveId);
        await page.waitForTimeout(2000);
        // Click the first result
        const firstResult = await page.$('.picker-item, .drive-item, tr[data-id]').catch(() => null);
        if (firstResult) {
          await firstResult.click();
          await page.waitForTimeout(1000);
          // Click Select / Open
          const selectBtn = await page.$('button:has-text("Select"), button:has-text("Open"), button:has-text("Insert")').catch(() => null);
          if (selectBtn) {
            await selectBtn.click();
            await page.waitForTimeout(2000);
            console.log("    Drive file attached via picker.");
            return true;
          }
        }
      }
    }
  }

  // Fallback approach: try to use the URL-based insertion
  // Some AI Studio versions support pasting a Drive link directly
  const driveUrl = `https://drive.google.com/file/d/${driveId}/view`;
  console.log(`    Picker approach inconclusive. Trying URL-based attachment...`);
  console.log(`    Drive URL: ${driveUrl}`);

  // Try to find a URL input or paste the link into the chat
  const urlInput = await page.$('input[placeholder*="URL"], input[placeholder*="url"], input[type="url"]').catch(() => null);
  if (urlInput) {
    await urlInput.fill(driveUrl);
    await page.waitForTimeout(1000);
    const confirmBtn = await page.$('button:has-text("Add"), button:has-text("Insert"), button:has-text("OK")').catch(() => null);
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
      console.log("    Drive file attached via URL input.");
      return true;
    }
  }

  // Last resort: alert the user
  console.log("");
  console.log("    ==========================================");
  console.log("    MANUAL STEP NEEDED: Attach the video file");
  console.log(`    Drive ID: ${driveId}`);
  console.log(`    Drive URL: ${driveUrl}`);
  console.log("    ==========================================");
  console.log("    Please attach the file manually in the browser,");
  console.log("    then press Enter in this terminal to continue.");
  console.log("");

  await waitForUserInput();
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

  for (const [promptKey, promptText] of Object.entries(PROMPTS)) {
    const suffix = promptKey; // "transcription" or "slides"
    const outFile = outputPath(unit, lesson, videoNum, suffix);

    console.log(`\n  --- ${label} / ${promptKey} ---`);

    // Navigate to new chat
    await navigateToNewChat(page);

    // Select model
    await selectModel(page, opts.model);

    // Attach the video
    if (isDriveId) {
      await attachDriveFile(page, videoIdentifier);
    } else {
      await attachLocalFile(page, videoIdentifier);
    }

    // Wait a moment for the attachment to register
    await page.waitForTimeout(2000);

    if (dryRun) {
      console.log("    [DRY RUN] Would submit prompt:");
      console.log(`    ${promptText.split("\n")[0]}...`);
      console.log(`    Output would be saved to: ${outFile}`);
      continue;
    }

    // Type and submit the prompt
    console.log("    Submitting prompt...");
    await typeAndSubmit(page, promptText);

    // Wait for the response
    let responseText = await waitForResponse(page);

    // If waitForResponse returned text directly, use it; otherwise extract
    if (!responseText || responseText.length < 50) {
      console.log("    Attempting secondary text extraction...");
      responseText = await extractResponseText(page);
    }

    if (!responseText || responseText.length < 50) {
      console.log("    WARNING: Response text appears too short or empty.");
      console.log("    The browser is still open — you can manually copy the response.");
      console.log("    Press Enter to continue to the next prompt...");
      await waitForUserInput();

      // One more attempt
      responseText = await extractResponseText(page);
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

/**
 * Try to connect to an already-running browser via Chrome DevTools Protocol.
 * Returns { browser, context, page, connectedViaCDP: true } or null.
 */
async function connectViaCDP() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`);
    if (response.ok) {
      const info = await response.json();
      console.log(`CDP: Found browser — ${info.Browser || "unknown"}`);
      const browser = await chromium.connectOverCDP(CDP_URL);
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        console.log("CDP: No browser contexts found.");
        return null;
      }
      const context = contexts[0];
      const pages = context.pages();
      // Prefer a tab already on AI Studio, otherwise use the first page
      let page = pages.find(p => p.url().includes("aistudio.google.com")) || pages[0];
      if (!page) {
        page = await context.newPage();
      }
      console.log(`CDP: Connected. Using page: ${page.url()}`);
      return { browser, context, page, connectedViaCDP: true };
    }
  } catch {
    // No debuggable browser running — that's fine
  }
  return null;
}

/**
 * Launch a new persistent browser context (fallback mode via --launch).
 * Returns { browser: null, context, page, connectedViaCDP: false }.
 */
async function launchNewBrowser() {
  console.log("Launching new browser (--launch mode)...");
  let context;
  try {
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1400, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-gpu",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });
  } catch (launchErr) {
    console.error("Browser launch failed:", launchErr.message);
    console.error("Retrying with --disable-software-rasterizer...");
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1400, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });
  }
  const page = context.pages()[0] || await context.newPage();
  return { browser: null, context, page, connectedViaCDP: false };
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

  console.log("\nAI Studio Video Ingest — Playwright Automation");
  console.log(`Unit: ${opts.unit}  Lesson: ${opts.lesson}`);
  console.log(`Model: ${opts.model}`);
  console.log(`Drive IDs: ${opts.driveIds.length > 0 ? opts.driveIds.join(", ") : "(none)"}`);
  console.log(`Local files: ${opts.files.length > 0 ? opts.files.join(", ") : "(none)"}`);
  console.log(`Dry run: ${opts.dryRun}`);
  console.log(`Connection mode: ${opts.launch ? "launch (persistent context)" : "CDP (connect to running browser)"}`);
  console.log();

  // Ensure output directory exists
  const outDir = path.join(OUTPUT_BASE, `u${opts.unit}`);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Output directory: ${outDir}`);

  // ── Connect or launch the browser ─────────────────────────────────────────
  let browser = null;   // non-null only for CDP connections
  let context;
  let page;
  let connectedViaCDP = false;

  if (opts.launch) {
    // Explicit --launch: skip CDP, launch a new persistent context
    ({ context, page, connectedViaCDP } = await launchNewBrowser());
  } else {
    // Default: try CDP connection first
    console.log(`Attempting CDP connection at ${CDP_URL} ...`);
    const cdpResult = await connectViaCDP();

    if (cdpResult) {
      ({ browser, context, page, connectedViaCDP } = cdpResult);
    } else {
      // CDP failed — print instructions and exit
      console.error("\nNo browser with remote debugging found.");
      console.error("Start Edge with debugging enabled:\n");
      console.error('  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222\n');
      console.error("Or run the helper script:\n");
      console.error("  scripts\\start-edge-debug.cmd\n");
      console.error("Then navigate to https://aistudio.google.com and run this script again.");
      console.error("\nAlternatively, pass --launch to start a new browser with a Playwright profile.");
      process.exit(1);
    }
  }

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
    if (!connectedViaCDP) {
      console.log("\nThe browser will remain open for manual intervention.");
      console.log("Press Enter to close the browser and exit.");
      await waitForUserInput();
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  if (connectedViaCDP) {
    // CDP mode: disconnect without closing the user's browser
    console.log("\nDisconnecting from browser (CDP). Your browser remains open.");
    if (browser) {
      await browser.close();  // close() on a CDP browser just disconnects
    }
  } else {
    // Launch mode: give the user a moment then close
    if (!opts.dryRun) {
      console.log("\nBrowser will remain open for 10 seconds for review...");
      console.log("Press Enter to close immediately, or wait.");
      const closePromise = new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        process.stdin.once("data", () => {
          clearTimeout(timer);
          resolve();
        });
        process.stdin.resume();
      });
      await closePromise;
    }
    await context.close();
    console.log("Browser closed. Goodbye.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

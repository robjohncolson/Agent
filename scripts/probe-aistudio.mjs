/**
 * probe-aistudio.mjs — DEBUG TOOL
 *
 * Connects to a running browser via CDP and dumps AI Studio DOM state:
 * chat turns, Run/Stop button, spinners, textarea. Useful for diagnosing
 * selector changes when AI Studio updates its UI.
 *
 * Usage:  node scripts/probe-aistudio.mjs
 * Requires Edge/Chrome running with --remote-debugging-port=9222.
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("aistudio")) || ctx.pages()[0];

// Detailed turn analysis
const turns = await page.evaluate(() => {
  const els = document.querySelectorAll("ms-chat-turn, .chat-turn");
  return Array.from(els).map((el, i) => ({
    index: i,
    textLength: el.innerText.length,
    first100: el.innerText.substring(0, 100).replace(/\n/g, "\\n"),
    last50: el.innerText.substring(Math.max(0, el.innerText.length - 50)).replace(/\n/g, "\\n"),
    hasModel: el.innerText.includes("Model"),
    hasUser: el.innerText.includes("User"),
    childTags: Array.from(el.children).map(c => c.tagName).join(","),
  }));
});
console.log("=== CHAT TURNS ===");
turns.forEach(t => console.log(JSON.stringify(t)));

// Check the Run/Stop button state
const btnState = await page.evaluate(() => {
  const btn = document.querySelector("button.ctrl-enter-submits");
  return btn ? { text: btn.innerText.trim().substring(0, 30), disabled: btn.disabled } : null;
});
console.log("\n=== RUN BUTTON ===");
console.log(JSON.stringify(btnState));

// Find the Run button
const runInfo = await page.evaluate(() => {
  const allBtns = document.querySelectorAll("button");
  const results = [];
  for (const btn of allBtns) {
    const text = btn.innerText.trim();
    if (text.includes("Run") || btn.classList.contains("ms-button-primary")) {
      results.push({
        text: text.substring(0, 60),
        disabled: btn.disabled,
        ariaDisabled: btn.getAttribute("aria-disabled"),
        classes: btn.className.substring(0, 120),
        visible: btn.offsetParent !== null,
        width: btn.offsetWidth,
      });
    }
  }
  return results;
});
console.log("=== RUN/PRIMARY BUTTONS ===");
runInfo.forEach(b => console.log(JSON.stringify(b)));

// Check spinners
const spinners = await page.evaluate(() => {
  const sels = '[class*="spinner"], [class*="loading"], [class*="progress"], [class*="processing"], mat-spinner, mat-progress-bar, [role="progressbar"]';
  const els = document.querySelectorAll(sels);
  return Array.from(els).filter(el => el.offsetParent !== null).map(el => ({
    tag: el.tagName,
    classes: el.className.toString().substring(0, 80),
    width: el.offsetWidth,
  }));
});
console.log("\n=== VISIBLE SPINNERS ===");
console.log(spinners.length === 0 ? "(none)" : "");
spinners.forEach(s => console.log(JSON.stringify(s)));

// Check textarea
const textarea = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  if (ta) return { found: true, ariaLabel: ta.getAttribute("aria-label"), value: ta.value.substring(0, 50), disabled: ta.disabled };
  return { found: false };
});
console.log("\n=== TEXTAREA ===");
console.log(JSON.stringify(textarea));

await browser.close();

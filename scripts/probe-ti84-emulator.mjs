/**
 * probe-ti84-emulator.mjs — DOM discovery for ti84calc.com emulator
 *
 * Connects via CDP, navigates to the emulator, and dumps:
 *   1. Calculator button selectors and labels
 *   2. Screen/display element structure
 *   3. Result of pressing STAT to see menu rendering
 *
 * Usage:  node scripts/probe-ti84-emulator.mjs
 * Requires Edge/Chrome running with --remote-debugging-port=9222.
 */
import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";

const EMULATOR_URL = "https://ti84calc.com/ti84calc";

const { browser, page } = await connectCDP(chromium, { preferUrl: "ti84calc" });

// Navigate to emulator if not already there
if (!page.url().includes("ti84calc")) {
  console.log(`Navigating to ${EMULATOR_URL}...`);
  await page.goto(EMULATOR_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
}

// Give the emulator time to initialize (WASM/canvas)
console.log("Waiting for emulator to initialize...");
await page.waitForTimeout(8000);
console.log(`\nPage URL: ${page.url()}\n`);

// ── 1. Overall page structure ────────────────────────────────────────────────
console.log("=== PAGE STRUCTURE ===");
const structure = await page.evaluate(() => {
  // Get ALL elements on the page
  const allEls = document.querySelectorAll("*");
  const summary = { total: allEls.length };

  // Detail every direct child of body
  const bodyChildren = Array.from(document.body.children).map(el => ({
    tag: el.tagName,
    id: el.id || null,
    classes: el.className?.toString().substring(0, 100) || null,
    src: el.src?.substring(0, 200) || null,
    width: el.offsetWidth,
    height: el.offsetHeight,
    naturalWidth: el.naturalWidth || null,
    naturalHeight: el.naturalHeight || null,
    useMap: el.useMap || null,
    onclick: el.getAttribute("onclick")?.substring(0, 100) || null,
    style: el.style?.cssText?.substring(0, 200) || null,
    alt: el.alt || null,
    title: el.title || null,
    childCount: el.children.length,
  }));

  // Check for image maps
  const maps = Array.from(document.querySelectorAll("map")).map(m => ({
    name: m.name,
    areaCount: m.areas.length,
    areas: Array.from(m.areas).slice(0, 10).map(a => ({
      shape: a.shape,
      coords: a.coords,
      href: a.href?.substring(0, 60),
      alt: a.alt,
      title: a.title,
      onclick: a.getAttribute("onclick")?.substring(0, 100),
    })),
  }));

  return { summary, bodyChildren, maps, title: document.title, bodyHTML: document.body.innerHTML.substring(0, 2000) };
});
console.log("Title:", structure.title);
console.log("Total elements:", structure.summary.total);
console.log("\nBody children:");
structure.bodyChildren.forEach(c => console.log(JSON.stringify(c)));
console.log("\nImage maps:", structure.maps.length);
structure.maps.forEach(m => console.log(JSON.stringify(m)));
console.log("\nBody HTML (first 2000 chars):");
console.log(structure.bodyHTML);

// ── 2. Find calculator buttons ───────────────────────────────────────────────
console.log("\n=== CALCULATOR BUTTONS ===");
const buttons = await page.evaluate(() => {
  // Try common selectors for calculator buttons
  const selectors = [
    "button",
    "[role='button']",
    ".key", ".btn", ".calc-key", ".calculator-key",
    "[data-key]", "[data-value]",
    "td", // sometimes keys are in table cells
    "div[onclick]", "span[onclick]",
    "canvas", // might be canvas-based
  ];
  const results = {};
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      results[sel] = Array.from(els).slice(0, 30).map(el => ({
        tag: el.tagName,
        text: el.innerText?.trim().substring(0, 40) || "",
        id: el.id || null,
        classes: el.className?.toString().substring(0, 80) || null,
        dataKey: el.dataset?.key || null,
        dataValue: el.dataset?.value || null,
        title: el.title || null,
        onclick: el.getAttribute("onclick")?.substring(0, 60) || null,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }));
    }
  }
  return results;
});
for (const [sel, els] of Object.entries(buttons)) {
  console.log(`\n--- ${sel} (${els.length} found) ---`);
  els.forEach(b => console.log(JSON.stringify(b)));
}

// ── 3. Find screen/display element ───────────────────────────────────────────
console.log("\n=== SCREEN/DISPLAY ELEMENTS ===");
const display = await page.evaluate(() => {
  const selectors = [
    "canvas",
    ".screen", ".display", ".lcd",
    "#screen", "#display", "#lcd",
    "[class*='screen']", "[class*='display']",
    "iframe",
    "pre", "code",
  ];
  const results = {};
  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      results[sel] = Array.from(els).map(el => ({
        tag: el.tagName,
        id: el.id || null,
        classes: el.className?.toString().substring(0, 100) || null,
        width: el.offsetWidth,
        height: el.offsetHeight,
        src: el.src?.substring(0, 100) || null,
        text: el.innerText?.substring(0, 200) || null,
      }));
    }
  }
  return results;
});
for (const [sel, els] of Object.entries(display)) {
  console.log(`\n--- ${sel} (${els.length} found) ---`);
  els.forEach(d => console.log(JSON.stringify(d)));
}

// ── 4. Check if it's canvas-based or an iframe ──────────────────────────────
console.log("\n=== IFRAME CHECK ===");
const iframes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("iframe")).map(f => ({
    src: f.src,
    id: f.id,
    width: f.offsetWidth,
    height: f.offsetHeight,
  }));
});
console.log(iframes.length === 0 ? "No iframes found" : JSON.stringify(iframes, null, 2));

// ── 5. Check for WebAssembly / emulator engine ──────────────────────────────
console.log("\n=== GLOBAL OBJECTS ===");
const globals = await page.evaluate(() => {
  const interesting = [
    "calculator", "calc", "emu", "emulator", "ti84",
    "Module", "WASM", "CE", "jsTIfied", "CEmu",
  ];
  const found = {};
  for (const name of interesting) {
    if (window[name] !== undefined) {
      found[name] = typeof window[name];
    }
  }
  // Also check for any large objects on window
  const allKeys = Object.keys(window).filter(k => {
    try {
      return typeof window[k] === "object" && window[k] !== null && !k.startsWith("_");
    } catch { return false; }
  });
  found.__objectKeys = allKeys.filter(k =>
    !["location","navigator","document","console","performance","screen","history","localStorage","sessionStorage","caches","crypto","indexedDB","speechSynthesis","visualViewport","customElements","frames","self","top","parent","window","globalThis","external"].includes(k)
  ).slice(0, 30);
  return found;
});
console.log(JSON.stringify(globals, null, 2));

// ── 6. Take a screenshot ─────────────────────────────────────────────────────
try {
  const screenshotPath = "C:/Users/rober/Downloads/Projects/school/follow-alongs/ti84-emulator-probe.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`\nScreenshot saved to: ${screenshotPath}`);
} catch (err) {
  console.log(`\nScreenshot failed: ${err.message}`);
}

console.log("\n=== PROBE COMPLETE ===");
// Don't close browser — leave it open for manual inspection

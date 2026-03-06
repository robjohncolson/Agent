/**
 * probe-blooket.mjs — Probe Blooket dashboard for CSV upload flow
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];

// Find Blooket tab or navigate to it
let page = ctx.pages().find(p => p.url().includes("blooket"));
if (!page) {
  page = ctx.pages()[0];
  console.log("No Blooket tab found, navigating...");
  await page.goto("https://dashboard.blooket.com/create", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
}

console.log("=== CURRENT PAGE ===");
console.log("URL:", page.url());
console.log("Title:", await page.title());

// Find all buttons/links
console.log("\n=== BUTTONS & LINKS ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button, a, [role='button']")).map(b => ({
    tag: b.tagName,
    text: b.innerText.trim().substring(0, 80),
    href: b.href || null,
    id: b.id,
    classes: b.className.toString().substring(0, 100),
    ariaLabel: b.getAttribute("aria-label"),
    visible: b.offsetParent !== null,
  })).filter(b => (b.text || b.ariaLabel) && b.visible);
});
buttons.forEach(b => console.log(JSON.stringify(b)));

// Find create/import related elements
console.log("\n=== CREATE/IMPORT ELEMENTS ===");
const createEls = await page.evaluate(() => {
  const all = document.querySelectorAll("button, a, [role='button'], input, div[class*='create'], div[class*='import']");
  return Array.from(all).filter(el => {
    const text = (el.innerText || "").toLowerCase();
    const cls = el.className.toString().toLowerCase();
    return text.includes("create") || text.includes("import") || text.includes("csv") ||
           text.includes("upload") || text.includes("spreadsheet") ||
           cls.includes("create") || cls.includes("import");
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 80),
    href: el.href || null,
    classes: el.className.toString().substring(0, 100),
    visible: el.offsetParent !== null,
  }));
});
createEls.forEach(e => console.log(JSON.stringify(e)));

// Find file inputs
console.log("\n=== FILE INPUTS ===");
const fileInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='file'], input[accept*='csv']")).map(el => ({
    id: el.id,
    name: el.name,
    accept: el.accept,
    classes: el.className.toString().substring(0, 80),
    visible: el.offsetParent !== null,
  }));
});
fileInputs.forEach(f => console.log(JSON.stringify(f)));

// Find text inputs
console.log("\n=== TEXT INPUTS ===");
const textInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='text'], input:not([type]), textarea")).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    value: el.value.substring(0, 50),
    visible: el.offsetParent !== null,
  })).filter(el => el.visible);
});
textInputs.forEach(i => console.log(JSON.stringify(i)));

// Dump main content structure
console.log("\n=== PAGE STRUCTURE ===");
const structure = await page.evaluate(() => {
  const root = document.querySelector("#root, #app, main, .app, .dashboard");
  if (!root) return { found: false, bodyText: document.body.innerText.substring(0, 500) };
  return {
    found: true,
    tag: root.tagName,
    id: root.id,
    text: root.innerText.substring(0, 500),
  };
});
console.log(JSON.stringify(structure, null, 2));

await browser.close();
console.log("\nDone.");

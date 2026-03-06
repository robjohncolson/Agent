/**
 * probe-blooket-create.mjs — Probe the Blooket Create/Import flow
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes("blooket")) || ctx.pages()[0];

// Navigate to Create page
await page.goto("https://dashboard.blooket.com/create", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

console.log("=== CREATE PAGE ===");
console.log("URL:", page.url());

// Find all visible buttons and links
console.log("\n=== VISIBLE BUTTONS ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button, a, div[class*='button'], [role='button']")).map(b => ({
    tag: b.tagName,
    text: b.innerText.trim().substring(0, 80),
    href: b.href || null,
    classes: b.className.toString().substring(0, 100),
    visible: b.offsetParent !== null,
  })).filter(b => b.text && b.visible);
});
buttons.forEach(b => console.log(JSON.stringify(b)));

// Find anything related to import/CSV/spreadsheet
console.log("\n=== IMPORT/CSV ELEMENTS ===");
const importEls = await page.evaluate(() => {
  const all = document.querySelectorAll("*");
  return Array.from(all).filter(el => {
    const text = (el.innerText || "").toLowerCase();
    const cls = el.className?.toString().toLowerCase() || "";
    return (text.includes("import") || text.includes("csv") || text.includes("spreadsheet") ||
            cls.includes("import") || cls.includes("csv") || cls.includes("upload")) &&
           el.offsetParent !== null && el.innerText.length < 100;
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 80),
    classes: el.className?.toString().substring(0, 100) || "",
    visible: el.offsetParent !== null,
  }));
});
importEls.forEach(e => console.log(JSON.stringify(e)));

// Find text inputs (title field?)
console.log("\n=== TEXT INPUTS ===");
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input, textarea")).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    visible: el.offsetParent !== null,
  })).filter(el => el.visible);
});
inputs.forEach(i => console.log(JSON.stringify(i)));

// Find file inputs (hidden ones too)
console.log("\n=== FILE INPUTS (all) ===");
const fileInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='file']")).map(el => ({
    id: el.id,
    name: el.name,
    accept: el.accept,
    classes: el.className?.toString().substring(0, 80) || "",
    visible: el.offsetParent !== null,
  }));
});
fileInputs.forEach(f => console.log(JSON.stringify(f)));

// Dump page text for context
console.log("\n=== PAGE CONTENT ===");
const content = await page.evaluate(() => {
  return document.body.innerText.substring(0, 1000);
});
console.log(content);

await browser.close();
console.log("\nDone.");

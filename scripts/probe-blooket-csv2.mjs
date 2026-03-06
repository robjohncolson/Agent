/**
 * probe-blooket-csv2.mjs — Create a test set with CSV mode and probe the next page
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes("blooket")) || ctx.pages()[0];

await page.goto("https://dashboard.blooket.com/create", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

// Select CSV Upload
await page.click('label:has-text("CSV Upload")');
await page.waitForTimeout(1000);
console.log("Selected CSV Upload");

// Fill title
await page.fill("#title", "TEST_DELETE_ME_65");
await page.waitForTimeout(500);
console.log("Filled title");

// Click Create Set
await page.click('button:has-text("Create Set")');
console.log("Clicked Create Set, waiting for next page...");
await page.waitForTimeout(5000);

console.log("\n=== NEW PAGE ===");
console.log("URL:", page.url());
console.log("Title:", await page.title());

// Probe the new page
console.log("\n=== VISIBLE BUTTONS ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button, a, [role='button']")).map(b => ({
    tag: b.tagName,
    text: b.innerText.trim().substring(0, 80),
    href: b.href || null,
    classes: b.className?.toString().substring(0, 100) || "",
    visible: b.offsetParent !== null,
  })).filter(b => b.text && b.visible);
});
buttons.forEach(b => console.log(JSON.stringify(b)));

// Find file inputs
console.log("\n=== FILE INPUTS ===");
const fileInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='file']")).map(el => ({
    name: el.name, accept: el.accept,
    visible: el.offsetParent !== null,
    parentText: el.parentElement?.innerText?.substring(0, 80) || "",
  }));
});
fileInputs.forEach(f => console.log(JSON.stringify(f)));

// Find CSV/import related elements
console.log("\n=== CSV/IMPORT ELEMENTS ===");
const csvEls = await page.evaluate(() => {
  const all = document.querySelectorAll("*");
  return Array.from(all).filter(el => {
    const text = (el.innerText || "").toLowerCase();
    return (text.includes("csv") || text.includes("import") || text.includes("upload") ||
            text.includes("spreadsheet") || text.includes("template") || text.includes("download")) &&
           el.offsetParent !== null && el.innerText.length < 150;
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 120),
    classes: el.className?.toString().substring(0, 100) || "",
  }));
});
csvEls.forEach(e => console.log(JSON.stringify(e)));

// Page text
console.log("\n=== PAGE TEXT ===");
const text = await page.evaluate(() => document.body.innerText.substring(0, 1500));
console.log(text);

await browser.close();
console.log("\nDone.");

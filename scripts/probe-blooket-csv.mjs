/**
 * probe-blooket-csv.mjs — Click CSV Upload and probe the file input
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes("blooket")) || ctx.pages()[0];

await page.goto("https://dashboard.blooket.com/create", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

// Click "CSV Upload" radio
const csvLabel = await page.$('label:has-text("CSV Upload")');
if (csvLabel) {
  await csvLabel.click();
  console.log("Clicked CSV Upload");
  await page.waitForTimeout(2000);
} else {
  console.log("ERROR: CSV Upload not found");
}

// Now probe for file inputs and new UI elements
console.log("\n=== ALL INPUTS AFTER CSV CLICK ===");
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input, textarea, select")).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    accept: el.accept || null,
    placeholder: el.placeholder || null,
    visible: el.offsetParent !== null,
    classes: el.className?.toString().substring(0, 80) || "",
  })).filter(el => el.visible || el.type === "file");
});
inputs.forEach(i => console.log(JSON.stringify(i)));

// Check for CSV-specific UI elements
console.log("\n=== CSV-SPECIFIC ELEMENTS ===");
const csvEls = await page.evaluate(() => {
  const all = document.querySelectorAll("*");
  return Array.from(all).filter(el => {
    const text = (el.innerText || "").toLowerCase();
    const cls = el.className?.toString().toLowerCase() || "";
    return (text.includes("csv") || text.includes("upload") || text.includes("template") ||
            text.includes("download") || text.includes("spreadsheet") || text.includes("drag")) &&
           el.offsetParent !== null && el.innerText.length < 200;
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 120),
    classes: el.className?.toString().substring(0, 100) || "",
  }));
});
csvEls.forEach(e => console.log(JSON.stringify(e)));

// Find all file inputs including hidden ones
console.log("\n=== FILE INPUTS (all, including hidden) ===");
const fileInputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='file']")).map(el => ({
    name: el.name,
    accept: el.accept,
    classes: el.className?.toString() || "",
    parentClasses: el.parentElement?.className?.toString().substring(0, 80) || "",
    visible: el.offsetParent !== null,
    multiple: el.multiple,
  }));
});
fileInputs.forEach(f => console.log(JSON.stringify(f)));

// Dump the page content to see CSV instructions
console.log("\n=== PAGE TEXT (CSV section) ===");
const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
console.log(pageText);

await browser.close();
console.log("\nDone.");

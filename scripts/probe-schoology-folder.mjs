#!/usr/bin/env node
/**
 * probe-schoology-folder.mjs — Discover DOM selectors for Schoology folder creation.
 *
 * Steps:
 *   1. Click "Add Materials" dropdown
 *   2. Dump all dropdown items (find "Add Folder")
 *   3. Click "Add Folder"
 *   4. Dump the modal/form that appears (find title, description, submit button)
 *
 * Run with Edge open and Schoology loaded:
 *   node scripts/probe-schoology-folder.mjs
 */
import { chromium } from "playwright";

const MATERIALS_URL = "https://lynnschools.schoology.com/course/7945275782/materials";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("schoology")) || ctx.pages()[0];

// Navigate to materials page
await page.goto(MATERIALS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
console.log("On materials page:", page.url());

// Step 1: Click "Add Materials"
const addBtn = await page.$('span:has-text("Add Materials")');
if (!addBtn) {
  console.log("ERROR: Cannot find 'Add Materials' button");
  await browser.close();
  process.exit(1);
}
await addBtn.click();
console.log("Clicked 'Add Materials'");
await page.waitForTimeout(1500);

// Step 2: Dump dropdown items
console.log("\n=== DROPDOWN ITEMS ===");
const items = await page.evaluate(() => {
  const links = document.querySelectorAll(".action-links a, .dropdown-menu a, [class*='action-links'] a");
  return Array.from(links).map(a => ({
    text: a.innerText.trim().substring(0, 80),
    href: a.href,
    classes: a.className.substring(0, 80),
    visible: a.offsetParent !== null,
  })).filter(a => a.visible || a.text);
});
items.forEach(d => console.log(JSON.stringify(d)));

// Step 3: Find and click "Add Folder"
const folderLink = await page.$('a:has-text("Add Folder")');
if (!folderLink) {
  // Try broader search
  const allLinks = await page.$$("a");
  for (const link of allLinks) {
    const text = await link.innerText().catch(() => "");
    if (text.toLowerCase().includes("folder")) {
      console.log(`\nFound folder link by scanning: "${text}"`);
      await link.click();
      break;
    }
  }
} else {
  // Dump info about the folder link
  const info = await folderLink.evaluate(el => ({
    text: el.innerText.trim(),
    href: el.href,
    classes: el.className,
    id: el.id,
  }));
  console.log("\nFolder link found:", JSON.stringify(info));
  await folderLink.click();
}
console.log("Clicked 'Add Folder'");
await page.waitForTimeout(3000);

// Step 4: Dump the modal/form
console.log("\n=== MODALS/OVERLAYS AFTER CLICK ===");
const modals = await page.evaluate(() => {
  const sels = ".ui-dialog, .modal, [class*='popup'], [class*='overlay'], [class*='dialog'], #popups, .popups-box, .popups-container, [class*='folder']";
  return Array.from(document.querySelectorAll(sels)).map(el => ({
    tag: el.tagName, id: el.id,
    classes: el.className.toString().substring(0, 120),
    visible: el.offsetParent !== null,
    width: el.offsetWidth,
    height: el.offsetHeight,
    text: el.innerText.substring(0, 300),
  })).filter(el => el.visible || el.width > 0);
});
modals.forEach(m => console.log(JSON.stringify(m)));

// Step 5: Dump ALL visible form inputs
console.log("\n=== VISIBLE FORM INPUTS ===");
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input, textarea, select")).map(el => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder || null,
    value: el.value?.substring(0, 50) || null,
    classes: el.className.toString().substring(0, 80),
    visible: el.offsetParent !== null,
    width: el.offsetWidth,
  })).filter(el => el.visible);
});
inputs.forEach(i => console.log(JSON.stringify(i)));

// Step 6: Dump visible buttons
console.log("\n=== VISIBLE BUTTONS ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button, input[type='submit'], a.form-submit, [class*='submit']")).map(el => ({
    tag: el.tagName,
    type: el.type,
    id: el.id,
    text: el.innerText?.trim().substring(0, 50),
    value: el.value?.substring(0, 50),
    classes: el.className.toString().substring(0, 80),
    visible: el.offsetParent !== null,
  })).filter(el => el.visible);
});
buttons.forEach(b => console.log(JSON.stringify(b)));

// Step 7: Dump iframes (in case the form is in an iframe)
console.log("\n=== IFRAMES ===");
const iframes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("iframe")).map(f => ({
    src: f.src?.substring(0, 150),
    id: f.id,
    classes: f.className.substring(0, 80),
    visible: f.offsetParent !== null,
    width: f.offsetWidth,
    height: f.offsetHeight,
  })).filter(f => f.visible || f.width > 0);
});
iframes.forEach(f => console.log(JSON.stringify(f)));

// Step 8: Full page HTML snippet around any "folder" or "Create" text
console.log("\n=== HTML AROUND 'Create' TEXT ===");
const createHtml = await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const matches = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (text.toLowerCase().includes("create") || text.toLowerCase().includes("title")) {
      const parent = walker.currentNode.parentElement;
      if (parent && parent.offsetParent !== null) {
        matches.push({
          text: text.substring(0, 80),
          parentTag: parent.tagName,
          parentId: parent.id,
          parentClasses: parent.className.toString().substring(0, 80),
          parentHTML: parent.outerHTML.substring(0, 200),
        });
      }
    }
  }
  return matches.slice(0, 20);
});
createHtml.forEach(h => console.log(JSON.stringify(h)));

await browser.close();
console.log("\nProbe complete.");

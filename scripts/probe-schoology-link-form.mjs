/**
 * probe-schoology-link-form.mjs — Click through to the Link form and probe fields
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("schoology")) || ctx.pages()[0];

// Navigate to materials
await page.goto("https://lynnschools.schoology.com/course/7945275782/materials", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);

// Click Add Materials
await page.click('span:has-text("Add Materials")');
await page.waitForTimeout(1000);

// Click Add File/Link/External Tool
await page.click('a:has-text("Add File/Link/External Tool")');
await page.waitForTimeout(2000);

// Click "Link" option in the popup
const linkBtn = await page.$("a.action-create-link");
if (linkBtn) {
  await linkBtn.click();
  console.log("Clicked 'Link' option");
  await page.waitForTimeout(3000);
} else {
  console.log("ERROR: Could not find 'Link' button");
  await browser.close();
  process.exit(1);
}

// Now probe the link form
console.log("\n=== LINK FORM — ALL INPUTS ===");
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input, textarea, select")).map(el => ({
    tag: el.tagName,
    type: el.type || null,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder || null,
    ariaLabel: el.getAttribute("aria-label"),
    classes: el.className.toString().substring(0, 80),
    value: el.value.substring(0, 50),
    visible: el.offsetParent !== null,
    width: el.offsetWidth,
  })).filter(el => el.visible || el.name);
});
inputs.forEach(i => console.log(JSON.stringify(i)));

console.log("\n=== LINK FORM — LABELS ===");
const labels = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("label")).map(l => ({
    text: l.innerText.trim().substring(0, 80),
    for: l.getAttribute("for"),
    visible: l.offsetParent !== null,
  })).filter(l => l.visible);
});
labels.forEach(l => console.log(JSON.stringify(l)));

console.log("\n=== LINK FORM — BUTTONS ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='submit'], button[type='submit'], .form-submit, .popups-buttons button, .popups-buttons input")).map(el => ({
    tag: el.tagName,
    text: el.innerText?.trim() || el.value,
    id: el.id,
    name: el.name,
    type: el.type,
    classes: el.className.toString().substring(0, 80),
    visible: el.offsetParent !== null,
  }));
});
buttons.forEach(b => console.log(JSON.stringify(b)));

console.log("\n=== POPUPS CONTENT ===");
const popupContent = await page.evaluate(() => {
  const popup = document.querySelector(".popups-box");
  if (!popup) return { found: false };
  return {
    found: true,
    width: popup.offsetWidth,
    height: popup.offsetHeight,
    classes: popup.className,
    text: popup.innerText.substring(0, 500),
    html: popup.innerHTML.substring(0, 3000),
  };
});
if (popupContent.found) {
  console.log("Size:", popupContent.width, "x", popupContent.height);
  console.log("Classes:", popupContent.classes);
  console.log("Text:", popupContent.text);
  console.log("\nHTML:");
  console.log(popupContent.html);
}

await browser.close();
console.log("\nDone.");

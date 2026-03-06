/**
 * probe-schoology-popup.mjs — Click "Add Materials" → "Add File/Link" and probe the popup
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("schoology")) || ctx.pages()[0];

// Navigate back to materials page
await page.goto("https://lynnschools.schoology.com/course/7945275782/materials", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
console.log("On materials page:", page.url());

// Step 1: Click "Add Materials" dropdown
const addMaterials = await page.$("#dropdown-69aa3a1553a82-button");
if (!addMaterials) {
  // Try by text
  const span = await page.$('span:has-text("Add Materials")');
  if (span) {
    await span.click();
    console.log("Clicked Add Materials (by text)");
  } else {
    console.log("ERROR: Cannot find Add Materials button");
  }
} else {
  await addMaterials.click();
  console.log("Clicked Add Materials (by ID)");
}
await page.waitForTimeout(1500);

// Check what's visible now
console.log("\n=== DROPDOWN VISIBLE ITEMS ===");
const dropdownItems = await page.evaluate(() => {
  const container = document.querySelector(".action-links.has-material-apps");
  if (!container) return [];
  return Array.from(container.querySelectorAll("a")).map(a => ({
    text: a.innerText.trim(),
    href: a.href,
    visible: a.offsetParent !== null,
    classes: a.className.substring(0, 60),
  }));
});
dropdownItems.forEach(d => console.log(JSON.stringify(d)));

// Step 2: Click "Add File/Link/External Tool"
const addLink = await page.$('a:has-text("Add File/Link")');
if (addLink) {
  // Listen for popup/dialog
  const popupPromise = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null);

  await addLink.click();
  console.log("\nClicked 'Add File/Link/External Tool'");
  await page.waitForTimeout(3000);

  const popup = await popupPromise;
  if (popup) {
    console.log("\n=== POPUP PAGE ===");
    console.log("URL:", popup.url());
    await popup.waitForTimeout(2000);

    const popupInputs = await popup.evaluate(() => {
      return Array.from(document.querySelectorAll("input, textarea, select")).map(el => ({
        tag: el.tagName, type: el.type, name: el.name, id: el.id,
        placeholder: el.placeholder || null,
        visible: el.offsetParent !== null,
      })).filter(el => el.visible || el.name);
    });
    console.log("Inputs:");
    popupInputs.forEach(i => console.log(JSON.stringify(i)));
  }

  // Check for iframe or modal overlay
  console.log("\n=== IFRAMES ===");
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("iframe")).map(f => ({
      src: f.src?.substring(0, 150),
      id: f.id,
      classes: f.className.substring(0, 80),
      visible: f.offsetParent !== null,
      width: f.offsetWidth,
      height: f.offsetHeight,
    }));
  });
  iframes.forEach(f => console.log(JSON.stringify(f)));

  // Check for modal/overlay dialogs
  console.log("\n=== MODALS/OVERLAYS ===");
  const modals = await page.evaluate(() => {
    const sels = ".ui-dialog, .modal, [class*='popup'], [class*='overlay'], [class*='dialog'], #popups, .popups-box, .popups-container";
    return Array.from(document.querySelectorAll(sels)).map(el => ({
      tag: el.tagName, id: el.id,
      classes: el.className.toString().substring(0, 100),
      visible: el.offsetParent !== null,
      width: el.offsetWidth,
      height: el.offsetHeight,
      childCount: el.children.length,
      text: el.innerText.substring(0, 200),
    })).filter(el => el.visible || el.width > 0);
  });
  modals.forEach(m => console.log(JSON.stringify(m)));

  // Check for new form inputs on the page (might have loaded inline)
  console.log("\n=== NEW FORM INPUTS ON PAGE ===");
  const newInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("input, textarea, select")).map(el => ({
      tag: el.tagName, type: el.type, name: el.name, id: el.id,
      visible: el.offsetParent !== null,
      classes: el.className.toString().substring(0, 60),
    })).filter(el => el.visible);
  });
  newInputs.forEach(i => console.log(JSON.stringify(i)));
} else {
  console.log("ERROR: Cannot find 'Add File/Link' option");
}

await browser.close();
console.log("\nDone.");

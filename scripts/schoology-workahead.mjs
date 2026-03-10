#!/usr/bin/env node
/**
 * schoology-workahead.mjs — Create "work-ahead/future" folder, move Thursday into it,
 * and recreate Friday 3/20/26 (7.2) with all its links.
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";

const COURSE_ID = "7945275782";
const MATERIALS_URL = `https://lynnschools.schoology.com/course/${COURSE_ID}/materials`;

// 7.2 links to recreate
const FRIDAY_LINKS = [
  { title: "Live Worksheet — 7.2", url: "https://robjohncolson.github.io/apstats-live-worksheet/u7_lesson2_live.html" },
  { title: "Drills — 7.2", url: "https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u7-mean-ci&level=l01-identify-procedure" },
  { title: "Quiz — 7.2", url: "https://robjohncolson.github.io/curriculum_render/?u=7&l=1" },
  { title: "Blooket — 7.2", url: "https://dashboard.blooket.com/set/69aee24b0d5874349dbc4469" },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForPopup(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hasPopup = await page.evaluate(() => {
      const popup = document.querySelector('.popups-box');
      return popup && popup.style.display !== 'none' && popup.offsetParent !== null;
    });
    if (hasPopup) return true;
    await sleep(500);
  }
  return false;
}

async function waitForPopupClose(page, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const noPopup = await page.evaluate(() => {
        const popup = document.querySelector('.popups-box');
        return !popup || popup.style.display === 'none';
      });
      if (noPopup) return true;
    } catch {
      // Navigation destroyed context — popup is gone
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  const step = process.argv[2] || "all";
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology.com" });

  try {
    if (step === "scout" || step === "all") {
      await scout(page);
    }
    if (step === "create" || step === "all") {
      await createWorkAheadFolder(page);
    }
    if (step === "move" || step === "all") {
      await moveThursday(page);
    }
    if (step === "friday" || step === "all") {
      await createFridayFolder(page);
    }
    if (step === "links" || step === "all") {
      await postFridayLinks(page);
    }
  } finally {
    console.log("\nDone. Disconnecting from browser (CDP). Browser remains open.");
    await browser?.close().catch(() => {});
  }
}

async function scout(page) {
  console.log("\n=== SCOUT: Checking current state ===\n");
  await page.goto(MATERIALS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  const topLevel = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    return Array.from(rows).map(r => ({
      id: r.id.replace('f-', ''),
      name: r.querySelector('.item-title a, td a')?.textContent?.trim() || ''
    }));
  });
  console.log("Top-level folders:");
  topLevel.forEach(f => console.log(`  [${f.id}] ${f.name}`));

  // Check if work-ahead/future already exists
  const exists = topLevel.some(f => f.name === "work-ahead/future");
  console.log(`\nwork-ahead/future exists: ${exists}`);
  return { topLevel, workAheadExists: exists };
}

async function createWorkAheadFolder(page) {
  console.log("\n=== STEP 1: Create 'work-ahead/future' folder at top level ===\n");

  // Go to top level
  await page.goto(MATERIALS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Check if it already exists
  const exists = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    return Array.from(rows).some(r => {
      const a = r.querySelector('.item-title a, td a');
      return a && a.textContent.trim() === "work-ahead/future";
    });
  });

  if (exists) {
    console.log("  'work-ahead/future' already exists. Skipping creation.");
    return;
  }

  // Click "Add Materials"
  console.log("  Clicking Add Materials...");
  await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const s of spans) {
      if (s.textContent.trim() === 'Add Materials') {
        s.click();
        return;
      }
    }
  });
  await sleep(2000);

  // Click "Add Folder"
  console.log("  Clicking Add Folder...");
  await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.textContent.trim() === 'Add Folder') {
        a.click();
        return;
      }
    }
  });

  // Wait for popup
  console.log("  Waiting for folder creation popup...");
  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    console.error("  Popup did not appear!");
    return;
  }
  await sleep(1000);

  // Inspect the popup form
  const formInfo = await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return { error: 'no popup' };

    const inputs = popup.querySelectorAll('input, select, textarea');
    const colorEls = popup.querySelectorAll('[class*="color"], .color-picker, .folder-color-option');

    return {
      html: popup.innerHTML.substring(0, 3000),
      inputs: Array.from(inputs).map(el => ({
        tag: el.tagName, type: el.type, id: el.id, name: el.name,
        options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => ({ val: o.value, text: o.textContent.trim() })) : undefined
      })),
      colorElements: Array.from(colorEls).map(el => ({
        tag: el.tagName, cls: el.className, id: el.id
      }))
    };
  });
  console.log("  Form info:", JSON.stringify(formInfo, null, 2));

  // Fill the title
  const titleField = await page.$('#edit-title');
  if (titleField) {
    await titleField.fill("work-ahead/future");
    console.log("  Filled title: work-ahead/future");
  } else {
    console.error("  Could not find #edit-title!");
    return;
  }

  // Try to set a different color (look for color select or color picker)
  const colorSet = await page.evaluate(() => {
    // Check for a color select dropdown
    const colorSelect = document.querySelector('#edit-color, select[name="color"], select[name*="color"]');
    if (colorSelect) {
      // Look for a non-blue option
      for (const opt of colorSelect.options) {
        if (opt.value && opt.value !== 'blue') {
          colorSelect.value = opt.value;
          colorSelect.dispatchEvent(new Event('change', { bubbles: true }));
          return { method: 'select', value: opt.value };
        }
      }
    }
    // Check for clickable color swatches
    const swatches = document.querySelectorAll('.folder-color-option, .color-swatch, [data-color]');
    if (swatches.length > 0) {
      // Click one that's not blue
      for (const s of swatches) {
        const color = s.dataset?.color || s.className;
        if (!color.includes('blue')) {
          s.click();
          return { method: 'swatch', color };
        }
      }
    }
    return { method: 'none' };
  });
  console.log("  Color setting:", JSON.stringify(colorSet));

  // Click Create/Submit
  await sleep(500);
  const submitted = await page.evaluate(() => {
    const btn = document.querySelector('#edit-submit');
    if (btn) { btn.click(); return 'edit-submit'; }
    const submit = document.querySelector('.popups-box input[type="submit"], .popups-box button[type="submit"]');
    if (submit) { submit.click(); return 'fallback submit'; }
    return 'not found';
  });
  console.log("  Submitted via:", submitted);

  await waitForPopupClose(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2000);

  // Verify
  const created = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim() === "work-ahead/future") {
        return { id: r.id.replace('f-', ''), name: a.textContent.trim() };
      }
    }
    return null;
  });

  if (created) {
    console.log(`  SUCCESS: Created folder "work-ahead/future" (ID: ${created.id})`);
  } else {
    console.log("  WARNING: Could not verify folder creation. Listing all folders...");
    const all = await page.evaluate(() => {
      const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
      return Array.from(rows).map(r => r.querySelector('.item-title a, td a')?.textContent?.trim() || '');
    });
    console.log("  Folders:", all);
  }
}

async function moveThursday(page) {
  console.log("\n=== STEP 2: Move 'Thursday 3/19/26' into 'work-ahead/future' ===\n");

  // Navigate to week 25 where Thursday lives
  const w25Url = MATERIALS_URL + "?f=986776304";
  await page.goto(w25Url, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Find Thursday folder
  const thursdayRow = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim().includes('Thursday 3/19')) {
        return { id: r.id, folderId: r.id.replace('f-', ''), name: a.textContent.trim() };
      }
    }
    return null;
  });

  if (!thursdayRow) {
    console.log("  Thursday 3/19/26 not found in week 25. It may have already been moved.");
    return;
  }
  console.log(`  Found: ${thursdayRow.name} (${thursdayRow.id})`);

  // Click the gear icon for this row
  console.log("  Clicking gear icon...");
  await page.click(`#${thursdayRow.id} .action-links-unfold`);
  await sleep(1500);

  // Click Move
  console.log("  Clicking Move...");
  await page.click(`#${thursdayRow.id} a.move-material`);

  // Wait for Move popup
  const movePopup = await waitForPopup(page);
  if (!movePopup) {
    console.error("  Move popup did not appear!");
    return;
  }
  await sleep(1500);

  // Inspect move popup — find the dropdown and select "work-ahead/future"
  const moveInfo = await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return { error: 'no popup' };

    const selects = popup.querySelectorAll('select');
    const result = { selectCount: selects.length, options: [] };

    for (const sel of selects) {
      for (const opt of sel.options) {
        result.options.push({ value: opt.value, text: opt.textContent.trim(), selId: sel.id, selName: sel.name });
      }
    }
    return result;
  });
  console.log("  Move popup options:", JSON.stringify(moveInfo, null, 2));

  // Select "work-ahead/future" from dropdown
  const selected = await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return { error: 'no popup' };

    const selects = popup.querySelectorAll('select');
    for (const sel of selects) {
      for (const opt of sel.options) {
        if (opt.textContent.trim().includes('work-ahead/future')) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return { found: true, value: opt.value, text: opt.textContent.trim() };
        }
      }
    }
    return { found: false };
  });

  if (!selected.found) {
    console.error("  Could not find 'work-ahead/future' in move dropdown!");
    console.log("  Available:", moveInfo.options.map(o => o.text));
    return;
  }
  console.log(`  Selected target: "${selected.text}"`);

  // Click Move submit button
  await sleep(500);
  const moveClicked = await page.evaluate(() => {
    const popup = document.querySelector('.popups-box');
    if (!popup) return 'no popup';
    // Look for submit button
    const btn = popup.querySelector('input[type="submit"], button[type="submit"]');
    if (btn) { btn.click(); return btn.value || btn.textContent.trim(); }
    return 'not found';
  });
  console.log("  Clicked move button:", moveClicked);

  await waitForPopupClose(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2000);
  console.log("  Move completed!");
}

async function createFridayFolder(page) {
  console.log("\n=== STEP 3: Create 'Friday 3/20/26' folder inside 'work-ahead/future' ===\n");

  // First find the work-ahead/future folder ID
  await page.goto(MATERIALS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  const waFolder = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim() === "work-ahead/future") {
        return { id: r.id.replace('f-', ''), href: a.href };
      }
    }
    return null;
  });

  if (!waFolder) {
    console.error("  work-ahead/future folder not found!");
    return;
  }

  // Navigate into work-ahead/future
  const waUrl = MATERIALS_URL + "?f=" + waFolder.id;
  await page.goto(waUrl, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Check if Friday already exists
  const fridayExists = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    return Array.from(rows).some(r => {
      const a = r.querySelector('.item-title a, td a');
      return a && a.textContent.trim().includes('Friday 3/20');
    });
  });

  if (fridayExists) {
    console.log("  'Friday 3/20/26' already exists. Skipping.");
    return;
  }

  // Create the Friday folder
  console.log("  Clicking Add Materials...");
  await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const s of spans) {
      if (s.textContent.trim() === 'Add Materials') { s.click(); return; }
    }
  });
  await sleep(2000);

  console.log("  Clicking Add Folder...");
  await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.textContent.trim() === 'Add Folder') { a.click(); return; }
    }
  });

  const popupLoaded = await waitForPopup(page);
  if (!popupLoaded) {
    console.error("  Popup did not appear!");
    return;
  }
  await sleep(1000);

  // Fill title
  const titleField = await page.$('#edit-title');
  if (titleField) {
    await titleField.fill("Friday 3/20/26");
    console.log("  Filled title: Friday 3/20/26");
  }

  // Submit
  await sleep(500);
  await page.evaluate(() => {
    const btn = document.querySelector('#edit-submit');
    if (btn) btn.click();
  });

  await waitForPopupClose(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2000);

  const fridayFolder = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim().includes('Friday 3/20')) {
        return { id: r.id.replace('f-', ''), name: a.textContent.trim() };
      }
    }
    return null;
  });

  if (fridayFolder) {
    console.log(`  SUCCESS: Created "Friday 3/20/26" (ID: ${fridayFolder.id})`);
  } else {
    console.log("  WARNING: Could not verify folder creation.");
  }
}

async function postFridayLinks(page) {
  console.log("\n=== STEP 4: Post links into Friday 3/20/26 folder ===\n");

  // Find work-ahead/future folder
  await page.goto(MATERIALS_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  const waFolder = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim() === "work-ahead/future") {
        return r.id.replace('f-', '');
      }
    }
    return null;
  });

  if (!waFolder) {
    console.error("  work-ahead/future not found!");
    return;
  }

  // Navigate into work-ahead/future
  await page.goto(MATERIALS_URL + "?f=" + waFolder, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Find Friday folder
  const fridayId = await page.evaluate(() => {
    const rows = document.querySelectorAll('#folder-contents-table > tbody > tr[id^="f-"]');
    for (const r of rows) {
      const a = r.querySelector('.item-title a, td a');
      if (a && a.textContent.trim().includes('Friday 3/20')) {
        return r.id.replace('f-', '');
      }
    }
    return null;
  });

  if (!fridayId) {
    console.error("  Friday 3/20/26 folder not found!");
    return;
  }

  // Navigate into Friday folder
  await page.goto(MATERIALS_URL + "?f=" + fridayId, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(2000);

  // Post each link
  for (const link of FRIDAY_LINKS) {
    console.log(`  Posting: ${link.title} → ${link.url}`);

    // Click Add Materials
    await page.evaluate(() => {
      const spans = document.querySelectorAll('span');
      for (const s of spans) {
        if (s.textContent.trim() === 'Add Materials') { s.click(); return; }
      }
    });
    await sleep(1500);

    // Click "Add File/Link/External Tool"
    await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        if (a.textContent.trim().includes('File/Link/External Tool')) { a.click(); return; }
      }
    });
    await sleep(1500);

    // Click "Link" option
    await page.evaluate(() => {
      // First try the specific class
      const specific = document.querySelector('a.action-create-link');
      if (specific) { specific.click(); return; }
      // Fallback: find by text
      const links = document.querySelectorAll('a');
      for (const a of links) {
        const txt = a.textContent.trim();
        if (txt === 'Link' && a.offsetParent !== null) {
          a.click();
          return;
        }
      }
    });

    const popupLoaded = await waitForPopup(page);
    if (!popupLoaded) {
      console.error(`    Popup did not appear for ${link.title}!`);
      continue;
    }
    await sleep(1000);

    // Fill URL
    const urlField = await page.$('#edit-link');
    if (urlField) {
      await urlField.fill(link.url);
    }
    await sleep(500);

    // Fill title
    const titleField = await page.$('#edit-link-title');
    if (titleField) {
      await titleField.fill(link.title);
    }
    await sleep(500);

    // Submit
    await page.evaluate(() => {
      const btn = document.querySelector('#edit-submit');
      if (btn) btn.click();
    });

    await waitForPopupClose(page);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(2000);
    console.log(`    ✓ Posted: ${link.title}`);

    // Re-navigate into the Friday folder (page may have navigated away after submit)
    const currentUrl = page.url();
    if (!currentUrl.includes("f=" + fridayId)) {
      console.log("    Re-navigating into Friday folder...");
      await page.goto(MATERIALS_URL + "?f=" + fridayId, { waitUntil: "networkidle", timeout: 30000 });
      await sleep(2000);
    }
  }

  console.log("\n  All links posted!");
}

main().catch(e => { console.error(e); process.exit(1); });

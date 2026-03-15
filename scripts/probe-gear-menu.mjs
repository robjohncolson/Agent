#!/usr/bin/env node
/**
 * probe-gear-menu.mjs — Inspect gear menu DOM for the 2 remaining stale links.
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";

const TARGETS = [
  { label: "6.11 B", linkId: "8286302261", url: "https://lynnschools.schoology.com/course/7945275782/materials?f=986588515" },
  { label: "6.11 E", linkId: "8288287536", url: "https://lynnschools.schoology.com/course/7945275798/materials?f=986897040" },
];

async function probeGear(page, target) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`Probing gear menu: ${target.label} — Link ${target.linkId}`);
  console.log("=".repeat(70));

  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // Step 1: Find the row and inspect its structure
  const rowInfo = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    if (!anchor) return { found: false };

    const tr = anchor.closest("tr");
    if (!tr) {
      // Walk up
      const ancestors = [];
      let el = anchor.parentElement;
      for (let i = 0; i < 8 && el; i++) {
        ancestors.push({ tag: el.tagName, classes: el.className?.slice(0, 100), id: el.id || null });
        el = el.parentElement;
      }
      return { found: true, hasTr: false, ancestors };
    }

    // Dump the action cell
    const actionCell = tr.querySelector(".folder-contents-cell.actions") ||
                       tr.querySelector("td:last-child");
    const actionHTML = actionCell ? actionCell.innerHTML : "NO ACTION CELL";

    // Find gear-like elements
    const gearCandidates = [];
    for (const el of tr.querySelectorAll("*")) {
      const cls = el.className || "";
      if (cls.includes("action") || cls.includes("gear") || cls.includes("options") ||
          cls.includes("toggle") || cls.includes("unfold") || cls.includes("kebab")) {
        gearCandidates.push({
          tag: el.tagName,
          classes: cls.slice(0, 100),
          text: el.textContent.trim().slice(0, 60),
          title: el.title || el.getAttribute("aria-label") || null,
        });
      }
    }

    return {
      found: true,
      hasTr: true,
      trClasses: tr.className,
      trId: tr.id || null,
      actionCellHTML: actionHTML.slice(0, 2000),
      gearCandidates,
    };
  }, target.linkId);

  console.log("\n--- Row structure ---");
  console.log(JSON.stringify(rowInfo, null, 2));

  if (!rowInfo.found || !rowInfo.hasTr) return;

  // Step 2: Try clicking the gear via dispatchEvent (not .click())
  console.log("\n--- Attempting gear click via dispatchEvent ---");
  const clickResult = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    const tr = anchor.closest("tr");

    // Try multiple selectors
    const gear = tr.querySelector(".action-links-unfold") ||
                 tr.querySelector("[class*='action-links'] [class*='unfold']") ||
                 tr.querySelector(".options-hover a") ||
                 tr.querySelector("td.actions a") ||
                 tr.querySelector("td:last-child a:first-child");

    if (!gear) return { clicked: false, reason: "no gear element found" };

    // Try mousedown + mouseup + click sequence
    gear.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    gear.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    return {
      clicked: true,
      gearTag: gear.tagName,
      gearClass: gear.className?.slice(0, 100),
      gearText: gear.textContent.trim().slice(0, 40),
    };
  }, target.linkId);

  console.log(JSON.stringify(clickResult, null, 2));

  await page.waitForTimeout(1500);

  // Step 3: Look for dropdown/menu that appeared
  const dropdownInfo = await page.evaluate((id) => {
    const anchor = document.querySelector(`a[href*="/link/view/${id}"]`);
    const tr = anchor?.closest("tr");

    // Check within row
    const inRow = tr ? [...tr.querySelectorAll("ul, [role='menu'], [class*='dropdown'], [class*='action-links-content']")]
      .map(d => ({
        tag: d.tagName,
        classes: d.className?.slice(0, 100),
        visible: d.offsetParent !== null && d.style.display !== "none",
        display: getComputedStyle(d).display,
        items: [...d.querySelectorAll("a, li, button")].map(i => ({
          tag: i.tagName,
          text: i.textContent.trim().slice(0, 40),
          href: i.href || null,
        })),
      })) : [];

    // Check globally for any visible dropdown
    const global = [...document.querySelectorAll("ul.action-links-content, [class*='popups-box'], .s-js-popups-box")]
      .filter(d => {
        const style = getComputedStyle(d);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map(d => ({
        tag: d.tagName,
        classes: d.className?.slice(0, 100),
        items: [...d.querySelectorAll("a, li")].map(i => ({
          tag: i.tagName,
          text: i.textContent.trim().slice(0, 40),
          href: i.href || null,
        })),
      }));

    return { inRow, global };
  }, target.linkId);

  console.log("\n--- Dropdown after click ---");
  console.log(JSON.stringify(dropdownInfo, null, 2));

  // Step 4: Try Playwright's native click on the gear (bypasses JS event issues)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  console.log("\n--- Attempting Playwright locator click ---");
  try {
    const gearLocator = page.locator(`tr:has(a[href*="/link/view/${target.linkId}"]) .action-links-unfold`);
    const count = await gearLocator.count();
    console.log(`Locator found: ${count} elements`);

    if (count > 0) {
      await gearLocator.first().click({ timeout: 5000 });
      await page.waitForTimeout(1500);

      const menu = await page.evaluate(() => {
        const visible = [...document.querySelectorAll("ul")]
          .filter(u => {
            const s = getComputedStyle(u);
            return s.display !== "none" && s.visibility !== "hidden" && u.offsetParent !== null;
          })
          .map(u => ({
            classes: u.className?.slice(0, 100),
            items: [...u.querySelectorAll("a")].map(a => a.textContent.trim().slice(0, 40)),
          }));
        return visible;
      });
      console.log("Visible menus after Playwright click:");
      console.log(JSON.stringify(menu, null, 2));
    }
  } catch (e) {
    console.log(`Playwright click failed: ${e.message}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

async function main() {
  const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

  for (const target of TARGETS) {
    await probeGear(page, target);
  }

  console.log("\nProbe complete.");
}

main().catch(e => {
  console.error("Probe failed:", e.message);
  process.exit(1);
});

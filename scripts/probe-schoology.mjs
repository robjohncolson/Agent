/**
 * probe-schoology.mjs — DEBUG TOOL
 *
 * Connects to a running browser via CDP and dumps Schoology DOM state:
 * current URL, course info, "Add Materials" buttons, form elements.
 * Useful for discovering selectors needed for automated link posting.
 *
 * Usage:  node scripts/probe-schoology.mjs
 * Requires Edge/Chrome running with --remote-debugging-port=9222.
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("schoology")) || ctx.pages()[0];

console.log("=== CURRENT PAGE ===");
console.log("URL:", page.url());
console.log("Title:", await page.title());

// Find all buttons
console.log("\n=== BUTTONS (with text) ===");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button, a.btn, a.button, [role='button'], input[type='submit'], input[type='button']")).map(b => ({
    tag: b.tagName,
    text: b.innerText.trim().substring(0, 80),
    ariaLabel: b.getAttribute("aria-label"),
    id: b.id,
    classes: b.className.toString().substring(0, 100),
    href: b.href || null,
    title: b.getAttribute("title"),
    visible: b.offsetParent !== null,
  })).filter(b => b.text || b.ariaLabel || b.id);
});
buttons.forEach(b => console.log(JSON.stringify(b)));

// Find links that might be "Add" actions
console.log("\n=== ADD/CREATE LINKS ===");
const addLinks = await page.evaluate(() => {
  const all = document.querySelectorAll("a, button, [role='button'], [role='menuitem']");
  return Array.from(all).filter(el => {
    const text = (el.innerText || "").toLowerCase();
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    return text.includes("add") || text.includes("create") || text.includes("new") ||
           label.includes("add") || label.includes("create") || label.includes("new");
  }).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 80),
    id: el.id,
    classes: el.className.toString().substring(0, 100),
    href: el.href || null,
    ariaLabel: el.getAttribute("aria-label"),
    visible: el.offsetParent !== null,
  }));
});
addLinks.forEach(l => console.log(JSON.stringify(l)));

// Find dropdowns and menus
console.log("\n=== DROPDOWNS/MENUS ===");
const menus = await page.evaluate(() => {
  const sels = "[class*='dropdown'], [class*='menu'], [class*='popover'], [role='menu'], [role='listbox'], select";
  return Array.from(document.querySelectorAll(sels)).map(el => ({
    tag: el.tagName,
    id: el.id,
    classes: el.className.toString().substring(0, 100),
    childCount: el.children.length,
    visible: el.offsetParent !== null,
    text: el.innerText.trim().substring(0, 100),
  })).filter(el => el.visible || el.childCount > 0);
});
menus.forEach(m => console.log(JSON.stringify(m)));

// Find any forms
console.log("\n=== FORMS ===");
const forms = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("form")).map(f => ({
    id: f.id,
    action: f.action,
    method: f.method,
    classes: f.className.toString().substring(0, 100),
    inputCount: f.querySelectorAll("input, textarea, select").length,
  }));
});
forms.forEach(f => console.log(JSON.stringify(f)));

// Find the course/section info from the page
console.log("\n=== COURSE INFO ===");
const courseInfo = await page.evaluate(() => {
  // Look for course title
  const titleEl = document.querySelector("h1, h2, .course-title, .page-title, [class*='course-name']");
  const title = titleEl ? titleEl.innerText.trim() : "(not found)";

  // Extract course ID from URL
  const urlMatch = window.location.pathname.match(/\/course\/(\d+)/);
  const courseId = urlMatch ? urlMatch[1] : "(not in URL)";

  // Look for breadcrumbs
  const breadcrumbs = Array.from(document.querySelectorAll("[class*='breadcrumb'] a, nav a")).map(a => a.innerText.trim()).filter(t => t.length > 0);

  return { title, courseId, url: window.location.href, breadcrumbs };
});
console.log(JSON.stringify(courseInfo, null, 2));

// Find material/content items already on the page
console.log("\n=== EXISTING MATERIALS (first 10) ===");
const materials = await page.evaluate(() => {
  const items = document.querySelectorAll("[class*='material'], [class*='content-item'], [class*='s-edge'], li.type-link, li.type-document, li[class*='folder'], .folder-contents-item");
  return Array.from(items).slice(0, 10).map(el => ({
    tag: el.tagName,
    classes: el.className.toString().substring(0, 80),
    text: el.innerText.trim().substring(0, 100),
  }));
});
materials.forEach(m => console.log(JSON.stringify(m)));

// Dump the main content area structure
console.log("\n=== MAIN CONTENT STRUCTURE ===");
const structure = await page.evaluate(() => {
  const main = document.querySelector("main, #main, .main-content, #center-top, #content-wrapper, .content-wrapper");
  if (!main) return { found: false };
  return {
    found: true,
    tag: main.tagName,
    id: main.id,
    classes: main.className.toString().substring(0, 100),
    directChildTags: Array.from(main.children).map(c => `${c.tagName}${c.id ? '#'+c.id : ''}${c.className ? '.'+c.className.toString().split(' ')[0] : ''}`).slice(0, 15),
  };
});
console.log(JSON.stringify(structure, null, 2));

await browser.close();
console.log("\nDone. Browser connection closed (Edge stays open).");

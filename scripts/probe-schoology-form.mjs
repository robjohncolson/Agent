/**
 * probe-schoology-form.mjs — Probe the "Add File/Link" form in Schoology
 */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("schoology")) || ctx.pages()[0];

console.log("Current URL:", page.url());

// Navigate to the Add File/Link page
const formUrl = "https://lynnschools.schoology.com/course/7945275782/materials/documents/add/document";
console.log("Navigating to:", formUrl);
await page.goto(formUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);

console.log("Loaded:", page.url());
console.log("Title:", await page.title());

// Find all form inputs
console.log("\n=== FORM INPUTS ===");
const inputs = await page.evaluate(() => {
  const els = document.querySelectorAll("input, textarea, select");
  return Array.from(els).map(el => ({
    tag: el.tagName,
    type: el.type || null,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder || null,
    label: el.getAttribute("aria-label") || null,
    classes: el.className.toString().substring(0, 80),
    value: el.value.substring(0, 50),
    visible: el.offsetParent !== null,
  })).filter(el => el.visible || el.name || el.id);
});
inputs.forEach(i => console.log(JSON.stringify(i)));

// Find labels
console.log("\n=== FORM LABELS ===");
const labels = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("label")).map(l => ({
    text: l.innerText.trim().substring(0, 80),
    for: l.getAttribute("for"),
    visible: l.offsetParent !== null,
  })).filter(l => l.visible);
});
labels.forEach(l => console.log(JSON.stringify(l)));

// Find submit buttons
console.log("\n=== SUBMIT BUTTONS ===");
const submits = await page.evaluate(() => {
  const els = document.querySelectorAll("input[type='submit'], button[type='submit'], .form-submit, .submit-button, a.form-button");
  return Array.from(els).map(el => ({
    tag: el.tagName,
    text: el.innerText?.trim() || el.value,
    id: el.id,
    name: el.name,
    classes: el.className.toString().substring(0, 80),
    visible: el.offsetParent !== null,
  }));
});
submits.forEach(s => console.log(JSON.stringify(s)));

// Find tabs or type selectors (File vs Link vs External Tool)
console.log("\n=== TABS/TYPE SELECTORS ===");
const tabs = await page.evaluate(() => {
  const els = document.querySelectorAll("[class*='tab'], [role='tab'], [class*='type-select'], .vertical-tabs-list a, .horizontal-tabs-list a, .nav-tabs a");
  return Array.from(els).map(el => ({
    tag: el.tagName,
    text: el.innerText.trim().substring(0, 60),
    href: el.href || null,
    classes: el.className.toString().substring(0, 80),
    ariaSelected: el.getAttribute("aria-selected"),
    visible: el.offsetParent !== null,
  })).filter(el => el.text);
});
tabs.forEach(t => console.log(JSON.stringify(t)));

// Find any radio buttons or type toggles
console.log("\n=== RADIO BUTTONS ===");
const radios = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("input[type='radio']")).map(r => ({
    name: r.name,
    value: r.value,
    id: r.id,
    checked: r.checked,
    label: r.parentElement?.innerText?.trim().substring(0, 60) || null,
  }));
});
radios.forEach(r => console.log(JSON.stringify(r)));

// Dump the form structure
console.log("\n=== FORM ELEMENT ===");
const formInfo = await page.evaluate(() => {
  const form = document.querySelector("form:not([id='search-theme-form']):not([id='search-block-form'])");
  if (!form) return { found: false };
  return {
    found: true,
    id: form.id,
    action: form.action,
    method: form.method,
    classes: form.className.toString().substring(0, 100),
    html: form.innerHTML.substring(0, 2000),
  };
});
if (formInfo.found) {
  console.log("Form ID:", formInfo.id);
  console.log("Action:", formInfo.action);
  console.log("Method:", formInfo.method);
  console.log("HTML preview (first 2000 chars):");
  console.log(formInfo.html);
}

await browser.close();
console.log("\nDone.");

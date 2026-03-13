#!/usr/bin/env node
/**
 * resolve-blooket-urls.mjs — Resolve actual Blooket URLs from Schoology link pages.
 *
 * For each registry entry missing urls.blooket but having a Schoology blooket material,
 * navigates to the Schoology link page and extracts the target URL.
 *
 * Usage:
 *   node scripts/resolve-blooket-urls.mjs [--dry-run] [--topic 6.3]
 */

import { chromium } from "playwright";
import { connectCDP } from "./lib/cdp-connect.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_ROOT } from "./lib/paths.mjs";

const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const topicFilter = args.includes("--topic") ? args[args.indexOf("--topic") + 1] : null;

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

// Find entries missing urls.blooket but with a Schoology blooket material
const targets = [];
for (const [key, entry] of Object.entries(registry)) {
  if (topicFilter && key !== topicFilter) continue;
  if (entry.urls && entry.urls.blooket) continue; // already has URL

  // Check if Schoology has a blooket material with an href we can visit
  for (const period of ["B", "E"]) {
    const mat = entry.schoology?.[period]?.materials?.blooket;
    if (mat && mat.href) {
      targets.push({ topic: key, period, href: mat.href, schoologyId: mat.schoologyId });
      break; // only need one, they should point to the same Blooket set
    }
  }
}

if (targets.length === 0) {
  console.log("No entries need Blooket URL resolution.");
  process.exit(0);
}

console.log(`Found ${targets.length} entries to resolve:`);
for (const t of targets) console.log(`  ${t.topic} (${t.period}): ${t.href}`);

if (dryRun) {
  console.log("Dry run — exiting.");
  process.exit(0);
}

const { browser, page } = await connectCDP(chromium, { preferUrl: "schoology" });

const results = [];

for (const t of targets) {
  console.log(`\nResolving ${t.topic}...`);
  try {
    await page.goto(t.href, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Schoology external link pages typically show the URL or redirect.
    // Try multiple strategies to find the Blooket URL.

    // Strategy 1: Check if we got redirected to Blooket
    const currentUrl = page.url();
    if (currentUrl.includes("blooket.com")) {
      console.log(`  Redirected to: ${currentUrl}`);
      results.push({ topic: t.topic, url: currentUrl });
      continue;
    }

    // Strategy 2: Look for the link URL in the page content
    const blooketUrl = await page.evaluate(() => {
      // Check all links on the page
      const links = Array.from(document.querySelectorAll("a"));
      for (const a of links) {
        if (a.href && a.href.includes("blooket.com")) return a.href;
      }
      // Check for iframe src
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const f of iframes) {
        if (f.src && f.src.includes("blooket.com")) return f.src;
      }
      // Check meta refresh
      const meta = document.querySelector('meta[http-equiv="refresh"]');
      if (meta) {
        const content = meta.getAttribute("content") || "";
        const match = content.match(/url=(.*)/i);
        if (match && match[1].includes("blooket.com")) return match[1];
      }
      // Check for .link-url or similar Schoology elements
      const linkUrl = document.querySelector(".link-url, .external-link-url, .infoarea .url");
      if (linkUrl && linkUrl.textContent.includes("blooket.com")) return linkUrl.textContent.trim();

      // Check the info-body for URL text
      const infoBody = document.querySelector(".info-body, .link-body, .s-page-content");
      if (infoBody) {
        const text = infoBody.textContent;
        const m = text.match(/(https?:\/\/[^\s]*blooket\.com[^\s]*)/);
        if (m) return m[1];
      }
      return null;
    });

    if (blooketUrl) {
      // Extract clean Blooket URL from Schoology redirect wrappers
      let cleanUrl = blooketUrl;
      const pathMatch = blooketUrl.match(/path=([^&]+)/);
      if (pathMatch) {
        cleanUrl = decodeURIComponent(pathMatch[1]);
      }
      console.log(`  Found URL: ${cleanUrl}`);
      results.push({ topic: t.topic, url: cleanUrl });
    } else {
      console.log(`  Could not find Blooket URL on page. Current URL: ${currentUrl}`);
      // Dump some page content for debugging
      const title = await page.title();
      console.log(`  Page title: ${title}`);
    }
  } catch (err) {
    console.error(`  Error resolving ${t.topic}: ${err.message}`);
  }
}

// Update registry
if (results.length > 0) {
  console.log(`\nUpdating registry for ${results.length} entries...`);
  for (const r of results) {
    registry[r.topic].urls.blooket = r.url;
    if (registry[r.topic].status) {
      registry[r.topic].status.blooketCsv = "done";
      registry[r.topic].status.blooketUpload = "done";
    }
    console.log(`  ${r.topic}: ${r.url}`);
  }
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
  console.log("Registry saved.");
}

console.log("\nDone.");

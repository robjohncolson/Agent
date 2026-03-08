#!/usr/bin/env node
/**
 * Temporary watcher — connects to Edge CDP and logs page state every 5s.
 * Stops after 3 minutes and prints final URL.
 */
import { connectCDP } from "./lib/cdp-connect.mjs";

const pw = await import("playwright");
const { browser, page } = await connectCDP(pw.chromium, { preferUrl: "blooket" });

console.log("Connected. Current URL:", page.url());
console.log("Watching... (3 min timeout)");

let lastUrl = page.url();
const interval = setInterval(async () => {
  try {
    const url = page.url();
    if (url !== lastUrl) {
      console.log(">> Navigated to:", url);
      lastUrl = url;
    }
    const snippet = await page.evaluate(() =>
      document.body.innerText.replace(/\n/g, " | ").substring(0, 150)
    );
    console.log(`[${new Date().toLocaleTimeString()}]`, snippet);
  } catch (e) {
    console.log("Page not ready:", e.message.substring(0, 60));
  }
}, 5000);

setTimeout(async () => {
  clearInterval(interval);
  const finalUrl = page.url();
  console.log("\n=== DONE ===");
  console.log("Final URL:", finalUrl);

  const setMatch = finalUrl.match(/set\/([a-f0-9]+)/);
  if (setMatch) console.log("BLOOKET SET ID:", setMatch[1]);
  console.log("BLOOKET URL:", finalUrl);

  await browser.close();
  process.exit(0);
}, 180000);

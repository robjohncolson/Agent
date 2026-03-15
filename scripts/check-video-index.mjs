#!/usr/bin/env node
import { readFileSync } from "fs";

const idx = JSON.parse(readFileSync("config/drive-video-index.json", "utf8"));
const topics = {};
for (const v of idx.videos) {
  if (!topics[v.topic]) topics[v.topic] = [];
  topics[v.topic].push(v.filename);
}

const sorted = Object.keys(topics).sort((a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1];
});

console.log(`Indexed topics (${sorted.length}):`);
for (const t of sorted) {
  console.log(`  ${t}: ${topics[t].length} video(s)`);
}

const u7plus = sorted.filter((t) => parseFloat(t) >= 7.0);
console.log(`\nUnit 7+ topics indexed: ${u7plus.length ? u7plus.join(", ") : "NONE"}`);
console.log(`\nDrive folder: ${idx.drive_folder_url}`);
console.log(`Last indexed: ${idx.last_indexed}`);

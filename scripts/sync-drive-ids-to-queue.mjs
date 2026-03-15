#!/usr/bin/env node
/**
 * Unblock queue actions for lessons that have Drive video IDs in the index.
 * Changes status from 'blocked' back to 'pending' for ingest actions
 * (and leaves downstream actions blocked on their deps as normal).
 */

import { readFileSync, writeFileSync } from "fs";

const q = JSON.parse(readFileSync("state/work-queue.json", "utf8"));
const idx = JSON.parse(readFileSync("config/drive-video-index.json", "utf8"));

// Build set of topics that have videos
const topicsWithVideos = new Set(idx.videos.map((v) => v.topic));

const now = new Date().toISOString();
let unblocked = 0;

for (const action of q.actions) {
  if (action.status !== "blocked") continue;

  const topic = `${action.unit}.${action.lesson}`;

  if (action.type === "ingest" && topicsWithVideos.has(topic)) {
    // Ingest can run — Drive IDs exist
    action.status = "pending";
    action.updatedAt = now;
    action.lastError = null;
    unblocked++;
  } else if (action.type !== "ingest") {
    // Downstream actions: set to pending (deps will gate them naturally)
    action.status = "pending";
    action.updatedAt = now;
    action.lastError = null;
    unblocked++;
  }
}

q.stats.completed = q.actions.filter((a) => a.status === "completed").length;
q.stats.pending = q.actions.filter((a) => a.status === "pending").length;
q.stats.blocked = q.actions.filter((a) => a.status === "blocked").length;
q.lastRun = now;

writeFileSync("state/work-queue.json", JSON.stringify(q, null, 2) + "\n");

console.log(`Unblocked ${unblocked} actions`);
console.log(`Stats: completed=${q.stats.completed}, pending=${q.stats.pending}, blocked=${q.stats.blocked}`);

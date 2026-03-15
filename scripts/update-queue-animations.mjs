#!/usr/bin/env node
/**
 * Mark render-animations and upload-animations queue actions as completed
 * for lessons that have rendered mp4s and uploaded to Supabase.
 */

import { readFileSync, writeFileSync } from "fs";

const q = JSON.parse(readFileSync("state/work-queue.json", "utf8"));
const reg = JSON.parse(readFileSync("state/lesson-registry.json", "utf8"));
const now = new Date().toISOString();
let updated = 0;

// Lessons with confirmed renders+uploads
const completedLessons = new Set([
  "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.11",
  "7.1", "7.2",
]);

for (const action of q.actions) {
  if (action.status === "completed") continue;
  if (action.type !== "render-animations" && action.type !== "upload-animations") continue;

  const key = `${action.unit}.${action.lesson}`;
  if (completedLessons.has(key)) {
    action.status = "completed";
    action.completedAt = now;
    action.updatedAt = now;
    updated++;
  }
}

// Recalculate stats
q.stats.completed = q.actions.filter((a) => a.status === "completed").length;
q.stats.pending = q.actions.filter((a) => a.status === "pending").length;
q.stats.failed = q.actions.filter((a) => a.status === "failed").length;
q.lastRun = now;

writeFileSync("state/work-queue.json", JSON.stringify(q, null, 2) + "\n");
console.log(`Updated ${updated} queue actions to completed`);
console.log(`New stats: completed=${q.stats.completed}, pending=${q.stats.pending}`);

// Also update registry animation status
for (const key of completedLessons) {
  if (reg[key] && reg[key].status) {
    if (reg[key].status.animations !== "done") {
      reg[key].status.animations = "done";
      reg[key].timestamps.lastUpdated = now;
      console.log(`Registry ${key}: animations -> done`);
    }
  }
}

writeFileSync("state/lesson-registry.json", JSON.stringify(reg, null, 2) + "\n");
console.log("Registry updated.");

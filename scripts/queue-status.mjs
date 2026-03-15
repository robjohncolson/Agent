#!/usr/bin/env node
import { readFileSync } from "fs";

const q = JSON.parse(readFileSync("state/work-queue.json", "utf8"));
const reg = JSON.parse(readFileSync("state/lesson-registry.json", "utf8"));

const completedIds = new Set(
  q.actions.filter((a) => a.status === "completed").map((a) => a.id)
);

// Unblocked pending
const unblocked = q.actions.filter(
  (a) =>
    a.status !== "completed" &&
    a.dependsOn.every((d) => completedIds.has(d))
);

console.log(`Queue: ${q.stats.completed} completed, ${q.stats.pending} pending\n`);

console.log("Unblocked pending (ready to run):");
for (const a of unblocked) {
  console.log(`  ${a.id}`);
}

// Pending by unit
const pendingByUnit = {};
for (const a of q.actions.filter((a) => a.status !== "completed")) {
  const u = String(a.unit);
  pendingByUnit[u] = (pendingByUnit[u] || 0) + 1;
}
console.log("\nPending by unit:", JSON.stringify(pendingByUnit));

// Check reconciliation: registry says done but queue says pending
console.log("\n=== Reconciliation: registry vs queue ===");
for (const a of q.actions.filter((a) => a.status !== "completed")) {
  const key = `${a.unit}.${a.lesson}`;
  const entry = reg[key];
  if (!entry) continue;

  let regDone = false;
  if (a.type === "ingest" && entry.status?.ingest === "done") regDone = true;
  if (a.type === "content-gen-worksheet" && entry.status?.worksheet === "done") regDone = true;
  if (a.type === "content-gen-blooket" && entry.status?.blooketCsv === "done") regDone = true;
  if (a.type === "content-gen-drills" && entry.status?.drills === "done") regDone = true;
  if (a.type === "render-animations" && entry.status?.animations === "done") regDone = true;
  if (a.type === "upload-animations" && entry.status?.animations === "done") regDone = true;
  if (a.type === "upload-blooket" && entry.status?.blooketUpload === "done") regDone = true;
  if (a.type === "post-schoology-B" && entry.schoology?.B?.materials?.worksheet) regDone = true;
  if (a.type === "post-schoology-E" && entry.schoology?.E?.materials?.worksheet) regDone = true;
  if (a.type === "verify-schoology-B" && entry.schoology?.B?.verifiedAt) regDone = true;
  if (a.type === "verify-schoology-E" && entry.schoology?.E?.verifiedAt) regDone = true;

  if (regDone) {
    console.log(`  MISMATCH: ${a.id} is pending in queue but registry says done`);
  }
}

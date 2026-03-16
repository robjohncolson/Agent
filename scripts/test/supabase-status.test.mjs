import test from "node:test";
import assert from "node:assert/strict";

import { isStatusDowngrade } from "../lib/supabase-schedule.mjs";

test("status downgrades are detected monotonically", () => {
  assert.equal(isStatusDowngrade("posted", "scheduled"), true);
  assert.equal(isStatusDowngrade("scheduled", "posted"), false);
  assert.equal(isStatusDowngrade("posted", "taught"), false);
  assert.equal(isStatusDowngrade("taught", "posted"), true);
  assert.equal(isStatusDowngrade("taught", "scheduled"), true);
});

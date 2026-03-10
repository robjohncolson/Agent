#!/usr/bin/env node
/**
 * create-events-table.mjs — One-time migration: verify or create agent_events table
 *
 * Usage: node scripts/create-events-table.mjs
 *
 * Checks whether agent_events exists in Supabase via the REST API.
 * If the table already exists: exits 0.
 * If not: prints the SQL to run in the Supabase SQL Editor, then exits 1.
 *
 * Expects env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';

// Corporate proxy (Lynn Public Schools) does TLS interception
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ── SQL to create the table (printed if it doesn't exist) ───────────────────

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS agent_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  machine     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  category    TEXT NOT NULL,
  target_repo TEXT,
  task_id     TEXT,
  data        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_created ON agent_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON agent_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_repo ON agent_events(target_repo);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON agent_events
  FOR ALL USING (true) WITH CHECK (true);
`.trim();

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
    process.exit(1);
  }

  const url = `${supabaseUrl}/rest/v1/agent_events?limit=1`;

  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "apikey":        serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
    });
  } catch (err) {
    console.error(`Error: Network request failed — ${err.message}`);
    process.exit(1);
  }

  if (res.ok) {
    console.log("Table agent_events already exists. ✓");
    process.exit(0);
  }

  // 404 from PostgREST means the table/relation is not found
  if (res.status === 404) {
    printMigrationInstructions();
    process.exit(1);
  }

  // Any other non-OK status — surface the error text for diagnosis
  const body = await res.text().catch(() => "(no body)");
  console.error(`Unexpected response from Supabase (HTTP ${res.status}): ${body}`);
  console.error("If this is a permissions error, ensure SUPABASE_SERVICE_ROLE_KEY is set correctly.");
  console.error("");
  printMigrationInstructions();
  process.exit(1);
}

function printMigrationInstructions() {
  console.log("Table agent_events does not exist yet.");
  console.log("");
  console.log("Run the following SQL in the Supabase SQL Editor:");
  console.log("  https://supabase.com/dashboard → your project → SQL Editor");
  console.log("");
  console.log("─".repeat(60));
  console.log(CREATE_SQL);
  console.log("─".repeat(60));
  console.log("");
  console.log("After running the SQL, re-run this script to confirm.");
}

main();

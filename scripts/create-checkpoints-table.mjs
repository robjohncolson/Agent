#!/usr/bin/env node
/**
 * create-checkpoints-table.mjs — One-time migration: verify or create agent_checkpoints table
 *
 * Usage: node scripts/create-checkpoints-table.mjs
 *
 * Checks whether agent_checkpoints exists in Supabase via the REST API.
 * If the table already exists: exits 0.
 * If not: prints the SQL to run in the Supabase SQL Editor, then exits 1.
 *
 * Expects env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';

// ── SQL to create the table (printed if it doesn't exist) ───────────────────

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  machine         TEXT NOT NULL,
  agent_commit    TEXT NOT NULL,
  active_task     TEXT,
  current_project TEXT,
  session_state   JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON agent_checkpoints(created_at DESC);

-- Enable RLS but allow service_role full access (our scripts use service role key)
ALTER TABLE agent_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON agent_checkpoints
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

  const url = `${supabaseUrl}/rest/v1/agent_checkpoints?limit=1`;

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
    console.log("Table agent_checkpoints already exists. ✓");
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
  console.log("Table agent_checkpoints does not exist yet.");
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

#!/usr/bin/env node
/**
 * setup-dashboard.mjs — Verify Supabase tables + RLS policies for dashboard.
 *
 * Usage: node scripts/setup-dashboard.mjs
 *
 * Checks:
 *   1. agent_events table exists
 *   2. agent_checkpoints table exists
 *   3. Anon-role read access works on both tables
 *
 * If anon access fails, prints the SQL to run in the Supabase SQL Editor.
 *
 * Expects env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: SUPABASE_ANON_KEY (tested if present)
 */

import 'dotenv/config';

// Corporate proxy (Lynn Public Schools) does TLS interception
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0';

// ── RLS Policy SQL ──────────────────────────────────────────────────────────

const RLS_SQL = `
-- Enable RLS on both tables (may already be enabled)
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_checkpoints ENABLE ROW LEVEL SECURITY;

-- Allow anon (dashboard) to read events
CREATE POLICY "anon_read_events" ON agent_events
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon (dashboard) to read checkpoints
CREATE POLICY "anon_read_checkpoints" ON agent_checkpoints
  FOR SELECT
  TO anon
  USING (true);
`.trim();

// ── Helpers ─────────────────────────────────────────────────────────────────

async function checkTable(supabaseUrl, apiKey, table) {
  const url = `${supabaseUrl}/rest/v1/${table}?limit=1`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    if (res.ok) return { exists: true, readable: true };
    if (res.status === 404) return { exists: false, readable: false };
    // 401/403 means table exists but key can't read it
    return { exists: true, readable: false, status: res.status };
  } catch (err) {
    return { exists: null, readable: false, error: err.message };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }

  console.log('Dashboard Setup Check');
  console.log('='.repeat(50));
  console.log(`  Supabase URL: ${supabaseUrl}`);
  console.log(`  Service key:  ...${serviceKey.slice(-8)}`);
  console.log(`  Anon key:     ${anonKey ? '...' + anonKey.slice(-8) : 'NOT SET'}`);
  console.log();

  // Step 1: Check tables with service role key
  const tables = ['agent_events', 'agent_checkpoints'];
  let allTablesExist = true;

  for (const table of tables) {
    const result = await checkTable(supabaseUrl, serviceKey, table);
    if (result.exists) {
      console.log(`  [ok] ${table} exists`);
    } else if (result.exists === false) {
      console.log(`  [!!] ${table} NOT FOUND`);
      allTablesExist = false;
    } else {
      console.log(`  [??] ${table} — error: ${result.error}`);
      allTablesExist = false;
    }
  }

  if (!allTablesExist) {
    console.log('\nMissing tables. Run the table creation scripts first:');
    console.log('  node scripts/create-events-table.mjs');
    console.log('  node scripts/create-checkpoints-table.mjs');
    process.exit(1);
  }

  // Step 2: Check anon key read access
  if (!anonKey) {
    console.log('\n  [!!] SUPABASE_ANON_KEY not set in .env');
    console.log('       Get it from: Supabase Dashboard > Settings > API > Project API keys');
    console.log('       Add to .env: SUPABASE_ANON_KEY=eyJ...');
    printRlsInstructions();
    process.exit(1);
  }

  console.log();
  let anonReadOk = true;

  for (const table of tables) {
    const result = await checkTable(supabaseUrl, anonKey, table);
    if (result.readable) {
      console.log(`  [ok] ${table} — anon read OK`);
    } else {
      console.log(`  [!!] ${table} — anon read FAILED (HTTP ${result.status || 'error'})`);
      anonReadOk = false;
    }
  }

  if (!anonReadOk) {
    printRlsInstructions();
    process.exit(1);
  }

  console.log('\n  All checks passed! Dashboard is ready to deploy.');
  console.log('\n  To test locally:');
  console.log('    npx serve dashboard/ -p 3000');
  console.log('\n  To deploy to Railway:');
  console.log('    Set SUPABASE_ANON_KEY env var in Railway project settings');

  process.exit(0);
}

function printRlsInstructions() {
  console.log('\n  RLS policies needed for anon dashboard access.');
  console.log('  Run the following SQL in the Supabase SQL Editor:');
  console.log('    https://supabase.com/dashboard > your project > SQL Editor');
  console.log();
  console.log('─'.repeat(60));
  console.log(RLS_SQL);
  console.log('─'.repeat(60));
  console.log('\n  After running the SQL, re-run this script to confirm.');
}

main();

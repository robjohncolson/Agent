/**
 * agent-startup.mjs — Agent Hub startup freshness check.
 *
 * Detects the current machine, checks if local state is stale vs. Supabase,
 * and auto-pulls if needed. Prints a concise startup summary.
 *
 * Usage: node scripts/agent-startup.mjs
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getLatestCheckpoint, isStale } from './lib/supabase-client.mjs';

// ---------------------------------------------------------------------------
// 1. Resolve repo root
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 2. Read .machine-id
// ---------------------------------------------------------------------------

const machineIdPath = path.join(repoRoot, '.machine-id');
let machineSlug;

try {
  machineSlug = fs.readFileSync(machineIdPath, 'utf8').trim();
  if (!machineSlug) throw new Error('empty');
} catch {
  console.error(
    "No .machine-id found. Create it with: echo 'your-machine-slug' > .machine-id"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Load registry/machines.json
// ---------------------------------------------------------------------------

let machines = {};
try {
  machines = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'registry', 'machines.json'), 'utf8')
  );
} catch {
  console.warn('[startup] Could not load registry/machines.json.');
}

const machineRecord = machines[machineSlug];
if (!machineRecord) {
  console.warn(
    `[startup] Machine slug "${machineSlug}" not found in registry/machines.json. Machine may be new/unregistered.`
  );
}

// ---------------------------------------------------------------------------
// 4. Load registry/machine-paths/<slug>.json
// ---------------------------------------------------------------------------

let machinePaths = null;
const machinePathsFile = path.join(repoRoot, 'registry', 'machine-paths', `${machineSlug}.json`);
try {
  machinePaths = JSON.parse(fs.readFileSync(machinePathsFile, 'utf8'));
} catch {
  console.warn(
    `[startup] No path mapping for machine ${machineSlug}. Repos won't be resolved locally.`
  );
}

// ---------------------------------------------------------------------------
// 5. Get local HEAD commit
// ---------------------------------------------------------------------------

let localCommit = 'unknown';
try {
  localCommit = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
} catch {
  console.warn('[startup] Could not determine local HEAD commit.');
}

// ---------------------------------------------------------------------------
// 6. Staleness check + auto-pull
// ---------------------------------------------------------------------------

try {
  const result = await isStale(localCommit);

  if (result.reason === 'error' || result.reason === 'no-remote-checkpoint') {
    console.log('Supabase check skipped (offline or unconfigured).');
  } else if (result.stale) {
    const localShort = localCommit.slice(0, 7);
    const remoteShort = (result.behind ?? '').slice(0, 7);
    console.log(
      `Local Agent repo is behind (local: ${localShort}, remote: ${remoteShort}). Auto-pulling...`
    );
    try {
      execSync('git pull --ff-only', { cwd: repoRoot, stdio: 'inherit' });
    } catch {
      console.warn('[startup] git pull --ff-only failed. Continuing with local state.');
    }
  } else {
    console.log('Agent repo is up to date.');
  }
} catch {
  console.log('Supabase check skipped (offline or unconfigured).');
}

// ---------------------------------------------------------------------------
// 7. Load state/session.json
// ---------------------------------------------------------------------------

let session = null;
try {
  session = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'state', 'session.json'), 'utf8')
  );
} catch {
  // session.json is optional — silently skip
}

// ---------------------------------------------------------------------------
// 8. Load registry/repos.json
// ---------------------------------------------------------------------------

let repos = {};
try {
  repos = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'registry', 'repos.json'), 'utf8')
  );
} catch {
  console.warn('[startup] Could not load registry/repos.json.');
}

// ---------------------------------------------------------------------------
// 9. Count locally available repos
// ---------------------------------------------------------------------------

let repoAvailable = null;
let repoTotal = null;

if (machinePaths && machinePaths.repos && typeof machinePaths.repos === 'object') {
  const repoPaths = Object.values(machinePaths.repos);
  repoTotal = repoPaths.length;
  repoAvailable = repoPaths.filter((p) => fs.existsSync(p)).length;
}

// ---------------------------------------------------------------------------
// 10. Startup summary
// ---------------------------------------------------------------------------

const hostname = machineRecord?.hostname ?? 'unknown';

let lastCheckpoint = 'none';
let checkpointMachine = '';
try {
  const remote = await getLatestCheckpoint();
  if (remote) {
    lastCheckpoint = remote.created_at ?? 'unknown';
    checkpointMachine = remote.machine ? ` (${remote.machine})` : '';
  }
} catch {
  // Leave as 'none' if Supabase is unreachable
}

const activeTask = session?.active_task ?? 'none';
const reposLine =
  repoAvailable !== null
    ? `${repoAvailable}/${repoTotal} available locally`
    : 'unknown (no machine-paths loaded)';

// Pad label column to align values
function row(label, value) {
  return `${label.padEnd(17)}${value}`;
}

console.log('');
console.log('\u2550\u2550\u2550 Agent Hub \u2550\u2550\u2550');
console.log(row('Machine:', `${machineSlug} (${hostname})`));
console.log(row('Last checkpoint:', `${lastCheckpoint}${checkpointMachine}`));
console.log(row('Active task:', activeTask));
console.log(row('Repos:', reposLine));
console.log('');

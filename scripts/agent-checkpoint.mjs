import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { writeCheckpoint } from './lib/supabase-client.mjs';

// ---------------------------------------------------------------------------
// Top-level try/catch — never crash
// ---------------------------------------------------------------------------
try {
  // -------------------------------------------------------------------------
  // Parse CLI args
  // -------------------------------------------------------------------------
  const args = process.argv.slice(2);
  let trigger = 'manual';
  let taskOverride = null;
  let projectOverride = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--trigger' && args[i + 1]) {
      trigger = args[++i];
    } else if (args[i] === '--task' && args[i + 1]) {
      taskOverride = args[++i];
    } else if (args[i] === '--project' && args[i + 1]) {
      projectOverride = args[++i];
    }
  }

  // -------------------------------------------------------------------------
  // Resolve repo root
  // -------------------------------------------------------------------------
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // -------------------------------------------------------------------------
  // Read .machine-id
  // -------------------------------------------------------------------------
  const machineIdPath = path.join(repoRoot, '.machine-id');
  if (!fs.existsSync(machineIdPath)) {
    console.error('ERROR: .machine-id not found at', machineIdPath);
    process.exit(1);
  }
  const machineId = fs.readFileSync(machineIdPath, 'utf8').trim();

  // -------------------------------------------------------------------------
  // Read state/session.json
  // -------------------------------------------------------------------------
  const sessionPath = path.join(repoRoot, 'state', 'session.json');
  const sessionState = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

  // -------------------------------------------------------------------------
  // Update session state
  // -------------------------------------------------------------------------
  sessionState.last_checkpoint_at = new Date().toISOString();
  sessionState.checkpoint_trigger = trigger;
  if (taskOverride !== null) {
    sessionState.active_task = taskOverride;
  }
  if (projectOverride !== null) {
    sessionState.current_project = projectOverride;
  }

  // -------------------------------------------------------------------------
  // Write updated session.json back to disk
  // -------------------------------------------------------------------------
  fs.writeFileSync(sessionPath, JSON.stringify(sessionState, null, 2) + '\n', 'utf8');

  // -------------------------------------------------------------------------
  // Get HEAD commit
  // -------------------------------------------------------------------------
  let headCommit = 'unknown';
  try {
    headCommit = execSync('git rev-parse HEAD', { cwd: repoRoot }).toString().trim();
  } catch (err) {
    console.warn('Warning: could not read HEAD commit:', err.message);
  }

  // -------------------------------------------------------------------------
  // Write checkpoint to Supabase
  // -------------------------------------------------------------------------
  let supabaseStatus = 'ok';
  const result = await writeCheckpoint(machineId, sessionState);
  if (result.ok) {
    console.log('Supabase checkpoint written.');
  } else {
    supabaseStatus = `warning: ${result.error}`;
    console.warn('Warning: Supabase checkpoint failed:', result.error);
  }

  // -------------------------------------------------------------------------
  // Git operations
  // -------------------------------------------------------------------------
  let gitPushStatus = 'ok';
  let nothingToCommit = false;

  // git add state/session.json
  try {
    execSync('git add state/session.json', { cwd: repoRoot });
  } catch (err) {
    console.warn('Warning: git add failed:', err.message);
  }

  // git commit — only if there are staged changes
  try {
    execSync(
      `git commit -m "checkpoint: ${trigger} (${machineId})"`,
      { cwd: repoRoot }
    );
  } catch (err) {
    const msg = err.message ?? String(err);
    if (msg.includes('nothing to commit') || msg.includes('nothing added')) {
      nothingToCommit = true;
      console.log('Git: nothing to commit.');
    } else {
      console.warn('Warning: git commit failed:', msg);
    }
  }

  // git push — always attempt, even if nothing was committed
  try {
    execSync('git push', { cwd: repoRoot, stdio: 'pipe' });
  } catch (err) {
    gitPushStatus = `warning: ${err.message ?? String(err)}`;
    console.warn('Warning: git push failed:', err.message);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const shortCommit = headCommit === 'unknown' ? 'unknown' : headCommit.slice(0, 7);
  const gitLine = nothingToCommit ? 'nothing to commit' : gitPushStatus;

  console.log(`
Checkpoint complete.
  Machine:  ${machineId}
  Trigger:  ${trigger}
  Commit:   ${shortCommit}
  Supabase: ${supabaseStatus}
  Git push: ${gitLine}`.trimStart());

} catch (topLevelErr) {
  console.error('Unexpected error in agent-checkpoint.mjs:', topLevelErr?.message ?? topLevelErr);
  process.exit(1);
}

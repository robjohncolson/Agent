#!/usr/bin/env node
/**
 * run-pipeline.mjs — CLI entry point for the task runner.
 *
 * Usage:
 *   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5
 *   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --dry-run
 *   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --force
 *   node scripts/run-pipeline.mjs lesson-prep --unit 6 --lesson 5 --force-step ingest
 *
 * This is the task-runner-driven alternative to lesson-prep.mjs.
 * It delegates to runPipeline() which handles topological ordering,
 * registry-based skip logic, and parallel wave execution.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from './lib/task-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);

  // First positional arg is the pipeline name
  let pipelineName = null;
  const params = {};
  let dryRun = false;
  let force = false;
  const forceSteps = new Set();
  const contextEntries = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--force-step' && args[i + 1]) {
      forceSteps.add(args[++i]);
    } else if (arg === '--context' && args[i + 1]) {
      // --context key=value
      const [k, ...vParts] = args[++i].split('=');
      contextEntries.push([k, vParts.join('=')]);
    } else if (arg.startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      // Generic --key value → params
      const key = arg.replace(/^--/, '').replace(/-/g, '_');
      const val = args[++i];
      // Auto-parse numbers
      params[key] = /^\d+$/.test(val) ? parseInt(val, 10) : val;
    } else if (arg.startsWith('--')) {
      // Boolean flag
      const key = arg.replace(/^--/, '').replace(/-/g, '_');
      params[key] = true;
    } else if (!pipelineName) {
      pipelineName = arg;
    }
  }

  if (!pipelineName) {
    console.error(
      'Usage: node scripts/run-pipeline.mjs <pipeline-name> [--unit U] [--lesson L] [options]\n\n' +
      'Options:\n' +
      '  --dry-run           Print execution plan without running\n' +
      '  --force             Force all steps regardless of registry status\n' +
      '  --force-step <id>   Force a specific step (repeatable)\n' +
      '  --context key=val   Pre-seed pipeline context (repeatable)\n' +
      '  --<key> <value>     Pipeline parameter (e.g. --unit 6 --lesson 5)\n\n' +
      'Available pipelines:\n' +
      '  lesson-prep         Full lesson prep pipeline'
    );
    process.exit(1);
  }

  return { pipelineName, params, dryRun, force, forceSteps, contextEntries };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { pipelineName, params, dryRun, force, forceSteps, contextEntries } = parseArgs(process.argv);

  // Resolve pipeline file
  const pipelinePath = path.join(REPO_ROOT, 'pipelines', `${pipelineName}.json`);

  // Build initial context from --context args
  const context = new Map(contextEntries);

  console.log(`\n========================================`);
  console.log(`  Task Runner — ${pipelineName}`);
  if (Object.keys(params).length > 0) {
    console.log(`  Params: ${JSON.stringify(params)}`);
  }
  if (dryRun) console.log('  Mode: DRY RUN');
  if (force) console.log('  Mode: FORCE ALL');
  if (forceSteps.size > 0) console.log(`  Force steps: ${[...forceSteps].join(', ')}`);
  console.log(`========================================\n`);

  const startTime = Date.now();

  const { results, success } = await runPipeline(pipelinePath, params, {
    dryRun,
    force,
    forceSteps,
    context,
  });

  // Print results summary
  if (results.size > 0) {
    console.log('\n========================================');
    console.log('  Pipeline Results');
    console.log('========================================\n');

    for (const [stepId, result] of results) {
      const icon = result.status === 'completed' ? '[x]'
        : result.status === 'skipped' ? '[-]'
        : '[!]';
      const detail = result.reason || result.error || '';
      const duration = result.duration_ms > 0 ? ` (${(result.duration_ms / 1000).toFixed(1)}s)` : '';
      console.log(`  ${icon} ${stepId}: ${result.status}${duration}${detail ? ` — ${detail}` : ''}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  Total: ${elapsed}s — ${success ? 'SUCCESS' : 'FAILED'}`);
    console.log();
  }

  process.exit(success ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

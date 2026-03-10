/**
 * task-runner.mjs — Pipeline execution engine for the Agent Hub.
 *
 * Reads a pipeline JSON file, loads task definitions from tasks/, resolves
 * dependencies via topological sort (Kahn's algorithm), and executes tasks
 * in parallel where the dependency graph allows.
 *
 * Emits pipeline lifecycle events via event-log.mjs.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { pipeline as pipelineEvents } from './event-log.mjs';

// ---------------------------------------------------------------------------
// Repo root resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

/**
 * Replace {{key}} placeholders in a string value with params[key].
 * Non-string values are returned as-is.
 *
 * @param {*} value
 * @param {object} params
 * @returns {*}
 */
function resolveTemplate(value, params) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? '');
}

/**
 * Recursively resolve all template strings in an inputs object.
 *
 * @param {object} inputs
 * @param {object} params
 * @returns {object}
 */
function resolveInputs(inputs, params) {
  if (!inputs || typeof inputs !== 'object') return inputs;
  const resolved = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (Array.isArray(v)) {
      resolved[k] = v.map(item => resolveTemplate(item, params));
    } else {
      resolved[k] = resolveTemplate(v, params);
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Topological sort — Kahn's algorithm
// ---------------------------------------------------------------------------

/**
 * Returns an array of "waves" where each wave is an array of task IDs that
 * can run in parallel (all their dependencies completed in prior waves).
 *
 * @param {Array<{ task: string, depends_on: string[] }>} steps
 * @returns {string[][]} waves
 * @throws if a cycle is detected
 */
function topoSort(steps) {
  const ids = steps.map(s => s.task);
  const depMap = new Map(steps.map(s => [s.task, new Set(s.depends_on)]));

  // In-degree count per node
  const inDegree = new Map(ids.map(id => [id, 0]));
  for (const [, deps] of depMap) {
    for (const dep of deps) {
      if (!inDegree.has(dep)) {
        throw new Error(`Unknown dependency: "${dep}" — not declared as a step in this pipeline`);
      }
      inDegree.set(dep, inDegree.get(dep)); // dep is a prerequisite, not the current node
    }
  }

  // Recompute in-degrees correctly: count how many steps depend on each id
  for (const id of ids) inDegree.set(id, 0);
  for (const [id, deps] of depMap) {
    for (const dep of deps) {
      // dep must finish before id, so id's in-degree increases
      void dep; // dep is consumed by id
    }
  }
  // Actually: in-degree of a node = number of nodes that list it as a dependency
  // Re-derive cleanly:
  const inDeg = new Map(ids.map(id => [id, 0]));
  for (const [, deps] of depMap) {
    // Each dep listed reduces the readiness of the node that lists it
  }
  // Simplest correct derivation: in-degree[id] = |{ s : id ∈ s.depends_on }|
  // i.e. how many steps are waiting on *id* to finish before they can run.
  // That is NOT what Kahn's needs. Kahn's in-degree[id] = |id.depends_on|.
  const readyDegree = new Map(ids.map(id => [id, depMap.get(id).size]));

  const waves = [];
  const remaining = new Set(ids);

  while (remaining.size > 0) {
    // Collect all nodes with no unresolved dependencies
    const wave = [];
    for (const id of remaining) {
      if (readyDegree.get(id) === 0) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      throw new Error(
        `Dependency cycle detected among steps: ${[...remaining].join(', ')}`
      );
    }

    waves.push(wave);

    // Remove wave members from remaining and decrement dependents
    for (const id of wave) {
      remaining.delete(id);
    }
    for (const id of remaining) {
      const deps = depMap.get(id);
      let count = 0;
      for (const dep of deps) {
        if (remaining.has(dep)) count++;
      }
      readyDegree.set(id, count);
    }
  }

  return waves;
}

// ---------------------------------------------------------------------------
// Task loader
// ---------------------------------------------------------------------------

/**
 * Load a task definition JSON from tasks/<taskId>.json.
 *
 * @param {string} taskId
 * @returns {object} task definition
 * @throws if file is missing or malformed
 */
function loadTask(taskId) {
  const taskPath = path.join(REPO_ROOT, 'tasks', `${taskId}.json`);
  if (!fs.existsSync(taskPath)) {
    throw new Error(`Task file not found: ${taskPath}`);
  }
  return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Single task executor
// ---------------------------------------------------------------------------

/**
 * Execute a single task step.
 *
 * @param {object} task       — loaded task definition
 * @param {object} params     — pipeline params (used for template resolution)
 * @param {string} pipelineId — pipeline ID (for event metadata)
 * @param {Set}    forceSteps — step IDs to force-run
 * @returns {Promise<{ status: 'completed'|'skipped'|'failed', duration_ms: number, error?: string }>}
 */
async function executeTask(task, params, pipelineId, forceSteps) {
  const stepId = task.id;
  const startTime = Date.now();

  // --- Preconditions (log only — no actual registry check yet) ---
  if (task.preconditions) {
    const pc = task.preconditions;
    if (pc.requires_cdp) {
      console.log(`[task-runner] [${stepId}] Precondition: requires_cdp = true (not validated — assumed OK)`);
    }
    if (pc.registry_status) {
      const { key, not: notVal } = pc.registry_status;
      console.log(
        `[task-runner] [${stepId}] Precondition: registry_status.key="${key}" not="${notVal}" (not validated — assumed OK)`
      );
    }
  }

  // --- Resolve inputs ---
  const resolvedInputs = resolveInputs(task.inputs ?? {}, params);

  // --- Derive CLI args from resolved inputs ---
  // Build --key value pairs for well-known scalar inputs
  const argPairs = [];
  for (const [k, v] of Object.entries(resolvedInputs)) {
    if (typeof v === 'boolean') {
      if (v) argPairs.push(`--${k}`);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        argPairs.push(`--${k} ${String(item)}`);
      }
    } else if (v !== '' && v !== null && v !== undefined) {
      argPairs.push(`--${k} ${String(v)}`);
    }
  }
  const argsStr = argPairs.join(' ');

  // --- Emit step.started ---
  pipelineEvents.stepStarted(pipelineId, stepId, { taskName: task.name, type: task.type });

  try {
    switch (task.type) {
      case 'node-script':
      case 'cdp-browser':
      case 'git-operation': {
        const workerPath = path.join(REPO_ROOT, task.worker);
        const cmd = `node "${workerPath}" ${argsStr}`.trimEnd();
        const timeoutMs = (task.timeout_minutes ?? 10) * 60_000;
        console.log(`[task-runner] [${stepId}] Running: ${cmd}`);
        execSync(cmd, { stdio: 'inherit', timeout: timeoutMs, cwd: REPO_ROOT });
        break;
      }

      case 'codex-agent':
        console.log(`[task-runner] [${stepId}] Codex dispatch not yet implemented — skipping`);
        break;

      default:
        console.warn(`[task-runner] [${stepId}] Unknown task type "${task.type}" — skipping`);
        break;
    }

    const duration_ms = Date.now() - startTime;
    pipelineEvents.stepCompleted(pipelineId, stepId, duration_ms, { taskName: task.name });
    return { status: 'completed', duration_ms };

  } catch (err) {
    const duration_ms = Date.now() - startTime;
    const message = err?.message ?? String(err);
    pipelineEvents.stepFailed(pipelineId, stepId, err);

    const strategy = task.on_failure?.strategy ?? 'fail';

    if (strategy === 'skip') {
      console.warn(`[task-runner] [${stepId}] Failed (strategy=skip): ${message}`);
      return { status: 'failed', duration_ms, error: message };
    }

    if (strategy === 'retry') {
      console.warn(`[task-runner] [${stepId}] Failed (retry not yet implemented — treating as fail): ${message}`);
      return { status: 'failed', duration_ms, error: message, fatal: true };
    }

    // strategy === 'fail' (default)
    return { status: 'failed', duration_ms, error: message, fatal: true };
  }
}

// ---------------------------------------------------------------------------
// Dry-run printer
// ---------------------------------------------------------------------------

/**
 * Print the execution plan derived from the topological sort.
 *
 * @param {object}   pipelineDef
 * @param {string[][]} waves
 * @param {Map<string, object|null>} taskDefs — null means step.defined === false
 */
function printDryRun(pipelineDef, waves, taskDefs) {
  console.log(`\n=== DRY RUN: ${pipelineDef.name} (${pipelineDef.id}) ===\n`);
  waves.forEach((wave, i) => {
    const parallel = wave.length > 1 ? ' [PARALLEL]' : '';
    console.log(`  Wave ${i + 1}${parallel}:`);
    for (const taskId of wave) {
      const taskDef = taskDefs.get(taskId);
      if (taskDef === null) {
        console.log(`    - ${taskId}  (not yet defined — will be skipped)`);
      } else {
        const type = taskDef?.type ?? 'unknown';
        const worker = taskDef?.worker ?? '?';
        console.log(`    - ${taskId}  type=${type}  worker=${worker}`);
      }
    }
  });
  console.log('\n=== END DRY RUN ===\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run a pipeline by loading its definition and executing tasks.
 *
 * @param {string} pipelinePath — absolute path to pipeline JSON file
 * @param {object} params       — pipeline parameters (e.g. { unit: 6, lesson: 11 })
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]   — print plan without executing
 * @param {Set}    [options.forceSteps]      — step IDs to force even if preconditions say skip
 * @returns {Promise<{ results: Map<string, { status, duration_ms, error? }>, success: boolean }>}
 */
export async function runPipeline(pipelinePath, params, options = {}) {
  const { dryRun = false, forceSteps = new Set() } = options;

  // --- Load pipeline definition ---
  if (!fs.existsSync(pipelinePath)) {
    throw new Error(`Pipeline file not found: ${pipelinePath}`);
  }
  const pipelineDef = JSON.parse(fs.readFileSync(pipelinePath, 'utf8'));
  const { id: pipelineId, name: pipelineName, steps } = pipelineDef;

  console.log(`[task-runner] Pipeline: ${pipelineName} (${pipelineId})`);

  // --- Topological sort ---
  const waves = topoSort(steps);

  // --- Build step metadata map ---
  // stepMeta[taskId] = the step object from the pipeline (includes defined flag)
  const stepMeta = new Map(steps.map(s => [s.task, s]));

  // --- Pre-load task definitions (for dry run and type inspection) ---
  const taskDefs = new Map();
  for (const step of steps) {
    if (step.defined === false) {
      taskDefs.set(step.task, null);
    } else {
      try {
        taskDefs.set(step.task, loadTask(step.task));
      } catch (err) {
        // In dry-run mode we surface the error without aborting
        if (dryRun) {
          console.warn(`[task-runner] Warning: could not load task "${step.task}": ${err.message}`);
          taskDefs.set(step.task, null);
        } else {
          throw err;
        }
      }
    }
  }

  // --- Dry run ---
  if (dryRun) {
    printDryRun(pipelineDef, waves, taskDefs);
    return { results: new Map(), success: true };
  }

  // --- Execute ---
  pipelineEvents.started(pipelineName, { pipelineId, params });

  const results = new Map();
  let success = true;

  for (const wave of waves) {
    // Filter out steps whose dependencies failed fatally
    const runnableInWave = wave.filter(taskId => {
      const step = stepMeta.get(taskId);
      // Check if any dependency failed fatally
      for (const dep of (step.depends_on ?? [])) {
        const depResult = results.get(dep);
        if (depResult?.fatal) {
          console.warn(
            `[task-runner] [${taskId}] Skipping — dependency "${dep}" failed fatally`
          );
          results.set(taskId, { status: 'skipped', duration_ms: 0, error: `dependency "${dep}" failed` });
          return false;
        }
      }
      return true;
    });

    if (runnableInWave.length === 0) continue;

    // Run all tasks in this wave in parallel
    await Promise.all(
      runnableInWave.map(async taskId => {
        const step = stepMeta.get(taskId);

        // --- defined === false: skip ---
        if (step.defined === false) {
          console.log(`[task-runner] [${taskId}] Skipped (not yet defined)`);
          results.set(taskId, { status: 'skipped', duration_ms: 0 });
          return;
        }

        const task = taskDefs.get(taskId);

        try {
          const result = await executeTask(task, params, pipelineId, forceSteps);
          results.set(taskId, result);

          if (result.fatal) {
            success = false;
          }
        } catch (unexpectedErr) {
          // Shouldn't happen — executeTask catches internally — but guard anyway
          const message = unexpectedErr?.message ?? String(unexpectedErr);
          console.error(`[task-runner] [${taskId}] Unexpected error: ${message}`);
          results.set(taskId, { status: 'failed', duration_ms: 0, error: message, fatal: true });
          success = false;
        }
      })
    );

    // If any step in this wave was fatal and its failure strategy is 'fail', stop
    let shouldAbort = false;
    for (const taskId of runnableInWave) {
      const result = results.get(taskId);
      if (result?.fatal) {
        const task = taskDefs.get(taskId);
        const strategy = task?.on_failure?.strategy ?? 'fail';
        if (strategy !== 'skip') {
          console.error(`[task-runner] Aborting pipeline — step "${taskId}" failed with strategy="${strategy}"`);
          shouldAbort = true;
          break;
        }
      }
    }
    if (shouldAbort) {
      success = false;
      break;
    }
  }

  pipelineEvents.completed(pipelineName, {
    pipelineId,
    success,
    stepCount: steps.length,
  });

  console.log(`[task-runner] Pipeline ${success ? 'SUCCEEDED' : 'FAILED'}: ${pipelineName}`);
  return { results, success };
}

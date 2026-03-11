/**
 * task-runner.mjs — Pipeline execution engine for the Agent Hub.
 *
 * Reads a pipeline JSON file, loads task definitions from tasks/, resolves
 * dependencies via topological sort (Kahn's algorithm), and executes tasks
 * in parallel where the dependency graph allows.
 *
 * Features:
 *   - Registry-based precondition enforcement (skip if already done)
 *   - Pipeline context for inter-step data flow
 *   - Force/forceSteps to override preconditions
 *   - Registry status updates after step completion
 *   - Codex agent task type support
 *
 * Emits pipeline lifecycle events via event-log.mjs.
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { pipeline as pipelineEvents } from './event-log.mjs';
import { getLesson, updateStatus } from './lesson-registry.mjs';

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

  // Validate all dependencies reference declared steps
  for (const [, deps] of depMap) {
    for (const dep of deps) {
      if (!depMap.has(dep)) {
        throw new Error(`Unknown dependency: "${dep}" — not declared as a step in this pipeline`);
      }
    }
  }

  // readyDegree[id] = number of unresolved dependencies for id
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
// Registry precondition check
// ---------------------------------------------------------------------------

/**
 * Check if a task should be skipped based on registry status.
 *
 * @param {object} task        — task definition
 * @param {object} params      — pipeline params (must include unit, lesson)
 * @param {boolean} force      — force all steps
 * @param {Set}    forceSteps  — specific step IDs to force
 * @returns {{ skip: boolean, reason?: string }}
 */
function checkRegistryPrecondition(task, params, force, forceSteps) {
  const stepId = task.id;

  // Force overrides
  if (force) return { skip: false };
  if (forceSteps.has(stepId)) return { skip: false };

  const pc = task.preconditions;
  if (!pc?.registry_status) return { skip: false };

  const { key, not: notVal } = pc.registry_status;
  if (!params.unit || !params.lesson) return { skip: false };

  const entry = getLesson(params.unit, params.lesson);
  if (!entry) return { skip: false };

  const currentStatus = entry.status?.[key];

  // "not: done" means "run only when status is NOT done"
  // So if currentStatus === notVal, precondition is not met → skip
  if (currentStatus && currentStatus === notVal) {
    return { skip: true, reason: `${key} already ${currentStatus}` };
  }

  return { skip: false };
}

// ---------------------------------------------------------------------------
// Codex agent launcher
// ---------------------------------------------------------------------------

/**
 * Launch a Codex agent task. Reads prompt from the worker field or builds
 * from inputs. Returns a Promise that resolves when Codex finishes.
 *
 * @param {object} task   — task definition (type: codex-agent)
 * @param {string} argsStr — resolved CLI args string
 * @param {string} stepId — step identifier
 * @returns {Promise<void>}
 */
function launchCodexAgent(task, argsStr, stepId) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const timeoutMs = (task.timeout_minutes ?? 15) * 60_000;

    // Build the codex command
    const spawnCommand = isWindows
      ? (process.env.ComSpec || 'cmd.exe')
      : 'codex';
    const spawnArgs = isWindows
      ? ['/d', '/s', '/c', `codex.cmd exec --full-auto ${argsStr}`]
      : ['exec', '--full-auto', ...argsStr.split(/\s+/).filter(Boolean)];

    console.log(`[task-runner] [${stepId}] Codex: ${isWindows ? spawnArgs[3] : spawnArgs.join(' ')}`);

    const proc = spawn(spawnCommand, spawnArgs, {
      stdio: 'inherit',
      cwd: REPO_ROOT,
      timeout: timeoutMs,
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Codex exited with code ${code}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Single task executor
// ---------------------------------------------------------------------------

/**
 * Execute a single task step.
 *
 * @param {object} task        — loaded task definition
 * @param {object} params      — pipeline params (used for template resolution)
 * @param {string} pipelineId  — pipeline ID (for event metadata)
 * @param {boolean} force      — force all steps
 * @param {Set}    forceSteps  — step IDs to force-run
 * @param {Map}    context     — pipeline context for inter-step data flow
 * @returns {Promise<{ status: 'completed'|'skipped'|'failed', duration_ms: number, error?: string }>}
 */
async function executeTask(task, params, pipelineId, force, forceSteps, context) {
  const stepId = task.id;
  const startTime = Date.now();

  // --- Registry precondition check ---
  const preconditionCheck = checkRegistryPrecondition(task, params, force, forceSteps);
  if (preconditionCheck.skip) {
    console.log(`[task-runner] [${stepId}] Skipped — ${preconditionCheck.reason}`);
    return { status: 'skipped', duration_ms: 0, reason: preconditionCheck.reason };
  }

  if (task.preconditions?.requires_cdp) {
    console.log(`[task-runner] [${stepId}] Precondition: requires_cdp = true`);
  }

  // --- Resolve inputs using both params and pipeline context ---
  const resolvedParams = { ...params, ...Object.fromEntries(context) };
  const resolvedInputs = resolveInputs(task.inputs ?? {}, resolvedParams);

  // --- Derive CLI args from resolved inputs ---
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

      case 'codex-agent': {
        await launchCodexAgent(task, argsStr, stepId);
        break;
      }

      default:
        console.warn(`[task-runner] [${stepId}] Unknown task type "${task.type}" — skipping`);
        break;
    }

    const duration_ms = Date.now() - startTime;
    pipelineEvents.stepCompleted(pipelineId, stepId, duration_ms, { taskName: task.name });

    // --- Update registry status on success ---
    if (task.outputs?.registry_key && params.unit && params.lesson) {
      try {
        updateStatus(params.unit, params.lesson, task.outputs.registry_key, 'done');
      } catch { /* non-fatal — registry key may not be in STATUS_KEYS */ }
    }

    return { status: 'completed', duration_ms };

  } catch (err) {
    const duration_ms = Date.now() - startTime;
    const message = err?.message ?? String(err);
    pipelineEvents.stepFailed(pipelineId, stepId, err);

    // --- Update registry status on failure ---
    if (task.outputs?.registry_key && params.unit && params.lesson) {
      try {
        updateStatus(params.unit, params.lesson, task.outputs.registry_key, 'failed');
      } catch { /* non-fatal */ }
    }

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
 * @param {boolean} [options.force=false]    — force all steps regardless of preconditions
 * @param {Set}    [options.forceSteps]      — step IDs to force even if preconditions say skip
 * @param {Map}    [options.context]         — initial pipeline context (pre-seeded outputs)
 * @returns {Promise<{ results: Map<string, { status, duration_ms, error? }>, success: boolean, context: Map }>}
 */
export async function runPipeline(pipelinePath, params, options = {}) {
  const {
    dryRun = false,
    force = false,
    forceSteps = new Set(),
    context: initialContext = new Map(),
  } = options;

  // Pipeline context: accumulates outputs from completed steps
  // Downstream tasks can reference these via {{key}} in their inputs
  const context = new Map(initialContext);

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
  const stepMeta = new Map(steps.map(s => [s.task, s]));

  // --- Pre-load task definitions ---
  const taskDefs = new Map();
  for (const step of steps) {
    if (step.defined === false) {
      taskDefs.set(step.task, null);
    } else {
      try {
        taskDefs.set(step.task, loadTask(step.task));
      } catch (err) {
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
    return { results: new Map(), success: true, context };
  }

  // --- Execute ---
  pipelineEvents.started(pipelineName, { pipelineId, params });

  const results = new Map();
  let success = true;

  for (const wave of waves) {
    // Filter out steps whose dependencies failed fatally
    const runnableInWave = wave.filter(taskId => {
      const step = stepMeta.get(taskId);
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

        if (step.defined === false) {
          console.log(`[task-runner] [${taskId}] Skipped (not yet defined)`);
          results.set(taskId, { status: 'skipped', duration_ms: 0 });
          return;
        }

        const task = taskDefs.get(taskId);

        try {
          const result = await executeTask(task, params, pipelineId, force, forceSteps, context);
          results.set(taskId, result);

          // After successful completion, refresh context from registry
          // This lets downstream tasks access URLs/state set by this step
          if (result.status === 'completed' && params.unit && params.lesson) {
            const freshEntry = getLesson(params.unit, params.lesson);
            if (freshEntry?.urls) {
              for (const [k, v] of Object.entries(freshEntry.urls)) {
                if (v) context.set(k, typeof v === 'string' ? v : JSON.stringify(v));
              }
            }
          }

          if (result.fatal) {
            success = false;
          }
        } catch (unexpectedErr) {
          const message = unexpectedErr?.message ?? String(unexpectedErr);
          console.error(`[task-runner] [${taskId}] Unexpected error: ${message}`);
          results.set(taskId, { status: 'failed', duration_ms: 0, error: message, fatal: true });
          success = false;
        }
      })
    );

    // If any step in this wave was fatal, stop the pipeline
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
  return { results, success, context };
}

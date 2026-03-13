import fs from 'node:fs';
import path from 'node:path';

function readJson(basePath, relativePath) {
  const filePath = path.resolve(basePath, relativePath);

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }

    throw error;
  }
}

export function loadAll(basePath) {
  return {
    registry: readJson(basePath, 'state/lesson-registry.json'),
    queue: readJson(basePath, 'state/work-queue.json'),
    pipeline: readJson(basePath, 'pipelines/lesson-prep.json'),
    schedule: readJson(basePath, 'config/topic-schedule.json'),
    animations: readJson(basePath, 'state/animation-uploads.json'),
    blooket: readJson(basePath, 'state/blooket-uploads.json'),
  };
}

export function watchAll(basePath, onChange) {
  const statePath = path.resolve(basePath, 'state');
  let debounceTimer = null;

  const watcher = fs.watch(statePath, () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 500);
  });

  return () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    watcher.close();
  };
}

export function computeWaves(pipeline) {
  const steps = Array.isArray(pipeline?.steps) ? pipeline.steps : [];
  const remaining = new Map(steps.map((step) => [step.task, step]));
  const resolved = new Set();
  const waves = [];
  let waveNumber = 1;

  while (remaining.size > 0) {
    const readyTasks = steps.filter((step) => {
      if (!remaining.has(step.task)) {
        return false;
      }

      const dependencies = Array.isArray(step.depends_on) ? step.depends_on : [];
      return dependencies.every((dependency) => resolved.has(dependency));
    });

    if (readyTasks.length === 0) {
      throw new Error('Unable to compute pipeline waves due to a dependency cycle or missing task.');
    }

    const tasks = readyTasks.map((step) => step.task);
    waves.push({ wave: waveNumber, tasks });

    for (const task of tasks) {
      resolved.add(task);
      remaining.delete(task);
    }

    waveNumber += 1;
  }

  return waves;
}

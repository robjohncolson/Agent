#!/usr/bin/env node
/**
 * pipeline-commander.mjs — Midnight Commander-style TUI for lesson-prep pipeline.
 *
 * Usage:
 *   node scripts/pipeline-commander.mjs
 */

import blessed from 'blessed';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { COLORS, ICONS, STYLES } from './lib/commander/theme.mjs';
import { loadAll, watchAll, computeWaves } from './lib/commander/data-loader.mjs';
import { bind } from './lib/commander/keybindings.mjs';

import * as pipelineSteps from './lib/commander/panels/pipeline-steps.mjs';
import * as lessonDetail from './lib/commander/panels/lesson-detail.mjs';
import * as registryOverview from './lib/commander/panels/registry-overview.mjs';
import * as workQueue from './lib/commander/panels/work-queue.mjs';
import * as logViewer from './lib/commander/panels/log-viewer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(__dirname, '..');

// ── State ──────────────────────────────────────────────────────────────
let data = loadAll(BASE);
let waves = computeWaves(data.pipeline);
let topics = registryOverview.getTopics(data.registry);
let selectedIdx = 0;
let period = 'B';
let view = 'main'; // main | queue | log

// ── Screen ─────────────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: 'Pipeline Commander',
  fullUnicode: true,
});

// ── Top Bar ────────────────────────────────────────────────────────────
const topBar = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { bg: COLORS.bg, fg: COLORS.header, bold: true },
});

function renderTopBar() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const pB = period === 'B' ? '{bold}[B]{/bold}' : ' B ';
  const pE = period === 'E' ? '{bold}[E]{/bold}' : ' E ';
  topBar.setContent(`  AP Stats Lesson Prep Pipeline          Period: ${pB} ◄► ${pE}     ${time}  ${date}`);
}

// ── Panels ─────────────────────────────────────────────────────────────
const stepsPanel = pipelineSteps.create(screen);
const detailPanel = lessonDetail.create(screen);
const overviewPanel = registryOverview.create(screen);
const queueStrip = workQueue.createStrip(screen);
const queueExpanded = workQueue.createExpanded(screen);
const logPanel = logViewer.create(screen);

// ── Function Key Bar ───────────────────────────────────────────────────
const fnBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: STYLES.fnBar,
});
fnBar.setContent(' F1 Help  F2 Queue  F3 View  F4 Logs  F5 Run  F6 Period  F8 Rebuild (manual)  F10 Quit');

// ── Help Overlay ───────────────────────────────────────────────────────
const helpBox = blessed.box({
  parent: screen,
  top: 'center',
  left: 'center',
  width: 60,
  height: 16,
  border: 'line',
  label: ' Help ',
  tags: true,
  style: STYLES.panel,
  hidden: true,
});
helpBox.setContent([
  '{bold}Pipeline Commander — Keybindings{/bold}',
  '',
  '  F1        This help',
  '  F2        Toggle work queue view',
  '  F3        View raw JSON for selected lesson',
  '  F4        Toggle pipeline log viewer',
  '  F5        Run pipeline (prompts for unit+lesson)',
  '  F6        Toggle period B ↔ E',
  '  F8        Rebuild roadmap data (manual)',
  '  F10 / q   Quit',
  '',
  '  ← →       Navigate lessons',
  '  ↑ ↓       Navigate units',
].join('\n'));

// ── Raw JSON Overlay ───────────────────────────────────────────────────
const rawBox = blessed.box({
  parent: screen,
  top: 1,
  left: 0,
  width: '100%',
  height: '90%',
  border: 'line',
  label: ' Raw JSON ',
  tags: true,
  keys: true,
  vi: true,
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', style: { bg: COLORS.border } },
  style: STYLES.panel,
  hidden: true,
});

// ── Refresh ────────────────────────────────────────────────────────────
function refresh() {
  data = loadAll(BASE);
  waves = computeWaves(data.pipeline);
  topics = registryOverview.getTopics(data.registry);
  if (selectedIdx >= topics.length) selectedIdx = Math.max(0, topics.length - 1);
  renderAll();
}

function renderAll() {
  const currentTopic = topics[selectedIdx] || null;
  const currentEntry = currentTopic ? data.registry[currentTopic] : null;

  renderTopBar();

  pipelineSteps.update(stepsPanel, {
    pipeline: data.pipeline,
    registry: data.registry,
    waves,
    currentLesson: currentTopic,
  });

  lessonDetail.update(detailPanel, {
    lesson: currentEntry,
    period,
    animations: data.animations,
    blooket: data.blooket,
  });

  registryOverview.update(overviewPanel, {
    registry: data.registry,
    selectedTopic: currentTopic,
  });

  workQueue.updateStrip(queueStrip, data);
  if (!queueExpanded.hidden) workQueue.updateExpanded(queueExpanded, data);

  screen.render();
}

// ── Navigation ─────────────────────────────────────────────────────────
function selectPrev() {
  if (selectedIdx > 0) { selectedIdx--; renderAll(); }
}
function selectNext() {
  if (selectedIdx < topics.length - 1) { selectedIdx++; renderAll(); }
}
function selectPrevUnit() {
  const cur = topics[selectedIdx];
  if (!cur) return;
  const curUnit = cur.split('.')[0];
  for (let i = selectedIdx - 1; i >= 0; i--) {
    if (topics[i].split('.')[0] !== curUnit) { selectedIdx = i; renderAll(); return; }
  }
}
function selectNextUnit() {
  const cur = topics[selectedIdx];
  if (!cur) return;
  const curUnit = cur.split('.')[0];
  for (let i = selectedIdx + 1; i < topics.length; i++) {
    if (topics[i].split('.')[0] !== curUnit) { selectedIdx = i; renderAll(); return; }
  }
}

// ── View toggles ───────────────────────────────────────────────────────
function setView(v) {
  view = v;
  stepsPanel[v === 'main' ? 'show' : 'hide']();
  detailPanel[v === 'main' || v === 'queue' ? 'show' : 'hide']();
  overviewPanel[v === 'main' || v === 'queue' ? 'show' : 'hide']();
  queueExpanded[v === 'queue' ? 'show' : 'hide']();
  logPanel[v === 'log' ? 'show' : 'hide']();
  queueStrip[v === 'main' || v === 'queue' ? 'show' : 'hide']();
  if (v === 'queue') workQueue.updateExpanded(queueExpanded, data);
  screen.render();
}

function toggleQueue() {
  setView(view === 'queue' ? 'main' : 'queue');
}
function toggleLog() {
  setView(view === 'log' ? 'main' : 'log');
}
function toggleHelp() {
  helpBox.toggle();
  screen.render();
}
function viewRaw() {
  const cur = topics[selectedIdx];
  const entry = cur ? data.registry[cur] : null;
  if (entry) {
    rawBox.setContent(JSON.stringify(entry, null, 2));
  } else {
    rawBox.setContent('No lesson selected');
  }
  rawBox.toggle();
  screen.render();
}
function togglePeriod() {
  period = period === 'B' ? 'E' : 'B';
  renderAll();
}

// ── Pipeline run ───────────────────────────────────────────────────────
function runPipeline() {
  const prompt = blessed.prompt({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 40,
    height: 8,
    border: 'line',
    label: ' Run Pipeline ',
    style: STYLES.panel,
  });
  prompt.input('Unit.Lesson (e.g. 7.4):', '', (err, value) => {
    if (err || !value) { screen.render(); return; }
    const [unit, lesson] = value.split('.').map(Number);
    if (!unit || !lesson) { screen.render(); return; }

    logViewer.update(logPanel, `Starting pipeline: Unit ${unit} Lesson ${lesson}`);
    setView('log');

    const child = spawn('node', [
      path.join(__dirname, 'lesson-prep.mjs'),
      '--auto', '--unit', String(unit), '--lesson', String(lesson),
    ], { cwd: BASE, env: { ...process.env, FORCE_COLOR: '1' } });

    logViewer.attachProcess(logPanel, child);
    child.on('close', (code) => {
      logViewer.update(logPanel, `\nPipeline exited with code ${code}`);
      refresh();
    });
  });
}

// ── Rebuild roadmap ────────────────────────────────────────────────────
function rebuildRoadmap() {
  logViewer.update(logPanel, 'Rebuilding roadmap data (manual)...');
  const child = spawn('node', [
    path.join(__dirname, 'build-roadmap-data.mjs'),
  ], { cwd: BASE });

  logViewer.attachProcess(logPanel, child);
  child.on('close', (code) => {
    logViewer.update(logPanel, `Roadmap rebuild exited with code ${code}`);
    refresh();
  });
}

// ── File watcher ───────────────────────────────────────────────────────
const stopWatch = watchAll(BASE, refresh);

// ── Keybindings ────────────────────────────────────────────────────────
bind(screen, {
  toggleHelp,
  toggleQueue,
  viewRaw,
  toggleLog,
  runPipeline,
  togglePeriod,
  rebuildRoadmap,
  selectPrev,
  selectNext,
  selectPrevUnit,
  selectNextUnit,
  cleanup: () => stopWatch(),
});

// ── Initial render ─────────────────────────────────────────────────────
renderAll();

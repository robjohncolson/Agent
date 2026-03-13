import blessed from 'blessed';
import { COLORS, ICONS, STYLES, createBox } from '../theme.mjs';

const TASK_TO_STATUS = {
  'ingest': 'ingest',
  'content-gen-worksheet': 'worksheet',
  'content-gen-blooket': 'blooketCsv',
  'content-gen-drills': 'drills',
  'render-animations': 'animations',
  'upload-animations': 'animationUpload',
  'upload-blooket': 'blooketUpload',
  'schoology-post': 'schoology',
  'verify-schoology': 'schoologyVerified',
  'generate-urls': 'urlsGenerated',
  'export-registry': 'registryExported',
  'build-roadmap': 'registryExported',
  'commit-push': 'committed',
};

function statusIcon(val) {
  if (val === 'done') return ICONS.done;
  if (val === 'pending' || !val) return ICONS.pending;
  return ICONS.running;
}

export function create(screen) {
  return createBox(screen, {
    label: ' Pipeline Steps ',
    top: 1,
    left: 0,
    width: '50%',
    height: '70%',
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    keys: true,
    vi: true,
    scrollbar: { ch: ' ', style: { bg: COLORS.border } },
  });
}

export function update(widget, data) {
  const { waves, currentLesson, registry } = data;
  const entry = currentLesson ? registry?.[currentLesson] : null;
  const status = entry?.status ?? {};

  const totalSteps = (waves || []).reduce((n, w) => n + w.tasks.length, 0);
  let doneCount = 0;
  for (const w of waves || []) {
    for (const t of w.tasks) {
      if (status[TASK_TO_STATUS[t]] === 'done') doneCount++;
    }
  }

  // progress bar
  const barWidth = 30;
  const pct = totalSteps ? Math.round((doneCount / totalSteps) * 100) : 0;
  const filled = totalSteps ? Math.round((doneCount / totalSteps) * barWidth) : 0;
  const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);
  const lines = [`${bar} ${pct}% (${doneCount}/${totalSteps})`, ''];

  for (const w of waves || []) {
    lines.push(`{bold}Wave ${w.wave}{/bold}`);
    for (const task of w.tasks) {
      const key = TASK_TO_STATUS[task];
      const icon = statusIcon(status[key]);
      lines.push(`  ${icon} ${task}`);
    }
    lines.push('');
  }

  widget.setContent(lines.join('\n'));
}

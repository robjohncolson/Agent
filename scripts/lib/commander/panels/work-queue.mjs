import blessed from 'blessed';
import { COLORS, STYLES, createBox } from '../theme.mjs';

export function getNextPending(actions, limit = 5) {
  return (actions || [])
    .filter(a => a.status !== 'completed')
    .sort((a, b) => (a.unit - b.unit) || (a.lesson - b.lesson))
    .slice(0, limit);
}

export function createStrip(screen) {
  return blessed.box({
    parent: screen,
    bottom: 1,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { bg: COLORS.bg, fg: 'white' },
  });
}

export function updateStrip(widget, data) {
  const q = data?.queue;
  const total = q?.stats?.total ?? q?.actions?.length ?? 0;
  const completed = q?.stats?.completed ?? (q?.actions || []).filter(a => a.status === 'completed').length;

  const barWidth = 30;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const filled = total ? Math.round((completed / total) * barWidth) : 0;
  const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);

  const next = getNextPending(q?.actions).map(a => `${a.type} ${a.unit}.${a.lesson}`);
  const nextStr = next.length ? `  Next: ${next.join(' → ')}` : '';

  widget.setContent(`${bar} ${pct}% complete (${completed}/${total})${nextStr}`);
}

export function createExpanded(screen) {
  const widget = blessed.listtable({
    parent: screen,
    label: ' Work Queue ',
    top: 1,
    left: 0,
    width: '50%',
    height: '70%',
    border: 'line',
    tags: true,
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: COLORS.border } },
    style: {
      ...STYLES.panel,
      header: { fg: COLORS.header, bold: true },
      cell: { fg: 'white' },
    },
    align: 'left',
    noCellBorders: true,
  });
  widget.hide();
  return widget;
}

export function updateExpanded(widget, data) {
  const actions = [...(data?.queue?.actions || [])].sort((a, b) => {
    // pending first
    const as = a.status === 'completed' ? 1 : 0;
    const bs = b.status === 'completed' ? 1 : 0;
    return (as - bs) || (a.unit - b.unit) || (a.lesson - b.lesson);
  });

  const rows = [['Unit', 'Lesson', 'Type', 'Status']];
  for (const a of actions) {
    rows.push([String(a.unit), String(a.lesson), a.type, a.status]);
  }
  widget.setData(rows);
}

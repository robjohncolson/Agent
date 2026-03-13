import { COLORS, ICONS, createBox } from '../theme.mjs';

function overallStatus(entry) {
  const s = entry?.status ?? {};
  const ready = ['worksheet', 'drills', 'schoology', 'schoologyVerified']
    .every(k => s[k] === 'done');
  if (ready) return 'ready';
  if (s.ingest === 'done') return 'partial';
  return 'pending';
}

export function getTopics(registry) {
  return Object.keys(registry || {}).sort((a, b) => {
    const [au, al] = a.split('.').map(Number);
    const [bu, bl] = b.split('.').map(Number);
    return au - bu || al - bl;
  });
}

export function create(screen) {
  return createBox(screen, {
    label: ' Registry Overview ',
    top: '70%',
    left: 0,
    width: '100%',
    height: '20%',
    tags: true,
    scrollable: true,
  });
}

export function update(widget, data) {
  const { registry, selectedTopic } = data;
  const topics = getTopics(registry);

  // group by unit
  const units = new Map();
  for (const t of topics) {
    const u = t.split('.')[0];
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(t);
  }

  const counts = { ready: 0, partial: 0, pending: 0 };
  const lines = [];

  for (const [u, lessons] of units) {
    let row = `  U${u}  `;
    for (const t of lessons) {
      const st = overallStatus(registry[t]);
      counts[st]++;
      const icon = st === 'ready' ? ICONS.ready : st === 'partial' ? ICONS.partial : ICONS.empty;
      const color = st === 'ready' ? COLORS.ready : st === 'partial' ? COLORS.partial : COLORS.pending;
      const label = t === selectedTopic
        ? `{bold}{${color}-fg}${t} ${icon}{/${color}-fg}{/bold}`
        : `{${color}-fg}${t} ${icon}{/${color}-fg}`;
      row += label + ' ';
    }
    lines.push(row);
  }

  lines.push('');
  lines.push(`  {${COLORS.ready}-fg}${ICONS.ready} ready (${counts.ready}){/${COLORS.ready}-fg}   ` +
    `{${COLORS.partial}-fg}${ICONS.partial} partial (${counts.partial}){/${COLORS.partial}-fg}   ` +
    `{${COLORS.pending}-fg}${ICONS.empty} pending (${counts.pending}){/${COLORS.pending}-fg}` +
    `        ${topics.length} total lessons`);

  widget.setContent(lines.join('\n'));
}

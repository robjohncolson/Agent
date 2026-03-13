import { COLORS, ICONS, createBox } from '../theme.mjs';

function overallStatus(entry) {
  const s = entry?.status ?? {};
  const ready = ['worksheet', 'drills', 'schoology', 'schoologyVerified']
    .every(k => s[k] === 'done');
  if (ready) return 'ready';
  if (s.ingest === 'done') return 'partial';
  return 'pending';
}

function statusLabel(st) {
  const icon = st === 'ready' ? ICONS.ready : st === 'partial' ? ICONS.partial : ICONS.empty;
  const color = st === 'ready' ? COLORS.ready : st === 'partial' ? COLORS.partial : COLORS.pending;
  return `{${color}-fg}${icon} ${st}{/${color}-fg}`;
}

function urlLine(icon, label, url) {
  const pad = label.padEnd(12);
  if (url) return `  ${icon} ${pad} ${ICONS.done} ${url.length > 40 ? url.slice(0, 40) + '…' : url}`;
  return `  ${icon} ${pad} ${ICONS.pending} —`;
}

function periodBlock(entry, period) {
  const sc = entry?.schoology?.[period];
  const folderKey = period === 'B' ? 'schoologyFolder' : 'schoologyFolderE';
  const hasFolder = !!entry?.urls?.[folderKey];
  const matCount = sc?.materials ? Object.keys(sc.materials).length : 0;
  const verDate = sc?.verifiedAt ? sc.verifiedAt.slice(0, 10) : '—';

  const lines = [`Period ${period}`];
  lines.push(`  ${ICONS.folder} Schoology    ${hasFolder ? ICONS.done + ' linked' : ICONS.pending + ' —'}`);
  lines.push(`  ${ICONS.posted} Posted       ${matCount > 0 ? ICONS.done + ' ' + matCount + ' materials' : ICONS.pending + ' not yet'}`);
  lines.push(`  ✓  Verified     ${verDate}`);
  return lines;
}

export function create(screen) {
  return createBox(screen, {
    label: ' Lesson Detail ',
    top: 1,
    left: '50%',
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
  const { lesson: entry, period, animations, blooket } = data;
  if (!entry) {
    widget.setContent('No lesson selected');
    return;
  }

  const st = overallStatus(entry);
  const urls = entry.urls ?? {};
  const lines = [
    `Topic ${entry.unit}.${entry.lesson} — ${entry.topic || ''}`,
    '─'.repeat(35),
    `Status: ${statusLabel(st)}`,
    '',
    'URLs',
    urlLine(ICONS.worksheet, 'Worksheet', urls.worksheet),
    urlLine(ICONS.drills, 'Drills', urls.drills),
    urlLine(ICONS.quiz, 'Quiz', urls.quiz),
    urlLine(ICONS.blooket, 'Blooket', urls.blooket),
    '',
    ...periodBlock(entry, 'B'),
    '',
    ...periodBlock(entry, 'E'),
    '',
  ];

  // animations count
  const animFiles = animations?.files ? Object.keys(animations.files).length : 0;
  lines.push(`Animations: ${animFiles} scenes uploaded`);

  // content hash from first material
  const hash = entry.schoology?.B?.materials?.worksheet?.contentHash
    || entry.schoology?.E?.materials?.worksheet?.contentHash
    || '—';
  lines.push(`Content hash: ${hash}`);

  widget.setContent(lines.join('\n'));
}

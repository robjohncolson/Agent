import blessed from 'blessed';

export const COLORS = {
  bg: '#000080',
  border: 'cyan',
  header: 'white',
  ready: 'green',
  partial: 'yellow',
  pending: 'gray',
  error: 'red',
  selected: 'white',
  fnBar: 'cyan',
  fnKey: 'black',
};

export const ICONS = {
  done: '\u2705',
  running: '\u23f3',
  pending: '\u2b1c',
  failed: '\u274c',
  skipped: '\u23ed\ufe0f',
  ready: '\u25cf',
  partial: '\u25d0',
  empty: '\u25cb',
  worksheet: '\ud83d\udcc4',
  drills: '\ud83c\udfaf',
  quiz: '\ud83d\udcdd',
  blooket: '\ud83d\udfe6',
  folder: '\ud83d\udcc1',
  posted: '\ud83d\udcee',
};

export const STYLES = {
  panel: {
    bg: COLORS.bg,
    border: {
      fg: COLORS.border,
    },
    label: {
      fg: COLORS.header,
      bold: true,
    },
  },
  header: {
    bg: COLORS.bg,
    fg: COLORS.header,
    bold: true,
  },
  selected: {
    bg: COLORS.selected,
    fg: COLORS.fnKey,
    bold: true,
  },
  fnBar: {
    bg: COLORS.fnBar,
    fg: COLORS.fnKey,
    bold: true,
  },
};

function mergeStyle(baseStyle, overrideStyle = {}) {
  return {
    ...baseStyle,
    ...overrideStyle,
    border: {
      ...(baseStyle.border ?? {}),
      ...(overrideStyle.border ?? {}),
    },
    label: {
      ...(baseStyle.label ?? {}),
      ...(overrideStyle.label ?? {}),
    },
  };
}

export function createBox(screen, opts = {}) {
  const { style, ...rest } = opts;

  return blessed.box({
    parent: rest.parent ?? screen,
    border: rest.border ?? 'line',
    style: mergeStyle(STYLES.panel, style),
    ...rest,
  });
}

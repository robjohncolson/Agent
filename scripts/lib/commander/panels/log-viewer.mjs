import blessed from 'blessed';
import { COLORS, STYLES } from '../theme.mjs';

export function create(screen) {
  const widget = blessed.log({
    parent: screen,
    label: ' Pipeline Log ',
    top: 1,
    left: 0,
    width: '100%',
    height: '90%',
    border: 'line',
    tags: true,
    keys: true,
    vi: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: COLORS.border } },
    style: STYLES.panel,
  });
  widget.hide();
  return widget;
}

export function update(widget, line) {
  widget.log(line);
}

export function attachProcess(widget, childProcess) {
  const logLines = (chunk) => {
    const text = chunk.toString();
    for (const line of text.split('\n')) {
      if (line) widget.log(line);
    }
  };
  if (childProcess.stdout) childProcess.stdout.on('data', logLines);
  if (childProcess.stderr) childProcess.stderr.on('data', logLines);
}

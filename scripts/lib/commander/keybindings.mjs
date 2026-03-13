/**
 * keybindings.mjs — Function key and navigation handlers for Pipeline Commander.
 */

export function bind(screen, ctx) {
  // F1 — Help overlay
  screen.key(['f1'], () => ctx.toggleHelp());

  // F2 — Toggle queue expanded view
  screen.key(['f2'], () => ctx.toggleQueue());

  // F3 — View raw JSON for selected lesson
  screen.key(['f3'], () => ctx.viewRaw());

  // F4 — Toggle log viewer
  screen.key(['f4'], () => ctx.toggleLog());

  // F5 — Run pipeline
  screen.key(['f5'], () => ctx.runPipeline());

  // F6 — Toggle period B ↔ E
  screen.key(['f6'], () => ctx.togglePeriod());

  // F8 — Rebuild roadmap
  screen.key(['f8'], () => ctx.rebuildRoadmap());

  // F10 / q / Ctrl-C — Quit
  screen.key(['f10', 'q', 'C-c'], () => {
    ctx.cleanup();
    process.exit(0);
  });

  // Arrow navigation for registry overview
  screen.key(['left'], () => ctx.selectPrev());
  screen.key(['right'], () => ctx.selectNext());
  screen.key(['up'], () => ctx.selectPrevUnit());
  screen.key(['down'], () => ctx.selectNextUnit());
}

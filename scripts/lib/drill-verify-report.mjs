/**
 * drill-verify-report.mjs — Formatted console tables for drill verification phases.
 */

function pad(str, len) {
  return String(str).padEnd(len);
}

function lessonLabel(n) {
  return `6.${n}`;
}

export function printRegistryAudit(results) {
  console.log('\nPhase 1: Registry Audit');
  if (!results || results.length === 0) {
    console.log('  No results.\n');
    return;
  }
  console.log(
    `${pad('Lesson', 8)}${pad('URL OK', 9)}${pad('Period B', 14)}Period E`
  );
  console.log(
    `${pad('──────', 8)}${pad('──────', 9)}${pad('────────', 14)}────────`
  );
  for (const r of results) {
    console.log(
      `${pad(lessonLabel(r.lesson), 8)}${pad(r.urlCorrect ? 'yes' : 'NO', 9)}${pad(r.periods.B.status, 14)}${r.periods.E.status}`
    );
  }
  console.log();
}

export function printVerificationReport(results) {
  console.log('\nPhase 2: CDP Verification');
  if (!results || results.length === 0) {
    console.log('  No results.\n');
    return;
  }
  console.log(
    `${pad('Lesson', 8)}${pad('Period B', 14)}Period E`
  );
  console.log(
    `${pad('──────', 8)}${pad('────────', 14)}────────`
  );
  for (const r of results) {
    console.log(
      `${pad(lessonLabel(r.lesson), 8)}${pad(r.periods.B.status, 14)}${r.periods.E.status}`
    );
  }
  console.log();
}

export function printSummary(results, options = {}) {
  const { dryRun = false, fixCount = 0 } = options;
  console.log('\nPhase 4: Summary');
  if (!results || results.length === 0) {
    console.log('  No results.\n');
    return;
  }
  console.log(
    `${pad('Lesson', 8)}${pad('Period B', 14)}${pad('Period E', 14)}Action`
  );
  console.log(
    `${pad('──────', 8)}${pad('────────', 14)}${pad('────────', 14)}──────`
  );
  for (const r of results) {
    console.log(
      `${pad(lessonLabel(r.lesson), 8)}${pad(r.periodB, 14)}${pad(r.periodE, 14)}${r.action}`
    );
  }
  console.log();
  if (dryRun) {
    console.log(`Run with --fix to apply ${fixCount} change(s).`);
  } else if (fixCount > 0) {
    console.log(`Total: ${fixCount} fix(es) applied.`);
  } else {
    console.log('All drill links verified — no changes needed.');
  }
  console.log();
}

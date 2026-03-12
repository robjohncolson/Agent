export const DRILL_BASE_URL =
  'https://lrsl-driller.vercel.app/platform/app.html?c=apstats-u6-inference-prop';

export const LEVEL_IDS = Object.freeze({
  1: 'l01-identify-evidence',
  2: 'l04-identify-procedure',
  3: 'l12-interpret-ci',
  4: 'l17-state-null',
  5: 'l24-test-statistic',
  6: 'l29-compare-pvalue-alpha',
  7: 'l35-identify-error-type',
  8: 'l44-identify-two-prop-ci',
  9: 'l49-interpret-two-prop-claim-interval',
  10: 'l17-hypotheses-610',
  11: 'l21-test-statistic-611',
});

/**
 * Return the correct drill URL for a Unit 6 lesson.
 *
 * @param {number | string} lesson
 * @returns {string | null}
 */
export function getCorrectDrillUrl(lesson) {
  const levelId = LEVEL_IDS[lesson];
  return levelId ? `${DRILL_BASE_URL}&level=${levelId}` : null;
}

/**
 * Return true when a title looks like a drill link for the requested lesson.
 *
 * @param {string | null | undefined} title
 * @param {number | string | null | undefined} lessonNum
 * @returns {boolean}
 */
export function isDrillTitle(title, lessonNum) {
  const normalizedTitle = String(title || '');
  if (!/drill/i.test(normalizedTitle)) {
    return false;
  }

  if (lessonNum === null || lessonNum === undefined || lessonNum === '') {
    return true;
  }

  const lessonToken = String(lessonNum).trim();
  if (!lessonToken) {
    return true;
  }

  const lessonPattern = new RegExp(`\\b6\\s*\\.\\s*${lessonToken}\\b`, 'i');
  return lessonPattern.test(normalizedTitle);
}

/**
 * Return the canonical drill title for a Unit 6 lesson.
 *
 * @param {number | string} lessonNum
 * @returns {string}
 */
export function drillTitle(lessonNum) {
  return `Topic 6.${lessonNum} \u2014 Drills`;
}

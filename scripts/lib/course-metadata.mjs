import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CARTRIDGES_DIR } from "./paths.mjs";

/**
 * Check the lesson registry for a saved drills URL that already contains
 * a &level= deep link. Returns the URL string or null.
 */
function getRegistryDrillsUrl(unit, lesson) {
  try {
    const regPath = join(import.meta.dirname, "../../state/lesson-registry.json");
    if (!existsSync(regPath)) return null;
    const reg = JSON.parse(readFileSync(regPath, "utf-8"));
    const key = `${unit}.${lesson}`;
    const url = reg[key]?.urls?.drills;
    if (url && url.includes("&level=")) return url;
  } catch { /* ignore */ }
  return null;
}

const DRILLS_BASE = "https://lrsl-driller.vercel.app/platform/app.html";

export const CARTRIDGE_MAP = Object.freeze({
  "5": "apstats-u5-sampling-dist",
  "6": "apstats-u6-inference-prop",
  "7": "apstats-u7-mean-ci",
  "8": "apstats-u8-unexpected-results",
});

function toPositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer. Received: ${value}`);
  }
  return parsed;
}

function readManifest(pathForRead) {
  try {
    return JSON.parse(readFileSync(pathForRead, "utf-8"));
  } catch {
    return null;
  }
}

function findLessonMode(manifest, unit, lesson) {
  const modes = Array.isArray(manifest?.modes) ? manifest.modes : [];
  const pattern = new RegExp(`^${unit}\\.${lesson}(?:\\D|$)`);

  return (
    modes.find((mode) => (
      mode &&
      typeof mode.name === "string" &&
      pattern.test(mode.name) &&
      typeof mode.id === "string"
    )) ?? null
  );
}

export function getCartridgeId(unit) {
  const parsed = Number(unit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return CARTRIDGE_MAP[String(parsed)] ?? null;
}

export function findCartridgePath(unit) {
  const cartridgeId = getCartridgeId(unit);
  if (!cartridgeId) {
    return null;
  }

  const cartridgeDir = join(CARTRIDGES_DIR, cartridgeId);
  return existsSync(cartridgeDir) ? cartridgeId : null;
}

export function resolveDrillsLink(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const cartridgeId = getCartridgeId(unitNum);

  if (!cartridgeId) {
    return { cartridgeId: null, modeId: null, url: null, status: "no-cartridge" };
  }

  const fallbackUrl = `${DRILLS_BASE}?c=${cartridgeId}`;
  const manifestPath = join(CARTRIDGES_DIR, cartridgeId, "manifest.json");
  if (!existsSync(manifestPath)) {
    // Manifest not on this machine — check registry for a saved deep link
    const regUrl = getRegistryDrillsUrl(unitNum, lessonNum);
    if (regUrl) {
      return { cartridgeId, modeId: null, url: regUrl, status: "registry-fallback" };
    }
    return { cartridgeId, modeId: null, url: fallbackUrl, status: "no-manifest" };
  }

  const manifest = readManifest(manifestPath);
  if (!manifest) {
    const regUrl = getRegistryDrillsUrl(unitNum, lessonNum);
    if (regUrl) {
      return { cartridgeId, modeId: null, url: regUrl, status: "registry-fallback" };
    }
    return { cartridgeId, modeId: null, url: fallbackUrl, status: "no-manifest" };
  }

  const match = findLessonMode(manifest, unitNum, lessonNum);
  if (!match) {
    const regUrl = getRegistryDrillsUrl(unitNum, lessonNum);
    if (regUrl) {
      return { cartridgeId, modeId: null, url: regUrl, status: "registry-fallback" };
    }
    return { cartridgeId, modeId: null, url: fallbackUrl, status: "no-mode" };
  }

  return {
    cartridgeId,
    modeId: match.id,
    url: `${fallbackUrl}&level=${match.id}`,
    status: "resolved",
  };
}

export function computeQuizUrl(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");

  if (lessonNum > 1) {
    return `https://robjohncolson.github.io/curriculum_render/?u=${unitNum}&l=${lessonNum - 1}`;
  }

  if (unitNum > 1) {
    return `https://robjohncolson.github.io/curriculum_render/?u=${unitNum - 1}&l=PC`;
  }

  return null;
}

export function computeQuizTitle(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");

  if (lessonNum > 1) {
    return `Quiz ${unitNum}.${lessonNum - 1}`;
  }

  if (unitNum > 1) {
    return `Unit ${unitNum - 1} Progress Check`;
  }

  return null;
}

export function computeUrls(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");

  return {
    worksheet:
      `https://robjohncolson.github.io/apstats-live-worksheet/` +
      `u${unitNum}_lesson${lessonNum}_live.html`,
    quiz: computeQuizUrl(unitNum, lessonNum),
    drills: resolveDrillsLink(unitNum, lessonNum).url,
  };
}

export function buildLinkTitles(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");

  return {
    worksheet: `Topic ${unitNum}.${lessonNum} — Follow-Along Worksheet`,
    drills: `Topic ${unitNum}.${lessonNum} — Drills`,
    quiz: computeQuizTitle(unitNum, lessonNum),
    blooket: `Topic ${unitNum}.${lessonNum} — Blooket Review`,
  };
}

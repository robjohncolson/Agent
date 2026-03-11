import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { AGENT_ROOT, CARTRIDGES_DIR } from "./paths.mjs";

export const REGISTRY_PATH = join(AGENT_ROOT, "state", "lesson-registry.json");

const URL_KEYS = new Set([
  "worksheet",
  "drills",
  "quiz",
  "blooket",
  "schoologyFolder",
  "schoologyFolderE",
  "videos",
]);

const STATUS_KEYS = new Set([
  "ingest",
  "worksheet",
  "drills",
  "blooketCsv",
  "blooketUpload",
  "animations",
  "animationUpload",
  "schoology",
  "schoologyVerified",
  "urlsGenerated",
  "registryExported",
  "committed",
]);

const STATUS_VALUES = new Set([
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
  "scraped",
]);

const DRILLS_CARTRIDGE_BY_UNIT = {
  5: "apstats-u5-sampling-dist",
  6: "apstats-u6-inference-prop",
};

function toPositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer. Received: ${value}`);
  }
  return parsed;
}

function lessonKey(unit, lesson) {
  return `${unit}.${lesson}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function resolveSchoologyPeriod(schoologyObj, period) {
  if (!schoologyObj) return null;
  // New format: keyed by period letter
  if (schoologyObj[period]) return schoologyObj[period];
  // Old format: flat object with folderId at top level (treat as B)
  if (schoologyObj.folderId !== undefined && period === 'B') return schoologyObj;
  return null;
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) {
    return [...patch];
  }

  if (!isPlainObject(patch)) {
    return patch;
  }

  const source = isPlainObject(base) ? base : {};
  const merged = { ...source };

  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      merged[key] = [...value];
      continue;
    }

    if (isPlainObject(value)) {
      merged[key] = deepMerge(source[key], value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function createDefaultEntry(unit, lesson) {
  return {
    unit,
    lesson,
    topic: null,
    date: null,
    period: null,
    urls: {
      worksheet: null,
      drills: null,
      quiz: null,
      blooket: null,
      schoologyFolder: null,
      videos: [],
    },
    status: {
      ingest: "pending",
      worksheet: "pending",
      drills: "pending",
      blooketCsv: "pending",
      blooketUpload: "pending",
      animations: "pending",
      animationUpload: "pending",
      schoology: "pending",
      schoologyVerified: "pending",
      urlsGenerated: "pending",
      registryExported: "pending",
      committed: "pending",
    },
    schoology: {},
    timestamps: {
      created: null,
      lastUpdated: null,
    },
  };
}

function loadJsonObject(pathForRead, fallbackLabel) {
  try {
    const raw = readFileSync(pathForRead, "utf8");
    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      console.warn(
        `[lesson-registry] ${fallbackLabel} is not a JSON object: ${pathForRead}`
      );
      return {};
    }

    return parsed;
  } catch (error) {
    console.warn(
      `[lesson-registry] Failed to read ${fallbackLabel} at ${pathForRead}: ${error.message}`
    );
    return {};
  }
}

function findDrillsUrl(unit, lesson) {
  const cartridgeId = DRILLS_CARTRIDGE_BY_UNIT[unit];
  if (!cartridgeId) {
    return null;
  }

  const manifestPath = join(CARTRIDGES_DIR, cartridgeId, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  const manifest = loadJsonObject(manifestPath, "drills manifest");
  const modes = Array.isArray(manifest.modes) ? manifest.modes : [];
  const pattern = new RegExp(`^${unit}\\.${lesson}(?:\\D|$)`);

  const match = modes.find((mode) => (
    isPlainObject(mode) &&
    typeof mode.name === "string" &&
    pattern.test(mode.name) &&
    typeof mode.id === "string"
  ));

  if (!match) {
    return null;
  }

  return (
    "https://lrsl-driller.vercel.app/platform/app.html" +
    `?c=${cartridgeId}&level=${match.id}`
  );
}

export function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return {};
  }

  return loadJsonObject(REGISTRY_PATH, "lesson registry");
}

export function saveRegistry(registry) {
  const output = isPlainObject(registry) ? registry : {};
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

export function getLesson(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const registry = loadRegistry();
  return registry[lessonKey(unitNum, lessonNum)] ?? null;
}

export function setLesson(unit, lesson, entry) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  const current = isPlainObject(registry[key]) ? registry[key] : {};
  const next = isPlainObject(entry) ? { ...entry } : {};
  const updatedAt = nowIso();

  next.unit = unitNum;
  next.lesson = lessonNum;
  next.timestamps = {
    ...(isPlainObject(current.timestamps) ? current.timestamps : {}),
    ...(isPlainObject(next.timestamps) ? next.timestamps : {}),
    lastUpdated: updatedAt,
  };

  if (!next.timestamps.created) {
    next.timestamps.created = updatedAt;
  }

  registry[key] = next;
  saveRegistry(registry);
  return next;
}

export function upsertLesson(unit, lesson, partialEntry) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  const existing = isPlainObject(registry[key]) ? registry[key] : {};
  const defaults = createDefaultEntry(unitNum, lessonNum);
  const patch = isPlainObject(partialEntry) ? partialEntry : {};
  const merged = deepMerge(deepMerge(defaults, existing), patch);
  const updatedAt = nowIso();
  const createdAt =
    isPlainObject(merged.timestamps) &&
    typeof merged.timestamps.created === "string" &&
    merged.timestamps.created.trim()
      ? merged.timestamps.created
      : updatedAt;

  merged.unit = unitNum;
  merged.lesson = lessonNum;
  merged.timestamps = {
    ...(isPlainObject(merged.timestamps) ? merged.timestamps : {}),
    created: createdAt,
    lastUpdated: updatedAt,
  };

  registry[key] = merged;
  saveRegistry(registry);
  return merged;
}

export function updateUrl(unit, lesson, urlKey, urlValue) {
  if (!URL_KEYS.has(urlKey)) {
    throw new Error(
      `Invalid urlKey "${urlKey}". Expected one of: ${[...URL_KEYS].join(", ")}`
    );
  }

  // Reject malformed Schoology folder URLs
  if ((urlKey === 'schoologyFolder' || urlKey === 'schoologyFolderE') && urlValue) {
    const fCount = (urlValue.match(/[?&]f=/g) || []).length;
    if (fCount > 1) {
      const lastF = urlValue.match(/[?&]f=(\d+)/g).pop();
      const folderId = lastF.replace(/[?&]f=/, '');
      const baseUrl = urlValue.split('?')[0];
      urlValue = `${baseUrl}?f=${folderId}`;
      console.warn(`[registry] Auto-fixed malformed folder URL for ${unit}.${lesson}: extracted f=${folderId}`);
    }
  }

  return upsertLesson(unit, lesson, {
    urls: {
      [urlKey]: urlValue,
    },
  });
}

export function updateStatus(unit, lesson, stepKey, statusValue) {
  if (!STATUS_KEYS.has(stepKey)) {
    throw new Error(
      `Invalid stepKey "${stepKey}". Expected one of: ${[...STATUS_KEYS].join(", ")}`
    );
  }

  if (!STATUS_VALUES.has(statusValue)) {
    throw new Error(
      `Invalid statusValue "${statusValue}". Expected one of: ${[...STATUS_VALUES].join(", ")}`
    );
  }

  return upsertLesson(unit, lesson, {
    status: {
      [stepKey]: statusValue,
    },
  });
}

export function updateSchoologyLink(unit, lesson, linkKey, statusObj) {
  console.warn('[registry] DEPRECATED: updateSchoologyLink() — use updateSchoologyMaterial() instead');
  if (typeof linkKey !== "string" || !linkKey.trim()) {
    throw new Error(`Invalid linkKey: "${linkKey}". Must be a non-empty string.`);
  }

  if (!isPlainObject(statusObj)) {
    throw new Error(`statusObj must be a plain object. Received: ${typeof statusObj}`);
  }

  return upsertLesson(unit, lesson, {
    schoologyLinks: {
      [linkKey]: statusObj,
    },
  });
}

export function getSchoologyLinks(unit, lesson) {
  console.warn('[registry] DEPRECATED: getSchoologyLinks() — use getSchoologyState() instead');
  const entry = getLesson(unit, lesson);
  if (!entry || !isPlainObject(entry.schoologyLinks)) {
    return null;
  }
  return entry.schoologyLinks;
}

export function setSchoologyState(unit, lesson, state, period = 'B') {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unitNum, lessonNum);
  }
  if (!registry[key].schoology || typeof registry[key].schoology !== 'object') {
    registry[key].schoology = {};
  }
  registry[key].schoology[period] = {
    folderId: state.folderId ?? null,
    folderPath: state.folderPath ?? null,
    folderTitle: state.folderTitle ?? null,
    verifiedAt: state.verifiedAt ?? null,
    reconciledAt: state.reconciledAt ?? null,
    materials: state.materials ?? {},
  };
  registry[key].timestamps.lastUpdated = nowIso();
  saveRegistry(registry);
}

export function getSchoologyState(unit, lesson, period = 'B') {
  const entry = getLesson(unit, lesson);
  return resolveSchoologyPeriod(entry?.schoology, period);
}

export function updateSchoologyMaterial(unit, lesson, type, materialData, period = 'B') {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");
  const key = lessonKey(unitNum, lessonNum);
  const registry = loadRegistry();
  if (!registry[key]) {
    registry[key] = createDefaultEntry(unitNum, lessonNum);
  }
  if (!registry[key].schoology || typeof registry[key].schoology !== 'object') {
    registry[key].schoology = {};
  }
  if (!registry[key].schoology[period]) {
    registry[key].schoology[period] = {
      folderId: null, folderPath: null, folderTitle: null,
      verifiedAt: null, reconciledAt: null, materials: {}
    };
  }
  registry[key].schoology[period].materials[type] = {
    ...(registry[key].schoology[period].materials[type] || {}),
    ...materialData,
  };
  registry[key].timestamps.lastUpdated = nowIso();
  saveRegistry(registry);
}

export function computeUrls(unit, lesson) {
  const unitNum = toPositiveInt(unit, "unit");
  const lessonNum = toPositiveInt(lesson, "lesson");

  return {
    worksheet:
      `https://robjohncolson.github.io/apstats-live-worksheet/` +
      `u${unitNum}_lesson${lessonNum}_live.html`,
    quiz:
      lessonNum > 1
        ? `https://robjohncolson.github.io/curriculum_render/?u=${unitNum}&l=${lessonNum - 1}`
        : null,
    drills: findDrillsUrl(unitNum, lessonNum),
  };
}

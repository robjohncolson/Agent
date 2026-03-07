# Wave 1 Agent B: Parameterize Cartridge Path (Item #6)

Edit the file `scripts/lesson-prep.mjs`. Make these changes:

## Change 1: Add `findCartridgePath()` function

Add this function BEFORE the existing `buildManifestExcerpt()` function (which starts around line 452):

```javascript
function findCartridgePath(unit) {
  const cartridgesDir = path.join(WORKING_DIRS.driller, "cartridges");
  if (!existsSync(cartridgesDir)) {
    return null;
  }
  const entries = readdirSync(cartridgesDir);
  const match = entries.find(
    (e) =>
      e.startsWith(`apstats-u${unit}`) &&
      statSync(path.join(cartridgesDir, e)).isDirectory()
  );
  return match || null;
}
```

## Change 2: Update `buildManifestExcerpt()` to accept `unit` parameter and use `findCartridgePath()`

Change the function signature from `function buildManifestExcerpt()` to `function buildManifestExcerpt(unit)`.

Replace the hardcoded path logic inside. The current code is:
```javascript
function buildManifestExcerpt() {
  const manifestPath = path.join(
    WORKING_DIRS.driller,
    "cartridges",
    "apstats-u6-inference-prop",
    "manifest.json"
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const lastModes = Array.isArray(manifest.modes) ? manifest.modes.slice(-2) : [];
  const lastMode = lastModes[lastModes.length - 1] || {};

  return {
    manifestPath: "cartridges/apstats-u6-inference-prop/manifest.json",
    generatorPath: "cartridges/apstats-u6-inference-prop/generator.js",
    gradingRulesPath: "cartridges/apstats-u6-inference-prop/grading-rules.js",
    metaName: manifest.meta?.name || "",
    metaDescription: manifest.meta?.description || "",
    lastModeId: lastMode.id || "(none)",
    lastModeName: lastMode.name || "(none)",
    lastModesJson: JSON.stringify(lastModes, null, 2),
  };
}
```

Replace it with:
```javascript
function buildManifestExcerpt(unit) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) {
    return null;
  }

  const cartridgeDir = path.join(WORKING_DIRS.driller, "cartridges", cartridgeName);
  const manifestPath = path.join(cartridgeDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const lastModes = Array.isArray(manifest.modes) ? manifest.modes.slice(-2) : [];
  const lastMode = lastModes[lastModes.length - 1] || {};

  return {
    cartridgeName,
    manifestPath: `cartridges/${cartridgeName}/manifest.json`,
    generatorPath: `cartridges/${cartridgeName}/generator.js`,
    gradingRulesPath: `cartridges/${cartridgeName}/grading-rules.js`,
    metaName: manifest.meta?.name || "",
    metaDescription: manifest.meta?.description || "",
    lastModeId: lastMode.id || "(none)",
    lastModeName: lastMode.name || "(none)",
    lastModesJson: JSON.stringify(lastModes, null, 2),
  };
}
```

## Change 3: Update the call site in `step2_contentGeneration()`

Find the line `const manifestExcerpt = buildManifestExcerpt();` (around line 745) and change it to:
```javascript
const manifestExcerpt = buildManifestExcerpt(unit);
```

## Change 4: Update `validateDrillsTask()` to use `findCartridgePath()`

In `validateDrillsTask()`, replace the hardcoded path:
```javascript
function validateDrillsTask(unit, lesson) {
  const manifestPath = path.join(
    WORKING_DIRS.driller,
    "cartridges",
    "apstats-u6-inference-prop",
    "manifest.json"
  );
```

with:
```javascript
function validateDrillsTask(unit, lesson) {
  const cartridgeName = findCartridgePath(unit);
  if (!cartridgeName) {
    const error = "No cartridge directory found for unit " + unit;
    console.log(`    Validation: ${error}`);
    return { ok: false, error };
  }
  const manifestPath = path.join(
    WORKING_DIRS.driller,
    "cartridges",
    cartridgeName,
    "manifest.json"
  );
```

Apply all edits directly to `scripts/lesson-prep.mjs`.

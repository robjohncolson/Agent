# Animation Naming Contract Spec

**Problem:** Codex generates `.py` animation files and manifest `"animation"` fields independently. When the Scene class name in the `.py` file doesn't match the manifest's `"animation"` field, the rendered `.mp4` can't be found at upload time.

**Example (Topic 6.8 incident):**
- Manifest: `"assets/TwoSampleZIntervalProcedure.mp4"`
- Scene class: `IdentifyTwoPropCI`
- Rendered file: `IdentifyTwoPropCI.mp4`
- Result: upload script can't find `TwoSampleZIntervalProcedure.mp4` → animation missing in production

## Root Cause

The naming contract has three linked parts with no automated enforcement:

```
manifest "animation" field  ←→  .py Scene class name  ←→  rendered .mp4 filename
"assets/Foo.mp4"                 class Foo(Scene)           Foo.mp4
```

Manim derives the `.mp4` filename from the Scene class name. The manifest must reference that exact name. But:

1. **The Codex prompt** (`build-codex-prompts.mjs:352-385`) tells Codex to create both the manifest entries and `.py` files, but doesn't explicitly require the `"animation"` field value to equal the Scene class name.
2. **Step 2 validation** (`lesson-prep.mjs:730-758`) only checks that the manifest contains a mode name with the lesson number — it doesn't cross-check animation filenames.
3. **Step 4 upload** (`upload-animations.mjs:161-240`) uses fuzzy substring matching to find files, which masks partial mismatches but fails on complete renames.

## Fix: Three Layers

### Layer 1: Prompt Constraint (build-codex-prompts.mjs)

Add an explicit naming rule to the Drills Cartridge prompt:

```
CRITICAL NAMING RULE — the manifest "animation" field and the Manim Scene
class name MUST be identical. Manim renders {ClassName}.mp4; the manifest
must reference "assets/{ClassName}.mp4". If they differ, the animation
will not load.

Example:
  .py file:   animations/apstat_68_check_conditions.py
  Scene class: class CheckConditions(Scene):
  manifest:    "animation": "assets/CheckConditions.mp4"
                                    ^^^^^^^^^^^^^^^ must equal class name
```

**File:** `scripts/lib/build-codex-prompts.mjs` — insert into the `buildDrillsPrompt()` animation instructions block.

### Layer 2: Post-Generation Validation (lesson-prep.mjs)

After Step 2 Drills Cartridge completes, add a cross-check:

```javascript
function validateAnimationNames(cartridgePath, animationsDir, unit, lesson) {
  const manifest = JSON.parse(fs.readFileSync(path.join(cartridgePath, 'manifest.json')));
  const lessonPattern = `${unit}.${lesson}`;
  const errors = [];

  for (const mode of manifest.modes || []) {
    if (!mode.name?.includes(lessonPattern) || !mode.animation) continue;

    const expectedMp4 = path.basename(mode.animation); // e.g. "Foo.mp4"
    const expectedClass = expectedMp4.replace('.mp4', ''); // e.g. "Foo"

    // Find the corresponding .py file
    const prefix = `apstat_${unit}${lesson}_`;
    const pyFiles = fs.readdirSync(animationsDir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.py'));

    // Check if any .py file defines a Scene class matching expectedClass
    let found = false;
    for (const pyFile of pyFiles) {
      const content = fs.readFileSync(path.join(animationsDir, pyFile), 'utf8');
      if (content.includes(`class ${expectedClass}(`)) {
        found = true;
        break;
      }
    }

    if (!found) {
      errors.push(`Manifest expects "${expectedMp4}" but no .py file defines class ${expectedClass}`);
    }
  }

  return errors;
}
```

On validation failure:
- Log the mismatches clearly
- Auto-fix if possible: read the actual Scene class from the `.py` file and patch the manifest
- Abort upload if unfixable

**File:** `scripts/lesson-prep.mjs` — add after the existing `validateDrillsTask()` call (~line 758).

### Layer 3: Auto-Repair in Upload Script (upload-animations.mjs)

When exact-match fails, instead of fuzzy substring matching:

1. Scan all rendered `.mp4` files for the lesson
2. Read the source `.py` files to find Scene class → manifest mode mapping via mode ID
3. If a mapping can be confidently determined, patch the manifest in-place and log a warning

This is a safety net — Layer 2 should catch most issues before rendering even starts.

**File:** `lrsl-driller/scripts/upload-animations.mjs` — replace the priority 2-4 fuzzy matching (~lines 170-240).

## Implementation Priority

| Layer | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1. Prompt constraint | 5 min | Prevents ~80% of mismatches | Do first |
| 2. Post-gen validation | 30 min | Catches remaining mismatches, can auto-fix | Do second |
| 3. Upload auto-repair | 20 min | Safety net for edge cases | Optional |

## Testing

After implementing, run the pipeline for a previously-completed lesson (e.g., `--unit 6 --lesson 7 --skip-ingest --skip-schoology`) and verify:
- Validation passes with no naming errors
- All 5 animations upload with 0 "not found"

To regression-test the prompt constraint, intentionally mismatch a name and confirm Layer 2 catches it.

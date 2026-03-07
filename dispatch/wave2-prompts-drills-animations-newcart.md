# Wave 2 Agent C: Generator/Grading Excerpts + Animations + New Cartridge Path

This task depends on Wave 1 being complete. The `findCartridgePath(unit)` and parameterized `buildManifestExcerpt(unit)` functions already exist in `scripts/lesson-prep.mjs`.

Edit TWO files:
- `scripts/lesson-prep.mjs`
- `scripts/lib/build-codex-prompts.mjs`

---

## Part 1: Expand `buildManifestExcerpt()` with generator + grading excerpts (Item #4)

In `scripts/lesson-prep.mjs`, the `buildManifestExcerpt(unit)` function currently returns an object with manifest metadata. Expand it to also extract code excerpts.

Add this helper function BEFORE `buildManifestExcerpt()`:

```javascript
function extractLastCaseBlock(fileContent) {
  // Find the last `case "l` or `case 'l` block in a switch statement
  const casePattern = /case\s+["']l\d+-[^"']+["']\s*:\s*\{[\s\S]*?\n\s*\}/g;
  const matches = [...fileContent.matchAll(casePattern)];
  if (matches.length > 0) {
    return matches[matches.length - 1][0];
  }

  // Fallback: return last 150 lines
  const lines = fileContent.split("\n");
  return lines.slice(-150).join("\n");
}
```

Then in `buildManifestExcerpt(unit)`, after the existing return object is built but before returning, add extraction of generator and grading excerpts:

```javascript
  // Extract generator excerpt
  let generatorExcerpt = "";
  const generatorPath = path.join(cartridgeDir, "generator.js");
  if (existsSync(generatorPath)) {
    const generatorContent = readFileSync(generatorPath, "utf-8");
    generatorExcerpt = extractLastCaseBlock(generatorContent);
  }

  // Extract grading-rules excerpt
  let gradingRulesExcerpt = "";
  const gradingRulesFilePath = path.join(cartridgeDir, "grading-rules.js");
  if (existsSync(gradingRulesFilePath)) {
    const gradingContent = readFileSync(gradingRulesFilePath, "utf-8");
    gradingRulesExcerpt = extractLastCaseBlock(gradingContent);
  }

  // Find animation example
  let animationExample = "";
  const animDir = path.join(WORKING_DIRS.driller, "animations");
  if (existsSync(animDir)) {
    const animFiles = readdirSync(animDir)
      .filter((f) => f.startsWith(`apstat_${unit}`) && f.endsWith(".py"))
      .sort()
      .reverse();
    if (animFiles.length > 0) {
      const content = readFileSync(path.join(animDir, animFiles[0]), "utf-8");
      const lines = content.split("\n");
      animationExample = lines.slice(0, 80).join("\n");
    }
  }
```

And add these three fields to the returned object:
```javascript
    generatorExcerpt,
    gradingRulesExcerpt,
    animationExample,
```

---

## Part 2: Add generator/grading/animation sections to `buildDrillsPrompt()` (Items #4, #5)

In `scripts/lib/build-codex-prompts.mjs`, in the `buildDrillsPrompt()` function, add these sections AFTER the `## Video context` section and BEFORE `## Requirements`:

```
${manifestExcerpt.generatorExcerpt ? `## Generator pattern (last mode from generator.js)

Follow this exact pattern when adding new generator cases:

\`\`\`javascript
${manifestExcerpt.generatorExcerpt}
\`\`\`
` : ""}
${manifestExcerpt.gradingRulesExcerpt ? `## Grading rules pattern (last mode from grading-rules.js)

Follow this exact pattern when adding new grading rule cases:

\`\`\`javascript
${manifestExcerpt.gradingRulesExcerpt}
\`\`\`
` : ""}
## Platform reference

The cartridge must comply with the Driller Platform cartridge spec. Key rules:
- generator.js must export generateProblem(modeId, context, mode)
- grading-rules.js must export gradeField(fieldId, answer, context) returning {score, feedback}
- Score values: 'E' (essentially correct), 'P' (partial), 'I' (incorrect)
- Mode IDs must match between manifest modes[] and progression.tiers[]
- Field IDs must match between mode.layout.inputs[].id and hints.perField keys
- Use shuffle bags for scenario variety; randomize numeric values and answer order
${manifestExcerpt.animationExample ? `
## Animation files

For EACH new mode, create a Manim animation file at:
  \`animations/apstat_${unit}${lesson}_\${mode_slug}.py\`

where \`\${mode_slug}\` is a descriptive name derived from the mode (e.g., for mode
"l15-identify-error-type", use \`identify_error_type\`).

### Animation pattern

Here is an example animation from a previous lesson:

\`\`\`python
${manifestExcerpt.animationExample}
\`\`\`

### Animation requirements

- Each animation must be a single Scene subclass
- Use \`from manim import *\` (ManimCE)
- Set \`self.camera.background_color = "#1C1C1C"\` (dark background)
- Use \`Text()\` with Unicode characters for all text — do NOT use \`MathTex()\` or \`Tex()\`
  (LaTeX is unreliable on this machine)
- Unicode reference: H₀ = "\\u2080", Hₐ = "\\u2090", p̂ = "\\u0302",
  α = "\\u03b1", β = "\\u03b2", μ = "\\u03bc", σ = "\\u03c3",
  ≠ = "\\u2260", ≤ = "\\u2264", ≥ = "\\u2265"
- Use consistent color scheme: BLUE_3B1B = "#3B82F6", YELLOW_3B1B = "#FACC15",
  TEAL_3B1B = "#2DD4BF", GREEN_3B1B = "#22C55E", PINK_3B1B = "#EC4899"
- Include a docstring with the manim render command
- Each animation should be 15-45 seconds, visualizing ONE key concept from the mode
- Do NOT use NumberLine(include_numbers=True) or Axes with numbers_to_include
  (these use LaTeX internally) — add labels manually with Text()
` : ""}
```

---

## Part 3: Add `buildTemplateExcerpt()` and `buildNewCartridgePrompt()` (Item #7)

### 3a. In `scripts/lesson-prep.mjs`, add `buildTemplateExcerpt()` function

Add this function after `buildManifestExcerpt()`:

```javascript
function buildTemplateExcerpt() {
  const templateDir = path.join(WORKING_DIRS.driller, "cartridges", "_template");
  const result = {};

  for (const filename of ["manifest.json", "generator.js", "grading-rules.js"]) {
    const filePath = path.join(templateDir, filename);
    if (existsSync(filePath)) {
      result[filename] = readFileSync(filePath, "utf-8");
    }
  }

  return result;
}
```

### 3b. In `scripts/lib/build-codex-prompts.mjs`, add `buildNewCartridgePrompt()` function

Add this new exported function AFTER `buildDrillsPrompt()`:

```javascript
export function buildNewCartridgePrompt(unit, lesson, videoContext, templateExcerpt, animationExample) {
  const sharedContext = buildSharedContext(unit, lesson, videoContext);
  const frameworkBlock = buildFrameworkBlock(unit, lesson);

  return `You are creating a NEW drill cartridge for the lrsl-driller platform.
Use only the embedded context and template patterns below. Do not rely on external repo exploration.

Create a new cartridge directory: cartridges/apstats-u${unit}-{slug}/
where {slug} is a short kebab-case description of the unit topic.

Create these files in the new directory:
- manifest.json
- generator.js
- grading-rules.js
- ai-grader-prompt.txt

Also add the new cartridge to cartridges/registry.json.

## Template patterns

### manifest.json structure
\`\`\`json
${templateExcerpt["manifest.json"] || ""}
\`\`\`

### generator.js export pattern
\`\`\`javascript
${templateExcerpt["generator.js"] || ""}
\`\`\`

### grading-rules.js export pattern
\`\`\`javascript
${templateExcerpt["grading-rules.js"] || ""}
\`\`\`

## Video context (source material)

${sharedContext}
${frameworkBlock}
## Cartridge spec key rules

- generator.js must export generateProblem(modeId, context, mode)
- grading-rules.js must export gradeField(fieldId, answer, context) returning {score, feedback}
- Score values: 'E' (essentially correct), 'P' (partial), 'I' (incorrect)
- Mode IDs must match between manifest modes[] and progression.tiers[]
- Field IDs must match between mode.layout.inputs[].id and hints.perField keys
- Use shuffle bags for scenario variety; randomize numeric values and answer order
- Mode ID format: l{lesson_number}-{kebab-description} (e.g., "l15-identify-error-type")

## Requirements

- Create 3-5 modes for Topic ${unit}.${lesson}: ${videoContext.topicTitle}
- Scope questions to ONLY content addressed in the video, not the full unit
- Each mode should map to a distinct skill or concept from the lesson
- Ensure at least one mode name literally includes "${unit}.${lesson}"
- Follow the template patterns exactly for file structure and exports
${animationExample ? `
## Animation files

For EACH new mode, create a Manim animation file at:
  animations/apstat_${unit}${lesson}_{mode_slug}.py

### Animation pattern

\`\`\`python
${animationExample}
\`\`\`

### Animation requirements

- Each animation must be a single Scene subclass
- Use \`from manim import *\` (ManimCE)
- Set \`self.camera.background_color = "#1C1C1C"\` (dark background)
- Use Text() with Unicode characters for all text — do NOT use MathTex() or Tex()
- Unicode reference: H₀ = "\\u2080", Hₐ = "\\u2090", p̂ = "\\u0302",
  α = "\\u03b1", β = "\\u03b2", μ = "\\u03bc", σ = "\\u03c3",
  ≠ = "\\u2260", ≤ = "\\u2264", ≥ = "\\u2265"
- Use consistent color scheme: BLUE_3B1B = "#3B82F6", YELLOW_3B1B = "#FACC15",
  TEAL_3B1B = "#2DD4BF", GREEN_3B1B = "#22C55E", PINK_3B1B = "#EC4899"
- Include a docstring with the manim render command
- Each animation should be 15-45 seconds, visualizing ONE key concept
- Do NOT use NumberLine(include_numbers=True) or Axes with numbers_to_include
` : ""}
Apply all changes directly to the repository files.`;
}
```

### 3c. Update the import in `scripts/lesson-prep.mjs`

Update the import statement at the top to include the new function:
```javascript
import {
  buildBlooketPrompt,
  buildDrillsPrompt,
  buildNewCartridgePrompt,
  buildWorksheetPrompt,
  readVideoContext,
} from "./lib/build-codex-prompts.mjs";
```

### 3d. Add create-vs-extend branching in `step2_contentGeneration()`

In `step2_contentGeneration()`, replace the line:
```javascript
    const manifestExcerpt = buildManifestExcerpt(unit);
```

With this branching logic:
```javascript
    const manifestExcerpt = buildManifestExcerpt(unit);

    let drillsPromptFn;
    if (manifestExcerpt) {
      console.log(`  Cartridge found: ${manifestExcerpt.cartridgeName} (extending)`);
      drillsPromptFn = () => buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt);
    } else {
      console.log(`  No cartridge for unit ${unit} — will create new cartridge`);
      const templateExcerpt = buildTemplateExcerpt();
      // Find animation example from any existing unit
      let animationExample = "";
      const animDir = path.join(WORKING_DIRS.driller, "animations");
      if (existsSync(animDir)) {
        const animFiles = readdirSync(animDir)
          .filter((f) => f.startsWith("apstat_") && f.endsWith(".py"))
          .sort()
          .reverse();
        if (animFiles.length > 0) {
          const content = readFileSync(path.join(animDir, animFiles[0]), "utf-8");
          animationExample = content.split("\n").slice(0, 80).join("\n");
        }
      }
      drillsPromptFn = () => buildNewCartridgePrompt(unit, lesson, videoContext, templateExcerpt, animationExample);
    }
```

Then replace the line:
```javascript
    drillsPrompt = buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt);
```

With:
```javascript
    drillsPrompt = drillsPromptFn();
```

Apply all edits to both files.

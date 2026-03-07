# Wave 1 Agent A: AP Framework + Blooket Rewrite + Worksheet Guardrails

Edit the file `scripts/lib/build-codex-prompts.mjs`. Make these three changes:

## Change 1: Add `extractFrameworkSection()` function

Add this new function AFTER the existing `extractTopicTitleFromFramework()` function (after line ~40):

```javascript
function extractFrameworkSection(unit, lesson) {
  const frameworkPath = path.join(WORKSHEET_ROOT, `apstat_${unit}_framework.md`);
  if (!existsSync(frameworkPath)) {
    return null;
  }

  const framework = readFileSync(frameworkPath, "utf-8");
  const sectionPattern = new RegExp(
    `## \\*\\*TOPIC ${escapeRegExp(unit)}\\.${escapeRegExp(lesson)}\\b[\\s\\S]*?(?=## \\*\\*TOPIC|$)`,
    "i"
  );
  const match = framework.match(sectionPattern);
  return match ? match[0].trim() : null;
}
```

Then add a `buildFrameworkBlock()` helper right after it:

```javascript
function buildFrameworkBlock(unit, lesson) {
  const section = extractFrameworkSection(unit, lesson);
  if (!section) {
    return "";
  }

  return `\n## AP Classroom Framework (Topic ${unit}.${lesson})

This is the official AP scope for this lesson. Questions MUST align with these
learning objectives and essential knowledge statements. Do not test concepts
beyond what is listed here.

${section}\n`;
}
```

## Change 2: Embed framework block in all three prompt builders

In `buildWorksheetPrompt()`: Insert `${buildFrameworkBlock(unit, lesson)}` AFTER the `## Video context` section and BEFORE the `## Requirements` section.

In `buildBlooketPrompt()`: Insert `${buildFrameworkBlock(unit, lesson)}` AFTER the `## Video context` section and BEFORE the `## Requirements` section.

In `buildDrillsPrompt()`: Insert `${buildFrameworkBlock(unit, lesson)}` AFTER the `## Video context` section and BEFORE the `## Requirements` section.

## Change 3: Rewrite the Blooket `## Requirements` section

In `buildBlooketPrompt()`, REPLACE the entire `## Requirements` section (from `## Requirements` through `Write the CSV directly to disk`) with:

```
## Requirements

### Question Design
- Test CONCEPTUAL UNDERSTANDING, not recall of specific examples or numbers from the videos
- No questions requiring mental math or calculation — focus on reasoning and definitions
- Do not reference specific numerical examples from the videos (e.g., don't ask "in the
  hospital survey, what was the sample size?")
- Questions should test whether students understand WHY, not just WHAT
- Include questions that surface common misconceptions from the AP framework
- Target these categories:
  - Core definitions and when/why they matter (not just "what is X")
  - Procedural reasoning ("what must you check BEFORE doing X?", "what comes first?")
  - Misconception traps ("which of the following is a common error?")
  - Conceptual distinctions ("how does X differ from Y?")

### Answer Choice Design
- All 4 answer choices must be similar in LENGTH (within ~10 characters of each other)
- All 4 answer choices must be similar in COMPLEXITY and sentence structure
- The correct answer must NOT be identifiable by style alone — no "obviously longest"
  or "most detailed" correct answer
- Wrong answers must be plausible conceptual errors, not absurd or obviously wrong
- Randomize which position (1-4) holds the correct answer across questions

### Format
- 25-35 multiple choice questions covering all key concepts from ${videoScope}
- Time limit: 20 seconds for all questions
- Do NOT include any extra text, headers, or explanations — just the raw CSV

Write the CSV directly to disk in the current directory.
```

## Change 4: Add Worksheet Guardrails

In `buildWorksheetPrompt()`, add this `### Constraints` subsection at the END of the `## Requirements` section (just before the final backtick-delimited template literal closing):

```
### Constraints
- Do NOT add, remove, or modify any CSS rules or JS functions from the pattern file.
  Only change the HTML content sections.
- data-answer values must be concise (1-3 words). Include common misspellings and
  equivalent phrasings as pipe-separated alternatives.
  Good: data-answer="reject|reject H0|reject the null"
  Bad: data-answer="we reject the null hypothesis because the p-value is less than alpha"
- Use width 80px for single-word answers, 150px for short phrases, 250px for longer answers.
- Questions must follow the AP framework scope — do not test concepts beyond the
  learning objectives listed above.
```

Apply all edits directly to `scripts/lib/build-codex-prompts.mjs`.

# Cartridge Generation Prompt

**Reusable template for extending lrsl-driller cartridges with new lesson modes.**

## Prompt

Extend the existing lrsl-driller cartridge to cover AP Statistics Topic {UNIT}.{LESSON}: {TOPIC_NAME}.

The cartridge to extend is at `cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/`.

You will modify/create these files:
1. `manifest.json` -- add new modes for the lesson
2. `generator.js` -- add problem banks for new modes
3. `grading-rules.js` -- add grading logic for new modes
4. `ai-grader-prompt.txt` -- append topic-specific grading context
5. `animations/apstat_{UNIT}{LESSON}_*.py` -- Manim animation files for each new mode
6. Update cartridge `meta.name` and `meta.description` to reflect the expanded topic range

---

### Step 1: Read video context

Read the video transcription and slide files for this lesson:
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_transcription.txt`
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_slides.txt`

Identify from the source material:
- Key concepts that become drill modes (each distinct skill = one mode)
- Vocabulary and definitions for fill-in or dropdown questions
- Calculation procedures for numeric-input modes
- Common student errors that become diagnostic feedback in grading-rules.js
- Visual concepts that benefit from Manim animations

---

### Step 2: Read existing cartridge state

Read the current cartridge files to understand what already exists:

```
cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/manifest.json
cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/generator.js
cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/grading-rules.js
cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/ai-grader-prompt.txt
```

From `manifest.json`, determine:
- The last mode ID number (e.g., if the last mode is `l23-capstone-64`, the next mode starts at `l24`)
- The existing `meta.name` and `meta.description`
- The existing `config.skills` array
- The existing mode patterns (input types, unlock conditions, animation references)

---

### Step 3: Design new modes

Each lesson topic should produce 4-7 modes plus a capstone. Follow the established patterns:

#### Mode ID convention

Mode IDs follow the pattern `l{NN}-{descriptive-slug}` where NN continues the sequence from existing modes.

Example: If the last existing mode is `l23-capstone-64`, new modes for Topic 6.5 start at `l24`:
- `l24-test-statistic` (6.5a)
- `l25-calculate-pvalue` (6.5b)
- `l26-interpret-pvalue` (6.5c)
- `l27-test-direction` (6.5d)
- `l28-capstone-65` (6.5 Capstone)

#### Mode name convention

```
"{UNIT}.{LESSON}{letter}: {Short Skill Name}"
```
Examples: `"6.5a: Calculate Test Statistic"`, `"6.5b: Calculate p-Value"`, `"6.5 Capstone"`

#### Input types available

| Type | Use for | Example |
|------|---------|---------|
| `choice` | Binary or 3-option selection | "Yes/No" condition checks |
| `dropdown` | 4+ options, single correct | Selecting the right hypothesis |
| `text` | Short free-form answers | Writing H0: p = 0.5 |
| `number` | Calculations | Standard error, z-score, p-value |
| `textarea` | Open-ended explanations | Interpreting results in context |

#### Unlock conditions

- Regular modes: `"unlockedBy": { "gold": 1 }` (need 1 gold star on any prior mode)
- Capstone modes: `"unlockedBy": { "gold": 3 }` (need 3 gold stars, harder unlock)
- First mode of a new topic: `"unlockedBy": { "gold": 1 }` (accessible from prior topic)

#### Animation references

Each mode references an animation asset:
```json
"animation": "assets/{AnimationName}.mp4"
```
The animation filename should match the Manim class name in PascalCase.

---

### Step 4: Update manifest.json

#### Add new modes

Append new mode objects to the `modes` array. Each mode follows this structure:

```json
{
  "id": "l{NN}-{slug}",
  "name": "{UNIT}.{LESSON}{letter}: {Skill Name}",
  "animation": "assets/{AnimationName}.mp4",
  "unlockedBy": { "gold": 1 },
  "layout": {
    "inputs": [
      {
        "id": "{fieldId}",
        "type": "{choice|dropdown|text|number|textarea}",
        "label": "{{questionText}}",
        ...type-specific properties
      }
    ]
  }
}
```

For `number` inputs, include `step` and optionally `min`/`max`:
```json
{ "id": "zStatAnswer", "type": "number", "label": "Calculate z = ...", "step": 0.01 }
```

For `dropdown` inputs, use template variables for options:
```json
{ "id": "answerField", "type": "dropdown", "label": "...", "options": ["{{optA}}", "{{optB}}", "{{optC}}", "{{optD}}"], "placeholder": "Choose..." }
```

For `textarea` inputs, include rows and placeholder:
```json
{ "id": "explainField", "type": "textarea", "label": "Explain...", "rows": 3, "placeholder": "Helpful hint..." }
```

#### Update meta

```json
"meta": {
  "name": "Inference for Proportions (6.1-{UNIT}.{LAST_LESSON})",
  "description": "{Updated description covering all topics including new ones}"
}
```

#### Update config.skills

Add any new AP skill codes to the `config.skills` array.

---

### Step 5: Update generator.js

#### Add scenario banks

For each new mode, add a scenario bank array. Follow the existing pattern:

```javascript
// ---- Topic {UNIT}.{LESSON}: {Skill Name} scenario bank ----
const {skillName}Bank = [
  {
    desc: "{Real-world scenario description}",
    population: "{target population}",
    sampleAction: "{how sample was collected}",
    successDesc: "{what counts as a success}",
    unit: "{units being measured}",
    // ...mode-specific fields (n, pHat, p0, etc.)
  },
  // Include 8-12 diverse scenarios per bank
];
```

#### Scenario diversity rules

1. **Varied contexts**: Medical studies, manufacturing, education, politics, sports, consumer products, environmental science, social media, food industry, transportation
2. **Varied numbers**: Different sample sizes (small like 30, medium like 100-200, large like 500+), different proportions (near 0, near 0.5, near 1)
3. **No repeated contexts within a bank**: Each scenario should be a completely different real-world situation
4. **Gender and cultural neutrality**: Avoid stereotypes in scenario descriptions

#### Add generateProblem cases

Add cases to the `generateProblem(modeId, context, mode)` function for each new mode:

```javascript
case "l{NN}-{slug}": {
  const scenario = drawFromBag("{bankName}", {bankArray});
  // Compute derived values
  // Return context object with all template variables
  return {
    topicId: "{UNIT}.{LESSON}",
    scenarioText: scenario.desc,
    givenText: `n = ${scenario.n}, ...`,
    questionText: "...",
    // ...all fields needed by the mode's layout inputs
    answers: {
      fieldId: { value: correctAnswer, tolerance: 0.01 }
    }
  };
}
```

#### Use shuffle bags

Always use `drawFromBag(bankName, bankArray)` instead of `choice(bankArray)` to prevent scenario repeats:

```javascript
const scenario = drawFromBag("l{NN}Bank", l{NN}Bank);
```

---

### Step 6: Update grading-rules.js

Add grading logic for each new mode's fields to the `gradeField(fieldId, answer, context)` function.

#### For numeric fields

```javascript
// Field: {fieldId} (Topic {UNIT}.{LESSON})
if (fieldId === "{fieldId}") {
  const exp = getExpectedObj(context, "{fieldId}");
  const num = parseFloat(answer);
  if (isNaN(num)) return { score: "I", feedback: "Please enter a number." };
  const tol = exp.tolerance || 0.01;
  if (Math.abs(num - exp.value) <= tol) {
    return { score: "E", feedback: "Correct!" };
  }
  // Check for common errors and provide diagnostic feedback
  if (Math.abs(num - {commonWrongAnswer}) <= tol) {
    return { score: "P", feedback: "{Diagnostic: explain what they likely did wrong}" };
  }
  return { score: "I", feedback: `Expected ${exp.value.toFixed(2)}.` };
}
```

#### For choice/dropdown fields

```javascript
if (fieldId === "{fieldId}") {
  const norm = normalize(answer);
  const exp = normalize(String(expected));
  if (norm === exp) return { score: "E", feedback: "Correct!" };
  // Diagnostic feedback for specific wrong choices
  if (containsAny(answer, ["{wrong choice keyword}"])) {
    return { score: "I", feedback: "{Why this choice is wrong}" };
  }
  return { score: "I", feedback: "{General wrong answer feedback}" };
}
```

#### For textarea/open-response fields

```javascript
if (fieldId === "{fieldId}") {
  // Keyword-based partial grading (AI grading handles full rubric)
  if (containsAll(answer, ["{keyword1}", "{keyword2}"])) {
    return { score: "E", feedback: "Good response covering key elements." };
  }
  if (containsAny(answer, ["{keyword1}", "{keyword2}"])) {
    return { score: "P", feedback: "Partial — missing some key elements." };
  }
  return { score: "I", feedback: "Response does not address the key concepts." };
}
```

#### Diagnostic feedback rules

1. **Never just say "Wrong"** -- always explain WHY the answer is incorrect
2. **Name the misconception** -- e.g., "You may have used p-hat instead of p0 for the standard error"
3. **Guide toward correction** -- e.g., "Remember, in a significance test we assume H0 is true, so use p0"
4. **Check for common computational errors** -- off-by-one in rounding, sign errors, wrong formula

Add new field IDs to the `openResponseFields` Set and `numberFields` Set as appropriate.

---

### Step 7: Update ai-grader-prompt.txt

Append a new section to the existing `ai-grader-prompt.txt` for the new topic:

```
{UNIT}.{LESSON} {Topic Name}:
- {Key concept 1 with full explanation}
- {Key concept 2}
- {Common errors and what makes them wrong}
- {Specific grading criteria for open-response fields}

{UNIT}.{LESSON} {Specific Skill} ({fieldId}):
- A complete explanation MUST include:
  (1) {Required element 1}
  (2) {Required element 2}
  (3) {Required element 3}
- E: {Full criteria}
- P: {Partial criteria}
- I: {Incorrect criteria}
- Example of E response: "{Example}"
- Example of P response: "{Example}"
- Example of I response: "{Example}"
```

---

### Step 8: Generate Manim animation files

Create one `.py` file per mode in the `animations/` directory (at the repo root, NOT inside the cartridge).

#### File naming convention

```
animations/apstat_{UNIT}{LESSON}_{descriptive_name}.py
```

Examples from existing files:
- `apstat_64_state_null.py`
- `apstat_64_hypothesis_errors.py`
- `apstat_65_test_statistic.py`
- `apstat_65_calculate_pvalue.py`

#### Animation file structure

```python
"""
{Animation Title} (AP Stats Unit {UNIT}, Topic {UNIT}.{LESSON})

{Brief description of what the animation demonstrates visually.}

Run with: manim -qm --format=mp4 apstat_{UNIT}{LESSON}_{name}.py {ClassName}
"""
from manim import *
import numpy as np

# Consistent color scheme
BLUE_3B1B = "#3B82F6"
YELLOW_3B1B = "#FACC15"
TEAL_3B1B = "#2DD4BF"
GREEN_3B1B = "#22C55E"
PINK_3B1B = "#EC4899"


class {ClassName}(Scene):
    def construct(self):
        self.camera.background_color = "#1C1C1C"

        # ========== TITLE ==========
        title = Text("{Mode Title}", font_size=44, weight=BOLD)
        title.to_edge(UP, buff=0.3)
        self.play(Write(title))
        self.wait(0.3)

        subtitle = Text(
            "{Key concept being demonstrated}",
            font_size=24, color=YELLOW_3B1B
        )
        subtitle.next_to(title, DOWN, buff=0.15)
        self.play(FadeIn(subtitle))
        self.wait(0.5)

        # ========== MAIN CONTENT ==========
        # Build up the visual explanation step by step
        # Use transforms, highlights, and annotations
        # Keep animations under 30 seconds total

        # ========== CONCLUSION ==========
        self.play(*[FadeOut(mob) for mob in self.mobjects])
        self.wait(0.3)
```

#### Animation design rules

1. **Dark background**: Always use `self.camera.background_color = "#1C1C1C"`
2. **Consistent colors**: Use the 5-color palette defined above
3. **Duration**: 15-30 seconds total. Students watch these before attempting the problem.
4. **Concept focus**: Each animation teaches ONE concept visually. Do not try to cover everything.
5. **Progressive build-up**: Use `Write`, `FadeIn`, `Transform` to build up visuals step by step
6. **No text walls**: Use short labels and let the visual do the teaching
7. **Clean exit**: Fade out all mobjects at the end

#### Map animations to manifest modes

Each mode's `"animation"` field should reference the rendered MP4. The mapping is:
- Manim file: `animations/apstat_{UNIT}{LESSON}_{name}.py` with class `{ClassName}`
- Rendered to: `cartridges/apstats-u{UNIT}-{CARTRIDGE_SLUG}/assets/{ClassName}.mp4`
- Referenced in manifest as: `"animation": "assets/{ClassName}.mp4"`

---

### Step 9: Update cartridge meta

Update the `meta` section in `manifest.json`:

```json
"meta": {
  "id": "apstats-u{UNIT}-{CARTRIDGE_SLUG}",
  "name": "{Updated Name} ({UNIT}.{FIRST_TOPIC}-{UNIT}.{LAST_TOPIC})",
  "subject": "AP Statistics",
  "description": "{Comprehensive description covering ALL topics in the cartridge, including the new ones}"
}
```

Also add any new AP skill codes to `config.skills`.

---

### Output checklist

- [ ] `manifest.json` updated with new modes continuing the ID sequence
- [ ] `manifest.json` meta name/description updated for expanded topic range
- [ ] `manifest.json` config.skills updated with new AP skill codes
- [ ] `generator.js` updated with new scenario banks (8-12 scenarios each)
- [ ] `generator.js` uses shuffle bags for all new banks
- [ ] `grading-rules.js` updated with diagnostic feedback for every new field
- [ ] `ai-grader-prompt.txt` updated with new topic grading context
- [ ] Manim `.py` files created in `animations/` for each new mode
- [ ] Animation filenames follow `apstat_{UNIT}{LESSON}_{name}.py` convention
- [ ] Animation class names match the asset filenames in the manifest
- [ ] No existing modes or banks were modified (append-only)

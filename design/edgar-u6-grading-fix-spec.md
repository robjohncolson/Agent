# Spec: Fix AI Grading on Edgar U6 Conceptual Driller

## File
`C:/Users/ColsonR/apstats-live-worksheet/edgar_u6_conceptual_driller_live.html`

---

## Issue 1: Prompts don't load on `file://`

### Root Cause
Browsers block `<script src="ai-grading-prompts-edgar-u6.js">` under `file://`
protocol (same-origin policy treats each local file as its own origin). The hosted
GitHub Pages version works fine.

### Fix: Inline the prompts (Option C)

Replace line 1153:
```html
<script src="ai-grading-prompts-edgar-u6.js"></script>
```
With an inline `<script>` block containing the verbatim 267-line contents of
`ai-grading-prompts-edgar-u6.js`. This sets:
- `window.LESSON_CONTEXT_EDGAR_U6`
- `window.getRubricEdgarU6`
- `window.buildReflectionPromptEdgarU6`

Works on both `file://` and hosted. The external `.js` file stays in the repo
as reference but is no longer loaded.

---

## Issue 2: Per-question grading instead of bulk "Grade All"

### Current Behavior
One button in the top controls bar:
```html
<button class="btn-ai" onclick="gradeAllReflections()">🤖 Grade My Reflections</button>
```
This loops through all 8 textareas sequentially, grading them one after another.
The student has no control over which question to grade and must wait for all 8
API round-trips before seeing any results.

### Desired Behavior
Each reflection textarea gets its own "Grade" button placed directly below it.
The student clicks to grade one question at a time. The bulk button is removed.

### 8 Graded Textareas (unchanged IDs)

| # | ID | Section | Question |
|---|-----|---------|----------|
| R1 | `reflect_vocab` | 1. Language First | Parameter vs statistic (germination) |
| R2 | `reflect_conditions` | 3. Conditions | CI vs test large-counts distinction |
| R3 | `reflect_ci` | 4. Confidence Intervals | Construct, interpret, explain CI |
| R4 | `reflect_test` | 5. Significance Tests | z-stat, p-value, conclusion (bats) |
| R5 | `reflect_errors` | 6. Errors & Power | Type I/II in machine context |
| R6 | `reflect_twoprop` | 7–8. Two-Proportion | Why pool for test, not CI |
| C1 | `capstone1` | 9. Capstone I | Full one-prop inference (baked die) |
| C2 | `capstone2` | 10. Capstone II | Full two-prop inference (districts) |

### HTML Changes: Add per-question grade buttons

For each of the 8 textarea locations, insert a grade button between the
`<textarea>` and the `<div id="...-feedback">`. Example for `reflect_vocab`:

**Before (line 581-582):**
```html
<textarea id="reflect_vocab" placeholder="Write your response here..."></textarea>
<div id="reflect_vocab-feedback"></div>
```

**After:**
```html
<textarea id="reflect_vocab" placeholder="Write your response here..."></textarea>
<button class="btn-grade-single" onclick="gradeSingleReflection('reflect_vocab', this)">🤖 Grade This Response</button>
<div id="reflect_vocab-feedback"></div>
```

Apply the same pattern to all 8 textareas:
- `reflect_vocab` (line 581)
- `reflect_conditions` (line 724)
- `reflect_ci` (line 815)
- `reflect_test` (line 883)
- `reflect_errors` (line 940)
- `reflect_twoprop` (line 1005)
- `capstone1` (line 1075)
- `capstone2` (line 1104)

### HTML Changes: Remove the bulk button

**Line 466** — Remove:
```html
<button class="btn-ai" onclick="gradeAllReflections()">&#129302; Grade My Reflections</button>
```

### CSS Changes: Style the per-question button

Add to the `<style>` block:
```css
.btn-grade-single {
    display: block;
    margin: 6px 0 4px 0;
    padding: 5px 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
}
.btn-grade-single:hover {
    opacity: 0.9;
}
.btn-grade-single:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
```

Print media rule — add `.btn-grade-single` to the existing hide list (line 435):
```css
.appeal-section, .ai-feedback, .btn-ai, .btn-grade-single { display: none !important; }
```

### JS Changes: New `gradeSingleReflection()` function

Replace `gradeAllReflections()` (lines 1523-1557) with `gradeSingleReflection()`:

```javascript
async function gradeSingleReflection(id, btn) {
    const textarea = document.getElementById(id);
    if (!textarea) return;

    const answer = textarea.value.trim();
    if (answer.length < 20) {
        showFeedback(id, { score: 'I', feedback: 'Please write a more complete response (at least 20 characters).' });
        return;
    }

    // Disable button, show loading state
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Grading...';

    try {
        const result = await gradeReflection(id, answer);
        gradingState.set(id, {
            result,
            originalAnswer: answer,
            appealCount: 0,
            history: []
        });
        showFeedback(id, result);
    } catch (err) {
        console.error('Grading error:', err);
        showFeedback(id, { score: 'I', feedback: 'Error grading response. Please try again.' });
    }

    // Restore button
    btn.disabled = false;
    btn.textContent = originalText;
}
```

The existing `gradeReflection()`, `showFeedback()`, `submitAppeal()`, and all
appeal logic remain **unchanged** — they already operate on individual question IDs.

### JS Cleanup

- Remove the `gradeAllReflections()` function entirely (lines 1523-1557).
- The `gradeReflection()` function (lines 1559-1583) stays as-is — it's already
  per-question and is called by the new `gradeSingleReflection()`.

---

## Summary of All Changes

| Location | Change |
|----------|--------|
| Line 235-238 (CSS) | Add `.btn-grade-single` styles |
| Line 435 (print CSS) | Add `.btn-grade-single` to print hide list |
| Line 466 | Remove bulk `btn-ai` button |
| Lines 581, 724, 815, 883, 940, 1005, 1075, 1104 | Insert `<button class="btn-grade-single">` after each textarea |
| Line 1153 | Replace `<script src>` with inline `<script>` (Issue 1) |
| Lines 1523-1557 (JS) | Replace `gradeAllReflections()` with `gradeSingleReflection()` |

**Total: 1 file, ~12 edit points.**

---

## Verification

### Test 1: Per-question grading
1. Open the worksheet (hosted or `file://` after Issue 1 fix).
2. Write >20 chars in the `reflect_vocab` textarea.
3. Click "🤖 Grade This Response" below it.
4. Confirm: button shows "⏳ Grading...", then feedback panel appears below
   with E/P/I score, matched/missing, suggestion.
5. Other textareas remain ungraded.

### Test 2: Multiple independent grades
1. Grade `reflect_vocab` (get a result).
2. Grade `reflect_conditions` separately.
3. Confirm: each has its own independent feedback, no interference.

### Test 3: Appeal still works
1. Get a P or I on any question.
2. Click "Disagree? Appeal", write explanation, submit.
3. Confirm: appeal processes for that question only.

### Test 4: Short answer rejection
1. Type <20 chars in a textarea, click Grade.
2. Confirm: immediate "Please write a more complete response" feedback, no API call.

### Test 5: Print
1. Click Print or Ctrl+P.
2. Confirm: grade buttons, feedback panels, and appeal sections are hidden.

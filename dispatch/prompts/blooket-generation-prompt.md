# Blooket CSV Generation Prompt

**Reusable template for generating Blooket quiz CSVs from AP Statistics lesson content.**

## Prompt

Generate a Blooket quiz CSV for AP Statistics Topic {UNIT}.{LESSON}: {TOPIC_NAME}.

### Content source
Read the video context files for this lesson to understand the concepts covered:
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_transcription.txt`
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_slides.txt`

### Question count
Exactly **35 questions**. No more, no fewer.

### Question design rules

1. **Conceptual understanding only** — every question must test whether the student understands the *concept*, not whether they can recall a specific example from the video or perform a calculation.

2. **No calculations** — no question should require computation that can't be done instantly in one's head. No formulas, no arithmetic, no "calculate z" or "find the p-value of 0.1357." If a number appears, it should be for context, not computation.

3. **Equal-length answer choices** — all 4 answer options for each question must be approximately the same length and complexity. If one answer is noticeably shorter or longer than the others, a student can guess without understanding. Aim for all options being 10-20 words each.

4. **No heuristically obvious answers** — avoid patterns where the correct answer is always the most detailed, the most hedged, or the one with qualifiers like "always" or "never." Distractors should be plausible and reflect real misconceptions.

5. **Real misconceptions as distractors** — wrong answers should represent actual student errors (e.g., confusing p-hat with p, thinking p-value is the probability H₀ is true, mixing up one-sided and two-sided).

6. **No video-specific references** — don't ask "In the lemonade study, what was...?" Ask about the general concept that the lemonade study illustrates.

7. **Vary the question stems** — use "Which of the following...", "A student claims...", "Which statement is correct...", "What is true about...", scenario-based setups, etc.

### CSV format
Match the exact Blooket import template format:
```
"Blooket
Import Template",,,,,,,,,,,,,,,,,,,,,,,,,
Question #,Question Text,Answer 1,Answer 2,"Answer 3
(Optional)","Answer 4
(Optional)","Time Limit (sec)
(Max: 300 seconds)","Correct Answer(s)
(Only include Answer #)",,,,,,,,,,,,,,,,,,
1,"Question text here","Answer A","Answer B","Answer C","Answer D",20,1,,,,,,,,,,,,,,,,,,
```

- Time limit: 20 seconds per question (conceptual questions don't need 25)
- Correct answer column: just the number (1, 2, 3, or 4)
- All text in double quotes
- Distribute correct answers roughly evenly across 1-4

### Output
Save as `u{UNIT}_l{LESSON}_blooket.csv` in the repo root.

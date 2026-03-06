# Worksheet Generation Prompt

**Reusable template for generating AP Statistics live worksheet HTML + AI grading prompts.**

## Prompt

Generate a complete live worksheet for AP Statistics Unit {UNIT}, Lesson {LESSON}: {TOPIC_NAME}.

You will produce two files:
1. `u{UNIT}_lesson{LESSON}_live.html` -- the worksheet itself
2. `ai-grading-prompts-u{UNIT}-l{LESSON}.js` -- the AI grading rubrics

---

### Step 1: Read video context

Read the video transcription and slide files for this lesson to understand the exact content covered:
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_transcription.txt`
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_slides.txt`

If a framework or study guide file exists, read it too:
- `u{UNIT}/apstat_{UNIT}-{LESSON}-*_framework.txt`

Identify from the source material:
- Learning objectives (AP skill codes like VAR-6.D, UNC-4.A, etc.)
- Key vocabulary terms with precise definitions
- Video timestamps for each major concept
- Fill-in-the-blank opportunities (definitions, formulas, key phrases the presenter emphasizes)
- Practice problems the presenter walks through
- Common student errors the presenter warns about
- Direct quotes that should become `contextFromVideo` in the grading rubrics

---

### Step 2: Generate the HTML worksheet

#### File structure

The HTML file is a single self-contained file with embedded CSS and JavaScript. Follow this exact structure:

```
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Topic {UNIT}.{LESSON}: {TOPIC_NAME}</title>
    <style>
        /* Copy the full CSS block from an existing worksheet (e.g., u6_lesson4_live.html).
           The styles are standardized across all worksheets. Include:
           - Base layout (body, header, h1, subtitle)
           - Student info bar
           - Objective box, vocab box
           - Section headers with timestamps
           - Question numbering, sub-questions
           - Fill-in-the-blank inputs (.blank, .correct, .partial, .incorrect, .revealed)
           - Model boxes, note boxes, formula boxes
           - Data tables
           - Control buttons (.btn-check, .btn-show, .btn-reset, .btn-print, .btn-ai)
           - AI feedback styles (.ai-feedback, .score-badge, .score-E/P/I)
           - Appeal system styles
           - Aggregate drawer styles
           - Save indicator, upload particle
           - Print media query hiding interactive elements
        */
    </style>
</head>
<body>
```

#### Header block

```html
<div class="header">
    <span class="header-left">AP Statistics</span>
    <span class="header-center">Unit {UNIT}</span>
    <span class="header-right">{UNIT_THEME}</span>
</div>

<h1>Topic {UNIT}.{LESSON}: {TOPIC_NAME}</h1>
<div class="subtitle">{SUBTITLE_DESCRIPTION}</div>
<div class="worksheet-label">Video Follow-Along Worksheet</div>
```

#### Student info bar

```html
<div class="student-info">
    <div><label>Name:</label> <input type="text" id="worksheetName" style="width:160px;"></div>
    <div><label>Period:</label> <input type="text" id="worksheetPeriod" style="width:40px;"></div>
    <div><label>Username:</label> <input type="text" id="worksheetUsername" style="width:120px;" placeholder="for class sync"></div>
</div>
```

#### Control buttons

```html
<div class="controls">
    <button class="btn-check" onclick="checkAnswers()">&#10003; Check Answers</button>
    <button class="btn-show" onclick="showAnswers()">&#128065; Show Answers</button>
    <button class="btn-reset" onclick="resetAnswers()">&#8634; Reset</button>
    <button class="btn-print" onclick="window.print()">&#128424; Print</button>
    <button class="btn-ai" onclick="gradeAllReflections()">&#129302; Grade My Reflections</button>
    <span id="scoreDisplay"></span>
</div>
```

#### Learning objectives box

```html
<div class="objective-box">
    <strong>Learning Objectives:</strong>
    <ul>
        <li><strong>{SKILL_CODE}:</strong> {Objective description}</li>
        <!-- One li per AP skill code -->
    </ul>
    <strong style="margin-top: 10px; display: block;">Essential Knowledge:</strong>
    <ul>
        <!-- 2-4 key takeaway bullets -->
    </ul>
</div>
```

#### Vocabulary box

```html
<div class="vocab-box">
    <h3>Key Vocabulary</h3>
    <table class="vocab-table">
        <tr>
            <td>{Term}</td>
            <td>{Definition from the video}</td>
        </tr>
        <!-- One row per vocabulary term -->
    </table>
</div>
```

#### Video sections

Each video gets its own section. Structure:

```html
<!-- ============================================================ -->
<!-- VIDEO N: {Video Title}                                        -->
<!-- ============================================================ -->
<div class="section">
    <div class="section-header">
        <h2>Video {N}: {Video Title}</h2>
        <span class="timestamp">[{START} &ndash; {END}]</span>
    </div>

    <!-- Context/setup note boxes where needed -->
    <div class="note-box">
        <strong>Context &mdash; "{Study Name}"</strong>
        <span class="ts">[{TIMESTAMP}]</span>
        {Description of the scenario the presenter uses}
    </div>

    <!-- Fill-in-the-blank questions -->
    <div class="question">
        <span class="question-number">{N}.</span>
        <span class="ts">[{TIMESTAMP}]</span>
        {Question text with} <input type="text" class="blank" data-answer="{answer1|answer2}" style="width:{W}px;"> {continuation}.
    </div>

    <!-- Formula boxes for key formulas -->
    <div class="formula-box">
        <h4>{Formula Name}</h4>
        <div style="text-align: left; max-width: 600px; margin: 0 auto;">
            <!-- Formula content with fill-in-the-blank inputs -->
        </div>
    </div>

    <!-- Model boxes for summarized rules -->
    <div class="model-box">
        <strong>{Rules/Summary Title}:</strong>
        <span class="ts">[{TIMESTAMP}]</span>
        <ul>
            <li>{Rule with blanks}</li>
        </ul>
    </div>

    <!-- Practice problems from the video -->
    <div class="note-box">
        <strong>Practice &mdash; {Problem Name}:</strong>
        <span class="ts">[{TIMESTAMP}]</span>
        {Problem setup}
    </div>

    <!-- Sub-questions for multi-part problems -->
    <div class="question">
        <span class="question-number">{N}.</span>
        <span class="ts">[{TIMESTAMP}]</span>
        {Question stem}:
        <div class="sub-questions">
            <div class="sub-question">(a) <strong>{Label}:</strong> {text with blanks}</div>
            <div class="sub-question">(b) <strong>{Label}:</strong> {text with blanks}</div>
        </div>
    </div>
</div>
```

#### Fill-in-the-blank rules

- Use `<input type="text" class="blank" data-answer="{accepted answers}" style="width:{W}px;">`
- Pipe-separate multiple accepted answers: `data-answer="answer1|answer2|answer3"`
- Size the width to fit the longest answer plus a small margin
- Accept reasonable variations (e.g., `"0.50|0.5|50%"` or `"null hypothesis|null|H0"`)
- Aim for 12-20 fill-in-the-blank questions across the worksheet
- Questions should follow the video chronologically with timestamps

#### Key Takeaways section

```html
<div class="section">
    <div class="section-header">
        <h2>Key Takeaways</h2>
        <span class="timestamp">[Summary]</span>
    </div>
    <div class="model-box">
        <ol>
            <li>{Takeaway with blanks}</li>
            <!-- 3-5 summary items -->
        </ol>
    </div>
</div>
```

#### Reflection questions section (AI-graded)

```html
<div class="section">
    <div class="section-header">
        <h2>Reflection Questions</h2>
        <span class="timestamp">[AI-Graded]</span>
    </div>

    <div class="question">
        <span class="question-number">R1.</span>
        <strong>{Higher-order thinking question}</strong>
        <textarea id="reflect1" placeholder="Write your response here..."></textarea>
        <div id="reflect1-feedback"></div>
    </div>

    <div class="question">
        <span class="question-number">R2.</span>
        <strong>{Another reflection question}</strong>
        <textarea id="reflect2" placeholder="Write your response here..."></textarea>
        <div id="reflect2-feedback"></div>
    </div>
</div>
```

Design 2 reflection questions that:
- Require synthesis, not recall (e.g., "Explain WHY...", "A student claims... identify the error...")
- Connect to common misconceptions from the video
- Can be graded with clear E/P/I criteria

#### Exit Ticket

```html
<div class="exit-ticket">
    <h3 style="margin-top: 0; color: #003366;">Exit Ticket</h3>
    <div class="question">
        <strong>{Multi-part application problem}</strong>
        <ul>
            <li>(a) {Part a}</li>
            <li>(b) {Part b}</li>
            <li>(c) {Part c}</li>
        </ul>
        <textarea id="exitTicket" placeholder="Show your work for each part..."></textarea>
        <div id="exitTicket-feedback"></div>
    </div>
</div>
```

The exit ticket should be a novel scenario (not from the video) that requires applying all key skills from the lesson.

#### Aggregate drawer

```html
<div id="aggregateDrawer" class="aggregate-drawer">
    <div class="drawer-header">
        <h3>Class Responses <span style="font-size: 0.7em; color: #999; font-weight: normal;">(Esc to close)</span></h3>
        <button class="drawer-close" onclick="closeDrawer()">&times;</button>
    </div>
    <div class="drawer-content" id="drawerContent">
        <p>Click a "Class" button next to a question to see responses.</p>
    </div>
</div>
```

#### Script block

```html
<script src="../railway_config.js"></script>
<script src="../railway_client.js"></script>
<script src="ai-grading-prompts-u{UNIT}-l{LESSON}.js"></script>
<script>
    // ==================== CONFIG ====================
    const UNIT_ID = 'U{UNIT}L{LESSON}';
    const DEBOUNCE_MS = 250;

    // ==================== STATE ====================
    let debounceMap = new Map();
    let currentQuestionBlanks = [];
    let gradingState = new Map();

    // ==================== INIT ====================
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        ensureRailwayDefaults();
        restoreSavedUser();
        assignQuestionIds();
        addSaveIndicators();
        bindBlankEvents();
        injectAggregateButtons();
    }

    /* Copy the full JavaScript block from an existing worksheet.
       The JS is standardized across all worksheets and includes:
       - ensureRailwayDefaults()
       - restoreSavedUser() / saveUserInfo()
       - assignQuestionIds() - auto-assigns WS-{UNIT_ID}-Q{N}
       - bindBlankEvents() - blur/enter handlers for validation
       - checkAnswers() / showAnswers() / resetAnswers()
       - Answer validation logic (correct/partial/incorrect/revealed)
       - Railway sync (submitAnswer, getStats)
       - Aggregate drawer (openDrawer, closeDrawer, renderBarChart)
       - AI grading (ReflectionGrader class, gradeAllReflections)
       - Appeal system (showAppealForm, submitAppeal)
       - Save indicators (addSaveIndicators, showSaved)
       - Upload particles
       - Keyboard shortcuts (Escape to close drawer)
    */
</script>
```

#### UNIT_ID convention

The `UNIT_ID` constant determines question IDs sent to the Railway backend. Format: `U{UNIT}L{LESSON}`.
- Single lesson: `U6L4` -> question IDs become `WS-U6L4-Q1`, `WS-U6L4-Q2`, etc.
- Lesson range: `U4L1-2` -> question IDs become `WS-U4L1-2-Q1`, etc.

---

### Step 3: Generate the AI grading prompts file

Create `ai-grading-prompts-u{UNIT}-l{LESSON}.js` with this structure:

```javascript
/**
 * AI Grading Prompts for Unit {UNIT} Lesson {LESSON}: {TOPIC_NAME}
 * Topic {UNIT}.{LESSON}: {Subtitle}
 *
 * Learning Objectives:
 *   {SKILL_CODE} - {Description} [Skill {X.Y}]
 */

// Lesson context from video transcript for AI grading
window.LESSON_CONTEXT_U{UNIT}L{LESSON} = `
VIDEO 1 - {Video Title} (~{duration} min):
- Presenter: {Name}
- Context: "{Study/Example Name}"
  - {Key details from the scenario}
- {CONCEPT 1 IN CAPS}:
  - {Detail from transcript}
  - {Direct quote or paraphrase}
- {CONCEPT 2 IN CAPS}:
  - {Detail}
- IMPORTANT RULES:
  - {Rule the presenter emphasizes}
- PRACTICE: {Practice problem description}
  - {Solution walkthrough}

VIDEO 2 - {Video Title} (~{duration} min):
- {Same structured format}
`;

// Rubrics for each reflection question
window.RUBRICS_U{UNIT}L{LESSON} = {
    reflect1: {
        questionText: "{Exact question text from the worksheet}",
        expectedElements: [
            { id: "{element-id}", description: "{What to look for}", required: true },
            { id: "{element-id}", description: "{What to look for}", required: true },
            { id: "{element-id}", description: "{Nice-to-have element}", required: false }
        ],
        scoringGuide: {
            E: "{What a complete, correct response includes}",
            P: "{What a partial response looks like}",
            I: "{What an incorrect response looks like}"
        },
        commonMistakes: [
            "{Specific mistake students make}",
            "{Another common error}"
        ],
        contextFromVideo: "{Direct quotes from the presenter that inform grading}"
    },

    reflect2: {
        // Same structure
    },

    exitTicket: {
        questionText: "{Full exit ticket prompt}",
        expectedElements: [
            // One element per gradeable component (hypothesis, procedure, conditions, etc.)
            { id: "{element-id}", description: "{Specific gradeable element}", required: true }
        ],
        scoringGuide: {
            E: "{Complete response description}",
            P: "{Partial response description}",
            I: "{Incorrect response description}"
        },
        commonMistakes: [
            "{Mistake 1}",
            "{Mistake 2}"
        ],
        contextFromVideo: "{Relevant video quotes}"
    }
};

/**
 * Build the grading prompt for a specific reflection question
 * @param {string} questionId - The ID of the question (reflect1, reflect2, exitTicket)
 * @param {string} studentAnswer - The student's response
 * @returns {string} The formatted prompt for the AI grader
 */
window.buildReflectionPromptU{UNIT}L{LESSON} = function(questionId, studentAnswer) {
    const rubric = window.RUBRICS_U{UNIT}L{LESSON}[questionId];
    if (!rubric) {
        throw new Error(`Unknown question ID: ${questionId}`);
    }

    const elements = rubric.expectedElements.map(e =>
        `- [${e.required ? 'REQUIRED' : 'BONUS'}] ${e.description}`
    ).join('\n');

    return `You are grading an AP Statistics student's response.

LESSON CONTEXT:
${window.LESSON_CONTEXT_U{UNIT}L{LESSON}}

QUESTION: ${rubric.questionText}

STUDENT'S RESPONSE:
${studentAnswer}

EXPECTED ELEMENTS:
${elements}

SCORING GUIDE:
- E (Essentially Correct): ${rubric.scoringGuide.E}
- P (Partially Correct): ${rubric.scoringGuide.P}
- I (Incorrect): ${rubric.scoringGuide.I}

COMMON MISTAKES TO WATCH FOR:
${rubric.commonMistakes.map(m => '- ' + m).join('\n')}

CONTEXT FROM VIDEO:
${rubric.contextFromVideo}

Respond in this exact JSON format:
{
  "score": "E" | "P" | "I",
  "feedback": "2-3 sentence explanation of the score",
  "matched": ["list of expected elements the student included"],
  "missing": ["list of expected elements the student missed"],
  "suggestion": "One specific suggestion for improvement (only if P or I)"
}`;
};
```

#### Rubric design rules

1. **expectedElements**: Include 3-5 elements per question. Mark truly essential ones as `required: true` and nice-to-have depth indicators as `required: false`.
2. **scoringGuide**: E/P/I descriptions should be mutually exclusive and unambiguous. A grader should be able to classify any response into exactly one category.
3. **commonMistakes**: Draw these from actual student errors the presenter warns about in the video. Include 3-5 per question.
4. **contextFromVideo**: Use direct quotes from the transcript. This grounds the AI grader in what was actually taught, preventing it from grading based on general knowledge rather than the lesson.

---

### Step 4: Blooket CSV

For the Blooket quiz CSV, use the separate template at `dispatch/prompts/blooket-generation-prompt.md`. Generate it as a parallel task.

---

### Output checklist

- [ ] `u{UNIT}_lesson{LESSON}_live.html` with all CSS, HTML sections, and JS
- [ ] `ai-grading-prompts-u{UNIT}-l{LESSON}.js` with lesson context, rubrics, and prompt builder
- [ ] Question IDs auto-assigned as `WS-U{UNIT}L{LESSON}-Q{N}`
- [ ] All fill-in-the-blank answers sourced from the video transcripts
- [ ] Timestamps on every question matching the source video
- [ ] 2 reflection questions + 1 exit ticket with full E/P/I rubrics
- [ ] Blooket CSV generated via separate `blooket-generation-prompt.md` template

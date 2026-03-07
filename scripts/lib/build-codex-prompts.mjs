import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const WORKSHEET_ROOT = "C:/Users/ColsonR/apstats-live-worksheet";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readUtf8(filePath) {
  return readFileSync(filePath, "utf-8").trim();
}

function buildFileBlock(filePath, contents) {
  return `<file path="${filePath}">\n${contents}\n</file>`;
}

function extractTopicTitleFromFramework(unit, lesson) {
  const frameworkPath = path.join(WORKSHEET_ROOT, `apstat_${unit}_framework.md`);
  if (!existsSync(frameworkPath)) {
    return null;
  }

  const framework = readFileSync(frameworkPath, "utf-8");
  const headerPattern = new RegExp(
    `## \\*\\*TOPIC ${escapeRegExp(unit)}\\.${escapeRegExp(lesson)}\\*\\*[\\s\\S]{0,200}?### \\*\\*(.+?)\\*\\*`,
    "i"
  );
  const headerMatch = framework.match(headerPattern);
  if (headerMatch?.[1]) {
    return headerMatch[1].trim();
  }

  const tablePattern = new RegExp(
    `\\| \\*\\*${escapeRegExp(unit)}\\.${escapeRegExp(lesson)}\\s+(.+?)\\*\\* \\|`,
    "i"
  );
  const tableMatch = framework.match(tablePattern);
  return tableMatch?.[1]?.trim() || null;
}

function extractTopicTitleFromText(unit, lesson, text) {
  if (!text) {
    return null;
  }

  const topicPattern = new RegExp(
    `topic\\s+${escapeRegExp(unit)}\\.${escapeRegExp(lesson)}[:\\s-]+([^\\n.]+)`,
    "i"
  );
  const topicMatch = text.match(topicPattern);
  if (topicMatch?.[1]) {
    return topicMatch[1].replace(/^[^A-Za-z0-9]+/, "").trim();
  }

  const slidePattern = new RegExp(
    `TOPIC\\s+${escapeRegExp(unit)}\\.${escapeRegExp(lesson)}[:\\s-]+([^\\n]+)`,
    "i"
  );
  const slideMatch = text.match(slidePattern);
  return slideMatch?.[1]?.replace(/^[^A-Za-z0-9]+/, "").trim() || null;
}

function extractTopicTitle(unit, lesson, videos) {
  const frameworkTitle = extractTopicTitleFromFramework(unit, lesson);
  if (frameworkTitle) {
    return frameworkTitle;
  }

  for (const video of videos) {
    const title =
      extractTopicTitleFromText(unit, lesson, video.transcription) ||
      extractTopicTitleFromText(unit, lesson, video.slides);
    if (title) {
      return title;
    }
  }

  return `Topic ${unit}.${lesson}`;
}

function buildSharedContext(unit, lesson, videoContext) {
  const sections = [
    `## Video Context for Topic ${unit}.${lesson}: ${videoContext.topicTitle}`,
  ];

  for (const video of videoContext.videos) {
    if (video.transcription) {
      sections.push(`### Video ${video.index} — Transcription\n${video.transcription}`);
    }

    if (video.slides) {
      sections.push(`### Video ${video.index} — Slide Descriptions\n${video.slides}`);
    }
  }

  return sections.join("\n\n");
}

export function readVideoContext(unit, lesson) {
  const lessonDir = path.join(WORKSHEET_ROOT, `u${unit}`);
  if (!existsSync(lessonDir)) {
    throw new Error(`Video context directory not found: ${lessonDir}`);
  }

  const pattern = new RegExp(
    `^apstat_${escapeRegExp(unit)}-${escapeRegExp(lesson)}(?:-(\\d+))?_(transcription|slides)\\.txt$`,
    "i"
  );

  const videosByIndex = new Map();

  for (const name of readdirSync(lessonDir)) {
    const match = name.match(pattern);
    if (!match) {
      continue;
    }

    const index = Number(match[1] || 1);
    const kind = match[2].toLowerCase();
    const video = videosByIndex.get(index) || { index, transcription: "", slides: "" };
    video[kind] = readUtf8(path.join(lessonDir, name));
    videosByIndex.set(index, video);
  }

  const videos = [...videosByIndex.values()].sort((a, b) => a.index - b.index);
  if (videos.length === 0) {
    throw new Error(`No video context files found for Topic ${unit}.${lesson} in ${lessonDir}`);
  }

  const topicTitle = extractTopicTitle(unit, lesson, videos);

  return {
    topicTitle,
    videos,
    video1Transcription: videos[0]?.transcription || "",
    video1Slides: videos[0]?.slides || "",
    video2Transcription: videos[1]?.transcription || "",
    video2Slides: videos[1]?.slides || "",
  };
}

export function buildWorksheetPrompt(unit, lesson, videoContext, patternFiles) {
  const sharedContext = buildSharedContext(unit, lesson, videoContext);
  const videoScope =
    videoContext.videos.length === 1 ? "the video" : "all available videos";

  return `You are generating a follow-along worksheet for an AP Statistics class.
Use only the embedded context and patterns below. Do not rely on external repo exploration to understand the task.

Create TWO files in the current directory:

1. \`u${unit}_lesson${lesson}_live.html\` — the worksheet
2. \`ai-grading-prompts-u${unit}-l${lesson}.js\` — the AI grading config

## Pattern to follow

Here is the COMPLETE source of the worksheet pattern (${patternFiles.worksheet.name}).
Replicate this structure exactly — same CSS, same JS infrastructure, same HTML patterns.
Only change the content to match Topic ${unit}.${lesson}.

${buildFileBlock(patternFiles.worksheet.name, patternFiles.worksheet.content)}

Here is the grading prompts file pattern (${patternFiles.grading.name}):

${buildFileBlock(patternFiles.grading.name, patternFiles.grading.content)}

## Video context (the actual lesson content)

${sharedContext}

## Requirements

### Worksheet (HTML)
- Title: "Topic ${unit}.${lesson}: ${videoContext.topicTitle}"
- UNIT_ID constant: 'U${unit}L${lesson}'
- One \`<div class="section">\` per video, with section header showing video title and timestamp range
- Questions use \`<input type="text" class="blank" data-answer="...">\` for fill-in-the-blank
  - \`data-answer\` accepts pipe-separated alternatives: \`data-answer="reject|reject H0"\`
  - Set width proportional to expected answer length
- Use \`<div class="model-box">\` for key formulas/rules the video presents
- Use \`<div class="note-box">\` for scenario/context setups
- Use \`<textarea>\` for open-ended reflection questions (exit ticket)
- Include timestamps \`<span class="ts">[M:SS]</span>\` from the transcription
- Questions should follow the video chronologically — students fill in as they watch
- 15-25 fill-in-the-blank questions across ${videoScope}
- 1 exit ticket (multi-part open-ended question) at the end
- Reference \`ai-grading-prompts-u${unit}-l${lesson}.js\` in the script tag
- Keep the EXACT same CSS, JS infrastructure, button handlers, Railway integration, etc.

### Grading Prompts (JS)
- Define \`window.LESSON_CONTEXT_U${unit}L${lesson}\` with a structured summary of ${videoScope}
- Define \`window.RUBRICS_U${unit}L${lesson}\` with rubric entries for each reflection/textarea question
- Each rubric has: questionText, expectedElements (with id, description, required), scoringGuide
- Follow the exact pattern from the previous lesson's grading file

Write both files directly to disk in the current directory.`;
}

export function buildBlooketPrompt(unit, lesson, videoContext, patternCSV) {
  const sharedContext = buildSharedContext(unit, lesson, videoContext);
  const videoScope =
    videoContext.videos.length === 1 ? "the lesson video" : "all lesson videos";

  return `You are generating a Blooket review quiz CSV for AP Statistics Topic ${unit}.${lesson}.
Use only the embedded context and CSV example below. Do not rely on external repo exploration to understand the task.

Create ONE file: \`u${unit}_l${lesson}_blooket.csv\`

## Format

The CSV must use the exact Blooket import template format. Here is a working example pattern (${patternCSV.name}):

${buildFileBlock(patternCSV.name, patternCSV.content)}

Key format rules:
- Row 1: \`"Blooket\\nImport Template"\` followed by empty cells (25 commas)
- Row 2: Headers — \`Question #,Question Text,Answer 1,Answer 2,"Answer 3\\n(Optional)","Answer 4\\n(Optional)","Time Limit (sec)\\n(Max: 300 seconds)","Correct Answer(s)\\n(Only include Answer #)"\` followed by empty cells
- Data rows: question number, question text in quotes, 4 answer choices in quotes, time limit (20), correct answer number (1-4), followed by empty cells (18 commas)
- Each row ends with \`,,,,,,,,,,,,,,,,,,\` (18 trailing commas)

## Video context (source material)

${sharedContext}

## Requirements

- Generate 25-35 multiple choice questions covering ALL key concepts from ${videoScope}
- Every answer choice must be a complete sentence (Blooket displays them in bubbles)
- Correct answer (Answer 1, 2, 3, or 4) should be RANDOMIZED — do not always put the correct choice in Answer 1
- Wrong answers should be plausible misconceptions, not obviously absurd
- Questions should test:
  - Definitions and key vocabulary from the lesson
  - Procedural steps (what comes first, what do you check, etc.)
  - Common errors and misconceptions the video warns about
  - Application to the specific scenarios discussed in the videos
  - "Which of the following is correct/incorrect" style questions
- Time limit: 20 seconds for all questions
- Do NOT include any extra text, headers, or explanations — just the raw CSV

Write the CSV directly to disk in the current directory.`;
}

export function buildDrillsPrompt(unit, lesson, videoContext, manifestExcerpt) {
  const sharedContext = buildSharedContext(unit, lesson, videoContext);

  return `You are extending a drill cartridge for the lrsl-driller platform.
Use only the embedded context and examples below. Do not rely on external repo exploration to understand the task.

Edit these files in the current repository:
- ${manifestExcerpt.manifestPath}
- ${manifestExcerpt.generatorPath}
- ${manifestExcerpt.gradingRulesPath}

## Current manifest structure

Current meta.name: "${manifestExcerpt.metaName}"

Current meta.description:
${manifestExcerpt.metaDescription}

Current last mode:
- id: ${manifestExcerpt.lastModeId}
- name: ${manifestExcerpt.lastModeName}

Last 2 mode objects from the manifest.json modes array:
\`\`\`json
${manifestExcerpt.lastModesJson}
\`\`\`

## Video context (source material)

${sharedContext}

## Requirements

- Add 3-5 new modes to the \`modes\` array in manifest.json for Topic ${unit}.${lesson}: ${videoContext.topicTitle}
- Follow the exact patterns established by the current cartridge and the excerpt above
- If any generic instruction below conflicts with the actual current cartridge structure, follow the current cartridge structure
- Continue numbering from the last existing mode ID
- Each new mode should clearly map to a distinct skill or concept from Topic ${unit}.${lesson}
- Also update \`generator.js\` to add generator functions for the new modes
- Also update \`grading-rules.js\` to add grading logic for the new modes
- Update the \`meta.name\` and \`meta.description\` in manifest.json to include Topic ${unit}.${lesson} coverage
- Ensure at least one new mode \`name\` literally includes "${unit}.${lesson}" so downstream validation can confirm the lesson was added

Apply the edits directly to the repository files.`;
}

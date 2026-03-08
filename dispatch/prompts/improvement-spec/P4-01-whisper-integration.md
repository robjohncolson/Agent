# Agent: Whisper Integration

## Phase
P4-pipeline-recovery | No dependencies | Working dir: `C:/Users/ColsonR/apstats-live-worksheet`

## Objective
Replace the dormant Gemini transcription with Whisper as a drop-in replacement for `video-ingest.mjs`.

## Context: Why Gemini Is Dormant

Gemini 3.1 Pro has zero free API quota as of March 2026. The existing `video-ingest.mjs` uses Gemini's resumable upload protocol for video transcription. We need an alternative that:
1. Works locally (no API quota dependency) OR has a cheap API
2. Produces timestamped transcripts in the same format
3. Can also generate slide descriptions (bonus, not required)

## Dependency: Output Format Contract

The lesson prep pipeline consumes transcripts in this format:
```
**[MM:SS]** <transcribed text>
**[MM:SS]** <transcribed text>
...
```

Stored as: `u{unit}/apstat_{unit}-{lesson}-{part}_transcript.txt`

Slide descriptions (optional):
```
**[MM:SS]** — <visual description of what's on screen>
```

Stored as: `u{unit}/apstat_{unit}-{lesson}-{part}_slides.txt`

**Downstream consumers:**
- `ai-grading-prompts-u{N}-l{L}.js` — references timestamps in `contextFromVideo`
- `u{N}_lesson{L}_live.html` — embeds transcript segments
- `/lessonprep` skill — Step 1 checks for transcript existence

## Read First
1. `video-ingest.mjs` — existing Gemini implementation (understand the interface)
2. A sample transcript file in `u4/` or `u5/` (understand the output format)
3. `Agent/design/lesson-prep-workflow-spec-v2.md` — Step 2 (video transcription)
4. `Agent/scripts/lib/paths.mjs` — **CRITICAL**: Centralized path config. All repo paths,
   tool paths (PYTHON, FFMPEG_DIR, MIKTEX_DIR), and output directories are defined here.
   Import from this module — do NOT hardcode paths.
5. `Agent/scripts/verify-paths.mjs` — Run this first to validate environment

## Owned Paths
- `video-ingest-whisper.mjs`
- `scripts/whisper-transcribe.sh`

## Path Integration
All output paths MUST use the centralized paths module:
```javascript
import { WORKSHEET_REPO, PYTHON, FFMPEG_DIR } from '../Agent/scripts/lib/paths.mjs';
// Or if this lives in Agent/scripts/:
import { WORKSHEET_REPO, PYTHON, FFMPEG_DIR } from './lib/paths.mjs';
```

## Implementation

### Option A: Local whisper.cpp (preferred — no API costs)

```javascript
// video-ingest-whisper.mjs
import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'medium';

export async function transcribeVideo(videoPath, outputDir, unit, lesson, part) {
  // 1. Extract audio from video
  const audioPath = videoPath.replace(/\.\w+$/, '.wav');
  execSync(`ffmpeg -i "${videoPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`);

  // 2. Run whisper.cpp
  const whisperOutput = execSync(
    `whisper "${audioPath}" --model ${WHISPER_MODEL} --output_format txt --timestamps`,
    { encoding: 'utf-8' }
  );

  // 3. Format to expected output
  const formatted = formatTimestamps(whisperOutput);

  // 4. Write to expected location
  const filename = `apstat_${unit}-${lesson}-${part}_transcript.txt`;
  writeFileSync(join(outputDir, filename), formatted);

  return { transcriptPath: join(outputDir, filename) };
}

function formatTimestamps(rawOutput) {
  // Convert whisper [HH:MM:SS.mmm] to **[MM:SS]** format
  return rawOutput
    .split('\n')
    .map(line => {
      const match = line.match(/\[(\d{2}):(\d{2}):(\d{2})\.\d+\s*-->/);
      if (match) {
        const mins = parseInt(match[1]) * 60 + parseInt(match[2]);
        const secs = match[3];
        const text = line.replace(/\[.*?-->\s*[\d:.]+\]\s*/, '').trim();
        return `**[${String(mins).padStart(2,'0')}:${secs}]** ${text}`;
      }
      return line;
    })
    .filter(l => l.trim())
    .join('\n');
}
```

### Option B: OpenAI Whisper API (fallback if local whisper unavailable)

```javascript
export async function transcribeViaAPI(videoPath, outputDir, unit, lesson, part) {
  const audioPath = extractAudio(videoPath);
  const formData = new FormData();
  formData.append('file', createReadStream(audioPath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData
  });

  const result = await response.json();
  const formatted = result.segments
    .map(s => `**[${formatTime(s.start)}]** ${s.text.trim()}`)
    .join('\n');

  // Write to expected location
  const filename = `apstat_${unit}-${lesson}-${part}_transcript.txt`;
  writeFileSync(join(outputDir, filename), formatted);
}
```

## Constraints
- Output format MUST match existing transcripts exactly (downstream consumers depend on it)
- Keep video-ingest.mjs as-is (don't delete — it documents the Gemini approach)
- FFmpeg is available at `~/ffmpeg/`
- whisper.cpp may need to be installed (provide instructions)

## Verification
```bash
# Test with a sample video
node video-ingest-whisper.mjs --video sample.mp4 --unit 6 --lesson 4 --part 1
# Verify output format
head -5 u6/apstat_6-4-1_transcript.txt | grep -c '\*\*\['  # Should be 5
```

# Agent: Education Platform CLAUDE.md Rules

## Phase
P1-foundation | No dependencies | Working dirs: lrsl-driller, curriculum_render, apstats-live-worksheet

## Objective
Append project-specific rules to CLAUDE.md for each education repo, encoding the dependency knowledge that prevents recurring bugs.

## Context: Cross-Repo Dependencies

```
apstats-live-worksheet (content generation)
  ├── Generates: worksheets (HTML), rubrics (JS), Blooket CSVs
  ├── Creation order: transcript → rubric → worksheet → blooket
  └── CONSUMED BY: curriculum_render (grading rubrics), lrsl-driller (cartridge assets)

curriculum_render (delivery platform)
  ├── index.html load order: CSS → Chart.js → Config → Core → Sprites → Grading → Init
  ├── Storage: IndexedDB → localStorage → Supabase (3-tier fallback)
  ├── Grading: keywords → Groq AI → appeal (AI can ONLY upgrade, never downgrade)
  └── Network: Turbo (Railway) → LAN (Qwen :8765) → Offline

lrsl-driller (drill platform)
  ├── Console-cartridge pattern: platform/core/ must NEVER import from cartridges/
  ├── Cartridge contract: manifest.json, generator.js, grading-rules.js, ai-grader-prompt.txt
  ├── Deep-link: test BOTH direct navigation AND URL restoration after refresh
  └── Progression: manifest "unlockedBy" chains — check before reordering modes
```

## Read First
1. `C:/Users/ColsonR/lrsl-driller/CLAUDE.md` (existing)
2. `C:/Users/ColsonR/curriculum_render/CLAUDE.md` (existing)
3. `C:/Users/ColsonR/apstats-live-worksheet/CLAUDE.md` (existing)

## Owned Paths (across 3 repos)
- `C:/Users/ColsonR/lrsl-driller/CLAUDE.md`
- `C:/Users/ColsonR/curriculum_render/CLAUDE.md`
- `C:/Users/ColsonR/apstats-live-worksheet/CLAUDE.md`

## Rules for lrsl-driller/CLAUDE.md

```markdown
## Driller Rules

### Console-Cartridge Separation
Platform code (platform/core/) must NEVER import from cartridges/.
Cartridges expose only: manifest.json, generator.js, grading-rules.js, ai-grader-prompt.txt.

### Deep-Link Testing (Two Paths)
Deep-link URLs must be tested against BOTH:
1. Direct navigation (user pastes URL) → loadCartridge() path
2. URL restoration after page refresh → history.replaceState path
The 5-7→5-2 regression happened because only path 1 was fixed.

### Progression Gating
Check manifest.json "unlockedBy" chains before modifying mode ordering.
Modes gate on gold star counts — verify the chain is still valid after changes.

### Answer Flow Dependency Chain
User submits → gradeField() [keywords] → AI grading [Groq] → recordResult()
→ awardStar() → checkUnlocks() → generateProblem() [next]
Each step DEPENDS on the previous. Do not reorder.

### Tests
1682+ tests — run `npm test` before committing.
```

## Rules for curriculum_render/CLAUDE.md

```markdown
## Curriculum Render Rules

### Critical Load Order (index.html)
Phase 1: CSS + Chart.js (render-blocking)
Phase 2: CDN with timeouts (MathJax 3s, Font Awesome 2s, Supabase 2s)
Phase 3: Config (supabase_config.js, railway_config.js)
Phase 4: Core (charts.js, diagnostics, railway_client.js)
Phase 5: Sprites (sheet → canvas → entities → manager) — SEQUENTIAL
Phase 6: Grading (grading-engine.js, frq-grading-rules.js)
DO NOT reorder these phases. Sprites depend on canvas_engine. Grading depends on sprites.

### Storage Dependency Chain
IndexedDB (primary) → localStorage (fallback) → Supabase (cloud sync)
DualWriteAdapter handles migration. Outbox-based sync for failed saves.
Do not remove localStorage writes — backward compat during transition.

### AI Grading Invariant
AI can ONLY upgrade scores (I→P, P→E, I→E). NEVER downgrade.
This is enforced at: server.js appeal endpoint, grading-engine.js, and client-side.
All three must agree. Do not break this invariant.

### Tests
667+ Vitest tests — run `npm test` before committing.
```

## Rules for apstats-live-worksheet/CLAUDE.md

```markdown
## Lesson Pipeline Rules

### Creation Dependency Order
transcript → rubric → worksheet → blooket → schoology
Each step depends on the previous. Cannot skip.

### Video Transcription Is DORMANT
Gemini 3.1 Pro has zero free quota. Use either:
- Agent/scripts/aistudio-ingest.mjs (CDP → Google AI Studio)
- video-ingest-whisper.mjs (Whisper, when implemented)

### Worksheet Structure
Self-contained single HTML files. No build step. No external deps except CDN.
Rubrics are in ai-grading-prompts-u{N}-l{L}.js files.
Rubric schema: { questionText, expectedElements[], scoringGuide {E,P,I}, commonMistakes[] }
```

## Verification
```bash
grep "Console-Cartridge" C:/Users/ColsonR/lrsl-driller/CLAUDE.md
grep "Load Order" C:/Users/ColsonR/curriculum_render/CLAUDE.md
grep "DORMANT" C:/Users/ColsonR/apstats-live-worksheet/CLAUDE.md
```

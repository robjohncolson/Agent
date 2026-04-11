# The Desk — Unified Educational Platform Spec

**Author**: Bobby Colson (high school AP Stats / Algebra 2 teacher)
**Date**: 2026-04-11
**Status**: Brainstorming / Pre-design

---

## 1. Vision

A single student-facing platform ("The Desk") that unifies all classroom tools — quizzes, drills, live worksheets, calculator training, and formula practice — behind one portal. Underneath, a telemetry and grading pipeline captures granular student interaction data, computes daily metrics, and pushes grades directly into the Schoology gradebook via Puppeteer automation.

### Goals

1. **Single entry point** for students — one URL, one login (Fruit_Animal), access to everything
2. **Inline TI-84 calculator guidance** embedded directly into quiz questions — students learn the keystrokes *while* answering, not in a separate app
3. **Keystroke-level telemetry** — record every calculator interaction, diff against the optimal path, compute efficiency metrics per student
4. **Granular quiz completion tracking** — per-question timestamps, attempt counts, time-on-task, not just final scores
5. **Automated Schoology gradebook push** — daily collation job computes composite scores and writes them into the gradebook via CDP/Puppeteer (same framework already used for lesson posting in Agent)
6. **Unified AI grading via DeepSeek v4** — replace the current patchwork of Groq + Gemini across repos with a single DeepSeek v4 endpoint per project
7. **Preserve existing deployments** — all current URLs (Vercel, GitHub Pages, Railway) keep working; the new repo adds an integration layer, not a rewrite

---

## 2. Source Repos

### 2.1 curriculum_render (school/curriculum_render)

**What it is**: AP Stats Consensus Quiz — collaborative real-time quiz where students see peer answer distributions, with AI-powered FRQ grading and appeals.

| Attribute | Value |
|-----------|-------|
| Stack | Vanilla JS, Express (Railway), Supabase, Groq AI |
| LOC | ~94K |
| Entry point | `index.html` (580KB monolithic, inline JS) |
| Storage | IndexedDB (primary), localStorage (fallback), Supabase (cloud sync) |
| Backend | `railway-server/server.js` — Supabase proxy, AI grading, WebSocket |
| Tests | 667 (Vitest) |
| GitNexus | YES (1,639 symbols, 3,825 edges, 138 flows) |
| Deploy | Railway (server) + GitHub Pages (frontend) |
| Auth | Fruit_Animal username/password |
| AI grading | Groq llama-3.3-70b → **migrate to DeepSeek v4** |
| DeepSeek key | `curriculum_render` key already exists (sk-aa750...3611) |

**What we're taking**: The quiz engine, FRQ grading, consensus view. Adding inline TI-84 widget and granular completion tracking.

### 2.2 follow-alongs (school/follow-alongs)

**What it is**: Two-in-one — 30+ interactive live worksheets for AP Stats Units 3-9, plus the TI-84 Plus CE Procedural Trainer (v3) with real CEmu WASM emulation. Also contains "The Desk" hub — a System 7-styled desktop that already integrates several apps as iframe windows.

| Attribute | Value |
|-----------|-------|
| Stack | Vanilla JS, CEmu WASM, Vitest |
| LOC | ~50-100K (core), plus 190MB ROM research artifacts |
| TI-84 trainer | `ti84-trainer-v2/standalone.html` (~461KB bundled) |
| Native module | 9 files, ~4,400 LOC, 354 tests — state machine, stat math, LCD renderer |
| Worksheets | 30+ HTML files with Railway API sync + AI grading |
| Hub | System 7 desktop with 6 app windows, draggable icons, window management |
| GitNexus | YES (2,228 symbols, 4,166 edges, 161 flows) |
| Deploy | GitHub Pages |
| AP deadline | ~May 7 (28 days out as of 2026-04-09) |

**What we're taking**:
- "The Desk" hub (System 7 desktop) → becomes the portal
- TI-84 native module (`native/*.js`) → extracted as embeddable widget
- Live worksheets stay deployed as-is, accessed through hub

### 2.3 lrsl-driller (not-school/lrsl-driller)

**What it is**: Console-Cartridge drill platform. Topic-neutral engine with 23 pluggable lesson cartridges (12 AP Stats, 8 Algebra 2, 3 CS). Features dual AI grading, Ghost System, SRS, Manim animations, game mechanics.

| Attribute | Value |
|-----------|-------|
| Stack | Vite, Tailwind, Three.js, TensorFlow.js, Supabase, Dexie |
| LOC | ~152K |
| Entry point | `platform/app.html` (~3,600 lines) |
| Cartridges | 23 in `cartridges/` with `registry.json` |
| Backend | `railway-server/` — Supabase sync, AI grading |
| Tests | 2,213 (Vitest) |
| GitNexus | YES (6,410 symbols, 15,319 edges, 300 flows) |
| Deploy | Vercel (frontend, auto-deploy) + Railway (backend) |
| AI grading | Groq + Gemini dual-grading → **migrate to DeepSeek v4** |

**What we're taking**: Cartridge drill engine accessed through hub. Telemetry events (star ratings, attempt counts, SRS progression) feed into the metrics pipeline.

### 2.4 tmux-trainer (tmux-trainer)

**What it is**: AP Stats Formula Defense — tower-defense style SRS game where students practice formulas through timed input with Three.js 3D graphics, KaTeX rendering, and a full music editor.

| Attribute | Value |
|-----------|-------|
| Stack | Vanilla JS, Three.js, KaTeX, qrcode.js (all CDN) |
| LOC | ~12K |
| Entry point | `index.html` (single-file, ~9,600 lines) |
| Storage | localStorage (SRS state, high scores, run checkpoints, music config) |
| GitNexus | YES (2,312 symbols, 2,412 edges, 19 flows) |
| Deploy | Vercel (`tmux-trainer.vercel.app`) |
| No backend | Pure client-side |

**What we're taking**: Formula defense as an app within the hub. SRS progress data feeds into metrics pipeline (currently localStorage-only — may need Supabase sync added).

### 2.5 Agent (./Agent)

**What it is**: The teacher-side automation hub. Contains a 12-step lesson prep pipeline (video ingest → AI content generation → animation rendering → Schoology posting), parallel Codex agent dispatch, cross-machine orchestration, and a lesson registry tracking 100+ lessons.

| Attribute | Value |
|-----------|-------|
| Pipeline | `scripts/lesson-prep.mjs` — 12 sequential tasks |
| TUI | `scripts/pipeline-commander.mjs` (Blessed terminal UI) |
| Cartridge gen | `scripts/workers/codex-content-gen.mjs` with `buildDrillsPrompt()` |
| CDP automation | Schoology posting via Chrome DevTools Protocol |
| Registry | `state/lesson-registry.json` (100+ lessons, all URLs/status) |
| Machines | Auto-detects ColsonR (school) vs rober (home) paths |
| Supabase sync | `hgvnytaqmuybzbotosyj.supabase.co` for cross-machine checkpoints |

**What we're taking**: The Schoology CDP automation pattern gets extended for gradebook pushes. The pipeline gains a new daily step: collect telemetry → compute metrics → push grades. Cartridge authoring framework continues generating content for the driller.

---

## 3. Architecture Sketch

```
┌─────────────────────────────────────────────────────────────┐
│  STUDENT LAYER ("The Desk")                                 │
│                                                             │
│  System 7 Desktop Portal                                    │
│  ├── Quiz (curriculum_render)                               │
│  │   ├── MCQ + FRQ with DeepSeek v4 grading                │
│  │   ├── Inline TI-84 widget on calculator questions        │
│  │   │   ├── keystrokes recorded + diffed vs optimal path   │
│  │   │   ├── live LCD canvas (320x240) beside question      │
│  │   │   └── efficiency score computed per interaction       │
│  │   └── Per-question completion timestamps                 │
│  │                                                          │
│  ├── Drills (lrsl-driller cartridges)                       │
│  │   ├── Star ratings, SRS progression                      │
│  │   └── Attempt counts, time-on-task                       │
│  │                                                          │
│  ├── Worksheets (follow-alongs)                             │
│  │   ├── Video follow-along completions                     │
│  │   └── AI-graded reflections                              │
│  │                                                          │
│  ├── Formula Defense (tmux-trainer)                          │
│  │   └── SRS progress, wave scores                          │
│  │                                                          │
│  └── Calculator Trainer (TI-84 standalone)                  │
│      └── Procedure completion, recall vs guided mode        │
│                                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ unified event bus
                       ▼
              ┌─────────────────┐
              │  EVENT STORE    │
              │  (Supabase)     │
              │                 │
              │  events table:  │
              │  student_id     │
              │  app            │
              │  event_type     │
              │  payload (JSON) │
              │  timestamp      │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ METRICS ENGINE  │
              │ (daily job)     │
              │                 │
              │ Per-student:    │
              │ • quiz_score    │
              │ • calc_fluency  │
              │ • drill_stars   │
              │ • worksheet_%   │
              │ • formula_srs   │
              │ • composite     │
              └────────┬────────┘
                       │ Puppeteer/CDP
                       ▼
              ┌─────────────────┐
              │   SCHOOLOGY     │
              │   GRADEBOOK     │
              │                 │
              │ Assignment cols │
              │ populated daily │
              └─────────────────┘
```

---

## 4. Key Components to Build

### 4.1 TI-84 Embeddable Widget

Extract from `follow-alongs/ti84-trainer-v2/native/`:

| Module | LOC | Role |
|--------|-----|------|
| `ti84-native.js` | 1,018 | Orchestrator, keystroke router |
| `stat-math.js` | ~1,100 | 25+ statistical functions (normal, t, chi-sq, binomial, regression) |
| `form-engine.js` | 687 | Wizard field management |
| `screen-renderer.js` | 549 | 320x240 canvas LCD |
| `result-formatter.js` | 112 | Template substitution |
| `menu-nav.js` | ~300 | Menu cursor + selection |
| `event-bus.js` | 49 | Pub/sub |
| `field-tables.js` | ~400 | Wizard + result definitions |
| `menu-tables.js` | ~200 | Menu structure |

**Integration API**:
```javascript
const calc = TI84Widget.create(canvasElement);
calc.setList('L1', studentData);
calc.on('key-press', ({key}) => logKeystroke(key));
calc.on('compute', ({type, results}) => checkAnswer(results));
const state = calc.save();  // serialize for quiz resume
```

**Keystroke telemetry**:
```javascript
{
  student_id: "Grape_Otter",
  question_id: "U7-L2-Q04",
  optimal_path: ["STAT", "RIGHT", "2", "DOWN", "6", "5", ...],
  actual_path:  ["STAT", "RIGHT", "RIGHT", "LEFT", "2", "DOWN", "6", "5", ...],
  extra_keys: 2,
  backtrack_count: 1,
  time_ms: 34200,
  efficiency: 0.88,
  result_correct: true
}
```

### 4.2 Unified DeepSeek v4 Grading

Replace Groq/Gemini across all apps with DeepSeek v4.

| App | Current | New |
|-----|---------|-----|
| curriculum_render | Groq (llama-3.3-70b) | DeepSeek v4 (existing key sk-aa750...3611) |
| lrsl-driller | Groq + Gemini dual-grading | DeepSeek v4 |
| follow-alongs worksheets | Groq | DeepSeek v4 |

DeepSeek uses OpenAI-compatible chat completions API. The grading prompts (rubrics) are already model-agnostic system+user message pairs. Migration is a model parameter swap + endpoint URL change.

New project key: `sk-6786d6035dd94b0b8d819d3d050aecb2` (v4, to be confirmed)

### 4.3 Event Store Schema

Single Supabase table for cross-app telemetry:

```sql
events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  text NOT NULL,          -- "Grape_Otter"
  app         text NOT NULL,          -- "quiz", "drills", "worksheet", "calculator", "formulas"
  event_type  text NOT NULL,          -- "question_complete", "keystroke_sequence", "star_earned", etc.
  payload     jsonb NOT NULL,         -- app-specific event data
  created_at  timestamptz DEFAULT now()
)
```

### 4.4 Metrics Engine + Gradebook Push

Daily Node.js job (or Agent pipeline step) that:
1. Queries event store for previous 24h
2. Computes per-student metrics across all apps
3. Maps metrics to Schoology assignment columns
4. Pushes grades via Puppeteer/CDP (same pattern as `Agent/scripts/post-to-schoology.mjs`)

---

## 5. Shared Infrastructure

| Resource | Current State | Consolidation |
|----------|--------------|---------------|
| Supabase | 2 instances (driller + curriculum_render) | Add events table to one, or create 3rd for telemetry |
| Railway | 2 servers (driller + curriculum_render) | Could share, but independent is simpler |
| Auth | Fruit_Animal usernames in both Supabase instances | Unify into single auth table |
| DeepSeek | 6 API keys across projects | Per-project keys fine; standardize client code |
| Schoology CDP | Agent pipeline posts materials to Period B + E | Extend for gradebook writes |

---

## 6. Open Design Questions

### Q1: TI-84 widget embedding strategy

**(a) Deep embed** — Modify curriculum_render's `index.html` to import the TI-84 widget directly. Widget renders inline next to calculator-heavy questions. Tight coupling, but seamless UX.

**(b) Floating overlay** — "The Desk" hub overlays a TI-84 panel on top of the curriculum_render iframe. Reads question context from a postMessage API. Loose coupling, curriculum_render untouched.

**(c) Hybrid** — curriculum_render gets a minimal `<div id="ti84-mount">` placeholder on calc questions. The Desk injects the widget into that mount point via iframe communication.

### Q2: Event store location

**(a) New Supabase project** — Clean separation, dedicated for telemetry. Another URL to manage.

**(b) Add to existing curriculum_render Supabase** — Already has the quiz data. Events table lives alongside answers/votes.

**(c) Add to existing driller Supabase** — Already has progress tracking tables.

### Q3: Metrics → Gradebook mapping

How do composite scores translate to Schoology assignments? Options:
- One assignment per app per unit (e.g., "U7 Quiz Score", "U7 Calc Fluency", "U7 Drill Stars")
- One composite assignment per unit combining all apps
- Category-based (formative vs summative) with different weights

### Q4: Agent pipeline integration

Should the daily metrics job live in:
**(a) The new repo** — self-contained, all telemetry logic in one place
**(b) Agent repo** — alongside existing Schoology CDP automation, reuses machine-aware paths
**(c) Both** — metrics computation in new repo, gradebook push delegated to Agent via cross-agent runner

### Q5: tmux-trainer data persistence

Currently pure localStorage. To feed metrics pipeline, it needs Supabase sync. Options:
- Add Supabase client to tmux-trainer (breaks its zero-dependency design)
- "The Desk" hub reads tmux-trainer localStorage and proxies to Supabase
- postMessage bridge between iframe and hub

### Q6: Deployment topology

Where does "The Desk" hub deploy?
- GitHub Pages (static, free, existing pattern)
- Vercel (auto-deploy, existing pattern for driller/trainer)
- Its own Railway instance (if it needs server-side logic)

---

## 7. Timeline & Scope

- **Target launch**: School Year 2026-27 (late August / early September 2026)
- **Development window**: ~4.5 months (mid-April through August 2026)
- **This is a greenfield build** — no rush to ship half-baked features for the current year's students
- **Current students** (SY25-26) continue using existing deployments as-is through the AP exam (May 7) and end of year
- **Summer** is the build phase — full architecture, telemetry pipeline, gradebook automation, widget extraction, DeepSeek migration
- **August** is integration testing with real Schoology course shells for next year's sections
- **Implication**: We can make breaking changes, rethink repo structure, and build proper infrastructure without worrying about disrupting live classrooms

---

## 8. File Inventory for New Repo

```
the-desk/                              (proposed)
├── hub/                               ← System 7 portal (from follow-alongs)
│   ├── index.html                     ← desktop, window manager, icons
│   ├── apps.json                      ← registry of all app endpoints
│   └── styles/                        ← System 7 chrome CSS
├── ti84-widget/                       ← extracted native module
│   ├── ti84-native.js
│   ├── stat-math.js
│   ├── form-engine.js
│   ├── screen-renderer.js
│   ├── result-formatter.js
│   ├── menu-nav.js
│   ├── event-bus.js
│   ├── field-tables.js
│   ├── menu-tables.js
│   └── widget.js                      ← mount/embed API
├── telemetry/                         ← event logging client
│   ├── client.js                      ← lightweight logger for all apps
│   ├── keystroke-diff.js              ← optimal vs actual path comparison
│   └── schema.sql                     ← Supabase event store DDL
├── grading/                           ← unified DeepSeek v4 client
│   ├── client.js                      ← API wrapper
│   └── rubrics/                       ← merged from all repos
├── metrics/                           ← daily collation
│   ├── collate.js                     ← compute per-student scores
│   └── schoology-push.js             ← Puppeteer gradebook automation
├── shared/                            ← cross-app utilities
│   ├── auth.js                        ← Fruit_Animal auth
│   └── supabase.js                    ← unified client config
├── specs/                             ← design documents
│   └── this-file.md
├── package.json
├── CLAUDE.md
└── CONTINUATION_PROMPT.md
```

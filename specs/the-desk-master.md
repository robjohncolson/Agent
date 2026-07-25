# The Desk — Claude Code Master Prompt

**What this file is**: The north-star document for building The Desk platform from the ground up over summer 2026. It is simultaneously a CLAUDE.md for Claude Code, an architecture decision record, and a phased implementation plan. Every task in this project should reference this document.

**Author**: Robert Colson, AP Statistics / Algebra 2 teacher, Lynn English High School
**Date**: 2026-04-11
**Target launch**: Late August 2026 (SY26-27, ~4.5 months of dev time)
**Students**: ~60 across 2 periods (Period B, Period E) — next year's cohort starts fresh

---

## 0. The One-Paragraph Vision

The Desk is a single student-facing platform — one URL, one login, one identity — that unifies quizzes, drills, live worksheets, calculator training, and formula practice behind a System 7 Mac-styled desktop. Underneath, an append-only telemetry pipeline captures every meaningful student interaction across all apps, computes daily multi-dimensional metrics, and pushes grades into the Schoology gradebook via Puppeteer automation. Students never leave The Desk. Teachers never manually enter a grade.

---

## 1. Locked Architectural Decisions

These are settled. Do not revisit or second-guess them.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Repo strategy** | Keep existing repos as-is. New `the-desk` repo for the unified app. Old repos serve as reference/wisdom, not migration targets. | Avoids link breakage across hundreds of lesson materials. Monorepo transition can happen later as databases converge. |
| **Deployment** | Vercel (new project, new deploy) | Single domain for auth cookie scope. Free tier sufficient for 60 students. |
| **Auth** | Fruit_Animal usernames with real names + passwords. Single Supabase Auth project. No email/Google SSO. | Students don't have reliable email. Fruit_Animal is a known pattern. One identity across all apps. |
| **Database** | Brand new Supabase project. Audit existing instances (curriculum_render + driller) for schema patterns worth keeping. Students start fresh. | Clean schema designed from scratch using SY25-26 data as reference. No migration of student data. |
| **AI grading** | DeepSeek API (currently v3.2 — `deepseek-chat` and `deepseek-reasoner`). Build a provider-routing abstraction so model IDs are never hardcoded. When v4 API ships, swap with a config change. | OpenAI-compatible API. Provider routing protects against model deprecation, outages, or pricing changes. |
| **Schoology integration** | Puppeteer/CDP only (no API access). Extend existing Agent pipeline patterns. | Admin won't grant API credentials. Puppeteer already proven for lesson posting. |
| **Hub UI** | System 7 Mac aesthetic ("The Desk"). Keep and expand the existing desktop metaphor — draggable icons, window management, close/minimize/maximize. | Students love it. It's a differentiator. The window metaphor maps naturally to multiple apps. |
| **Calculator integration** | Transpiled TI-84 ROM running as pure JS — a fully instrumented execution environment with read access to all internal state (CPU, memory, LCD framebuffer, graph rendering). ~16.5% transpiled as of April 2026; completing Phase 25G (event loop at `0x00B608`, `_GetCSC` scan, LCD MMIO at `0xE00000`) is a prerequisite to Desk Phase 1. This is NOT a widget or a simulation — it's the real ROM logic running transparently in JS. | Full internal transparency enables: keystroke-level telemetry with exact diff against optimal paths, graph output capture for AI-graded FRQ input, numeric entry error detection (student typed 4.3 instead of 4.2), and the LCD as a live display medium for curriculum content. No other AP Stats platform has this. |
| **Schoology push host** | Home laptop (always-on, SSH via Zellij). Daily cron job (~4 AM). Same machine that runs Agent pipeline. | Already set up with Puppeteer + Chromium. Grades aren't mission-critical — if power goes out, it pushes when power returns. No VPS needed for 60 students. |
| **Telemetry** | Append-only event log. IndexedDB queue (Dexie.js) with flush-on-online/interval/visibilitychange. One Supabase `events` table with UUID dedup. | No conflicts in append-only logs. School WiFi is unreliable. 60 students ≠ a scale problem. |
| **Offline-first** | Yes, always. Every student-facing feature must work on spotty school WiFi. Browser is the primary database; Supabase is the sync target. | Non-negotiable constraint of the environment. |

---

## 2. Source Repos (Reference, Not Migration Targets)

Each repo is a map of hard-won decisions. Use commit histories, test suites, and working code as guides. Do not import code wholesale — rewrite with the benefit of hindsight.

### 2.1 curriculum_render (~94K LOC)
- **What matters**: Quiz engine architecture, FRQ grading prompts/rubrics, consensus visualization logic, WebSocket real-time update patterns, the 667 Vitest tests (study the *what*, not the *how*).
- **What to leave**: The 580KB monolithic `index.html`, Groq integration, the dual IndexedDB/localStorage storage layer.
- **Key files to study**: `index.html` (quiz state machine), `railway-server/server.js` (Supabase proxy patterns, AI grading pipeline), GitNexus map (1,639 symbols, 3,825 edges, 138 flows).

### 2.2 follow-alongs (~50-100K LOC)
- **What matters**: TI-84 ROM transpilation project (Z80/eZ80 → JS, ~17% complete as of April 2026). The Desk hub's window management code. Worksheet content and Railway API sync patterns. The existing native module (9 files, 4,400 LOC, 354 tests) as reference for what the transpiled ROM needs to do.
- **What to leave**: CEmu WASM ROM emulation (the transpiled ROM replaces this), the 190MB ROM research artifacts.
- **Key files to study**: `ti84-trainer-v2/` (transpilation work — check current progress), hub `index.html` (System 7 desktop, window manager), `native/*.js` (reference behavior for the 27 statistical procedures), GitNexus map (2,228 symbols, 4,166 edges, 161 flows).

### 2.3 lrsl-driller (~152K LOC)
- **What matters**: Console-cartridge architecture pattern, the 23 cartridge definitions (content!), dual AI grading logic, Ghost System concept, SRS scheduling, Dexie.js usage patterns, the `registry.json` cartridge manifest, the 2,213 Vitest tests.
- **What to leave**: TensorFlow.js integration (overengineered for the use case), Three.js game chrome, the `app.html` monolith.
- **Key files to study**: `cartridges/` directory (all 23 cartridge definitions — this is curriculum gold), `platform/` (engine architecture), `railway-server/` (Supabase sync, AI grading), GitNexus map (6,410 symbols, 15,319 edges, 300 flows).

### 2.4 tmux-trainer (~12K LOC)
- **What matters**: SRS scheduling implementation, formula definitions, tower-defense game loop as a learning mechanic, KaTeX rendering patterns.
- **What to leave**: Music editor, the single-file architecture.
- **Key files to study**: `index.html` (the whole thing — it's one file, study the SRS logic and game loop).

### 2.5 Agent
- **What matters**: 12-step lesson prep pipeline, Schoology CDP automation patterns (`post-to-schoology.mjs`), lesson registry structure (`state/lesson-registry.json`), cross-machine path detection, Codex agent dispatch.
- **What to leave**: Nothing — this repo stays live and gets extended with gradebook push.
- **Key files to study**: `scripts/lesson-prep.mjs`, CDP automation scripts, `state/lesson-registry.json`.

---

## 3. Phase 0: Curriculum Content Inventory

This is the actual treasure and the prerequisite to everything else. All lesson materials, file locations, Blooket links, video URLs, quiz content, and cartridge definitions must be cataloged and preserved.

**This is multi-day work. Scope it progressively:**

**Phase 0a (Day 1-2)**: Start with already-structured data:
- `lrsl-driller/cartridges/registry.json` — all 23 cartridge definitions
- `Agent/state/lesson-registry.json` — 100+ lessons with all URLs and status
- `tmux-trainer/index.html` — formula definitions (grep for the SRS data structures)
- Output: initial `curriculum-manifest.json` with structured content only

**Phase 0b (Day 3-5)**: Extract semi-structured content:
- `curriculum_render/index.html` — quiz question banks (grep for question arrays/objects)
- `follow-alongs/*.html` — worksheet content and video URLs
- `follow-alongs/ti84-trainer-v2/native/field-tables.js` + `menu-tables.js` — procedure definitions
- Output: manifest expanded with quiz banks, worksheet metadata, procedure paths

**Phase 0c (Ongoing, as needed)**: Fill gaps discovered during Phase 3 app development. Not everything needs to be cataloged before code starts.

**Exit criteria for Phase 0a**: `curriculum-manifest.json` exists, loads in Node, contains all 23 cartridge definitions and the full lesson registry. Enough to test drill engine content loading.

**Manifest schema**:
```json
{
  "units": {
    "U7": {
      "title": "Sampling Distributions",
      "topics": {
        "sampling_dist_mean": {
          "quiz_questions": [...],
          "cartridge_ids": ["ap-stats-u7-sampling"],
          "worksheets": ["u7-l1-follow-along.html"],
          "formulas": ["formula_clt", "formula_z_score"],
          "calculator_procedures": ["1-sample-z-test"],
          "external_resources": {
            "blooket": "https://...",
            "video": "https://..."
          }
        }
      }
    }
  }
}
```

---

## 4. Architecture

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────┐
│  THE DESK (Vercel — single domain)                       │
│                                                          │
│  System 7 Desktop Shell                                  │
│  ├── Window Manager (drag, close, minimize, maximize)    │
│  ├── Icon Grid (app launchers)                           │
│  ├── Menu Bar (student name, period, settings)           │
│  └── My Progress (cross-app dashboard)                   │
│                                                          │
│  App Windows (rendered inside desktop windows):          │
│  ├── Quiz Engine (consensus quiz, FRQ grading)           │
│  │   └── Inline TI-84 calculator guidance                │
│  ├── Drill Engine (cartridge-based, SRS)                 │
│  │   └── Inline TI-84 calculator guidance                │
│  ├── Worksheets (video follow-alongs)                    │
│  ├── Calculator Trainer (standalone practice)            │
│  ├── Formula Defense (tower defense SRS game)            │
│  └── Study Mode (cross-app weakness-targeted review)     │
│                                                          │
│  Shared Services:                                        │
│  ├── Auth (Fruit_Animal, Supabase Auth)                  │
│  ├── Telemetry Client (Dexie.js queue → Supabase)        │
│  ├── AI Grading Client (provider-routed, DeepSeek)       │
│  ├── SRS Engine (unified cross-app scheduling)           │
│  └── Calculator Engine (TI-84 state machine)             │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Supabase │ │ DeepSeek │ │ Schoology│
   │ (new)    │ │ API      │ │ (CDP)    │
   │          │ │          │ │          │
   │ • auth   │ │ • FRQ    │ │ • grades │
   │ • events │ │   grading│ │ • posts  │
   │ • state  │ │ • feedback│ │          │
   └──────────┘ └──────────┘ └──────────┘
```

### 4.2 Supabase Schema (New Project)

Design this fresh. Study existing schemas for patterns but don't replicate their mistakes.

```sql
-- Auth: Supabase Auth handles this, but we need a profiles table
profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id),
  fruit_animal  text UNIQUE NOT NULL,     -- "Grape_Otter"
  display_name  text NOT NULL,            -- "Alex G."
  period        text NOT NULL,            -- "B" or "E"
  created_at    timestamptz DEFAULT now()
)

-- Unified event store (append-only, no updates, no deletes)
events (
  id            uuid PRIMARY KEY,         -- generated client-side via crypto.randomUUID()
  student_id    uuid REFERENCES profiles(id),
  app           text NOT NULL,            -- "quiz", "drill", "worksheet", "calculator", "formulas"
  event_type    text NOT NULL,            -- "question_complete", "keystroke_sequence", "star_earned", "wave_complete", etc.
  unit          text,                     -- "U7", "U8" — nullable for non-unit activities
  topic         text,                     -- "confidence_intervals", "chi_square" — nullable
  payload       jsonb NOT NULL,           -- app-specific event data (scores, keystrokes, timing, etc.)
  client_ts     timestamptz NOT NULL,     -- when the event actually happened (client clock)
  server_ts     timestamptz DEFAULT now() -- when Supabase received it
)

-- SRS state (unified across all apps)
srs_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES profiles(id),
  skill_id      text NOT NULL,            -- "z_score_calculation", "ti84_1prop_ztest", "formula_mean"
  source_app    text NOT NULL,            -- which app originated this card
  interval_days real NOT NULL DEFAULT 1,
  ease_factor   real NOT NULL DEFAULT 2.5,
  next_review   timestamptz NOT NULL DEFAULT now(),
  review_count  int NOT NULL DEFAULT 0,
  last_grade    int,                      -- 0-5 (SM-2 scale)
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(student_id, skill_id)
)

-- Quiz state (replaces curriculum_render's answer storage)
quiz_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES profiles(id),
  quiz_id       text NOT NULL,
  question_id   text NOT NULL,
  response      jsonb NOT NULL,           -- answer content (MCQ choice, FRQ text, etc.)
  is_correct    boolean,
  ai_score      real,                     -- 0-1 for FRQ
  ai_feedback   text,
  attempt_num   int NOT NULL DEFAULT 1,
  started_at    timestamptz,
  submitted_at  timestamptz DEFAULT now(),
  UNIQUE(student_id, quiz_id, question_id, attempt_num)
)

-- Drill progress (replaces driller's progress tables)
drill_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES profiles(id),
  cartridge_id  text NOT NULL,
  level         int NOT NULL DEFAULT 1,
  stars         int NOT NULL DEFAULT 0,
  attempts      int NOT NULL DEFAULT 0,
  best_score    real,
  last_played   timestamptz DEFAULT now(),
  UNIQUE(student_id, cartridge_id)
)

-- Worksheet completion
worksheet_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES profiles(id),
  worksheet_id  text NOT NULL,
  sections_done jsonb NOT NULL DEFAULT '[]',
  ai_scores     jsonb,                    -- per-section AI grades
  completed_at  timestamptz,
  UNIQUE(student_id, worksheet_id)
)

-- Daily computed metrics (materialized by the metrics job)
daily_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    uuid REFERENCES profiles(id),
  date          date NOT NULL,
  quiz_score    real,                     -- 0-100
  calc_fluency  real,                     -- 0-100
  drill_stars   real,                     -- 0-100 (normalized)
  worksheet_pct real,                     -- 0-100
  formula_srs   real,                     -- 0-100 (retention rate)
  composite     real,                     -- weighted combination
  details       jsonb,                    -- per-unit breakdowns, comments, etc.
  pushed_to_lms boolean DEFAULT false,
  UNIQUE(student_id, date)
)
```

### 4.3 Telemetry Client (~100 lines)

Every app calls `logEvent()`. Events queue in IndexedDB (Dexie.js), flush to Supabase on three triggers.

```javascript
// Pseudocode — the actual implementation should be this simple
import Dexie from 'dexie';

const db = new Dexie('desk-telemetry');
db.version(1).stores({ queue: 'id, synced' });

export async function logEvent(app, eventType, payload, { unit, topic } = {}) {
  await db.queue.add({
    id: crypto.randomUUID(),
    student_id: getCurrentUserId(),
    app,
    event_type: eventType,
    unit: unit || null,
    topic: topic || null,
    payload,
    client_ts: new Date().toISOString(),
    synced: 0
  });
}

async function flush() {
  const batch = await db.queue.where('synced').equals(0).limit(50).toArray();
  if (!batch.length) return;
  const { error } = await supabase.from('events').upsert(batch, { onConflict: 'id' });
  if (!error) {
    await db.queue.where('id').anyOf(batch.map(e => e.id)).modify({ synced: 1 });
    // Prune synced events older than 7 days
    const cutoff = Date.now() - 7 * 86400000;
    await db.queue.where('synced').equals(1).and(e => new Date(e.client_ts) < cutoff).delete();
  }
}

// Three flush triggers
window.addEventListener('online', () => setTimeout(flush, Math.random() * 5000)); // jitter!
setInterval(flush, 30000);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
```

### 4.4 AI Grading — Provider-Routed Client

```javascript
// Never hardcode model IDs. Route through a config.
const PROVIDERS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: {
      fast: 'deepseek-chat',        // quick feedback, MCQ validation
      reasoning: 'deepseek-reasoner' // FRQ grading, complex rubrics
    }
  }
  // Future: add openai, anthropic, groq as fallbacks
};

export async function gradeResponse(rubric, studentResponse, { provider = 'deepseek', tier = 'reasoning' } = {}) {
  const config = PROVIDERS[provider];
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: config.models[tier],
      messages: [
        { role: 'system', content: rubric },
        { role: 'user', content: studentResponse }
      ],
      temperature: 0.1
    })
  });
  return response.json();
}
```

**Async grading queue**: The telemetry queue handles events, but AI grading responses need their own offline queue. When a student submits an FRQ and the network is down, queue the grading request in IndexedDB. When connectivity returns, send to DeepSeek, then deliver the grade + feedback. Same Dexie.js pattern as telemetry — separate store, same flush logic. This prevents students from staring at a spinner on bad WiFi.

### 4.5 Calculator Engine — Transpiled TI-84 ROM

The calculator is NOT a simulation or a hand-built state machine. It is the actual TI-84 Plus CE ROM, transpiled from Z80/eZ80 assembly into JavaScript. Currently ~16.5% transpiled (CPU operational, event loop blocked at `0x00B608`, `_GetCSC` returning `0x10`, LCD MMIO not yet wired). Completing Phase 25G — event loop unblock, keyboard handler, LCD controller, STAT menu reachability, one full procedure path — is a prerequisite to The Desk's Phase 1 scaffolding.

**Why this matters architecturally**: The transpiled ROM gives full read access to the calculator's internal state at every execution step. This enables capabilities no other AP Stats platform has:

- **Exact keystroke telemetry**: Every keypress is captured with full context — what was on screen, what changed, what the CPU computed. Diff against optimal paths isn't heuristic; it's exact.
- **Numeric entry error detection**: If a student enters x̄=67.2 instead of x̄=67.3, the system sees the exact value in calculator memory. DeepSeek can explain: "Your test statistic is off because you entered 67.2 — look at the sample mean in the problem."
- **Graph output as AI input**: When the calculator renders a graph (normal curve, scatterplot, residual plot), the rendering function's output can be captured as structured data and fed to DeepSeek for FRQ grading. "Draw a normal distribution with μ=65, σ=4.2" — the AI can verify the graph is correct by reading the render parameters, not by doing image recognition.
- **LCD as curriculum display medium**: The calculator screen (320×240) becomes a live display for mathematical visualizations within quiz/drill questions. Graphs from the curriculum can be rendered ON the calculator, making the tool feel native to the content.
- **Guided mode with real ROM state**: Step-by-step walkthroughs show the actual calculator state at each step, not a mockup. The student sees exactly what their real TI-84 would show.

**Integration design**:

- **Single engine instance**, shared across quiz and drill windows
- **Mount API**: `calculator.mount(containerElement)` — renders the LCD canvas + virtual keypad into any DOM container
- **State serialization**: `calculator.getState()` / `calculator.setState(snapshot)` — full CPU/memory snapshot enables per-question save/restore
- **Keystroke recording**: every keypress emits to telemetry with `{ key, timestamp, cpuState, lcdSnapshot, questionContext }`
- **Optimal path diffing**: actual keystroke sequence vs. known optimal path. Efficiency score, extra keystrokes, backtracking, hesitation gaps (>3s). But also: detection of *valid alternative paths* — there's often more than one correct sequence
- **Memory inspection**: read computed values (test statistics, p-values, regression coefficients) directly from calculator memory for answer verification
- **Graph capture**: intercept graph rendering calls to extract plot data for AI grading input

**Standalone trainer** continues to exist as a separate practice mode. But the important integration is the transpiled ROM running inline during quiz and drill questions, capturing everything.

**Status tracking**: Claude Code should check the transpilation progress in `follow-alongs/ti84-trainer-v2/` — audit what percentage of the ROM is transpiled, what subsystems are operational (CPU, keypad, LCD, STAT menu, graph engine), and what's blocking completion. The transpilation work may continue in the follow-alongs repo while The Desk consumes the output as a dependency.

### 4.6 Schoology Gradebook Push (Puppeteer/CDP)

Runs on the home laptop (always-on, accessible via SSH/Zellij). Extend the existing Agent pipeline. Daily cron job (~4 AM):

1. Queries `daily_metrics` for today's date where `pushed_to_lms = false`
2. For each student: maps metrics to Schoology assignment columns (see gradebook mapping below)
3. Opens Schoology via Puppeteer, navigates to gradebook
4. For each assignment column: enters the grade, adds a comment with dimensional breakdown
5. Marks `pushed_to_lms = true` in Supabase

**Resilience**: If the machine is off (power outage, restart), the job simply runs on next boot and catches up — `pushed_to_lms = false` records accumulate harmlessly. Grades are not mission-critical; a day's delay is fine.

**Gradebook mapping strategy**:
- Create **5 category groups** in Schoology: Quiz Mastery, Calculator Fluency, Drill Progress, Worksheet Completion, Formula Retention
- Within each category: one assignment per unit (e.g., "U7 Quiz Score", "U7 Calc Fluency")
- Each grade gets a **comment** with detail: "Quiz: 85/100 (3/4 MCQ, 2.5/3 FRQ) | Calc: 72% efficiency (struggled with list entry) | Drill: 4/5 stars on CI cartridge"
- One additional **informational column** (0 points, doesn't count) called "Dashboard" — the comment contains a link to the student's My Progress page in The Desk

---

## 5. The Desk — Hub UI Specification

### 5.1 System 7 Desktop Environment

Preserve and expand the existing System 7 Mac aesthetic:

- **Desktop**: Textured background, menu bar at top, icon grid
- **Menu bar**: Apple menu (about) | File | student's Fruit_Animal name | Period indicator | clock
- **Icons**: Each app is a desktop icon. Double-click opens a window.
- **Windows**: Title bar with close/minimize/maximize buttons, resize handle, drag to reposition. Windows can overlap. Z-ordering on click-to-focus.
- **My Progress**: A persistent window (or menu bar item) showing cross-app stats dashboard

### 5.2 App Windows

Each "app" renders inside a Desk window. These are NOT iframes — they're components rendered within the same DOM, sharing auth, telemetry, and state.

- **Quiz window**: Full consensus quiz experience. Calculator guidance appears inline when questions are tagged as calculator-heavy.
- **Drill window**: Cartridge selection → drill session. Cartridge definitions loaded from curriculum manifest.
- **Worksheet window**: Video follow-along with embedded questions. Links to external video with timestamped sync.
- **Calculator window**: Standalone TI-84 practice (recall mode + guided mode).
- **Formula Defense window**: Tower defense game with SRS. (This one CAN be an iframe if the rewrite cost is too high — it's the most self-contained app.)
- **Study Mode window**: AI-generated personalized review session pulling weak skills from across all apps.

### 5.3 My Progress Dashboard

The cross-app view that makes the platform more than the sum of its parts:

- **Heatmap**: AP Stats topics as rows, apps as columns, mastery level as color intensity (red → yellow → green). Instantly reveals "knows the formula but can't execute on calculator" gaps.
- **SRS forecast**: "You have 12 cards due today across 3 apps"
- **Calculator fluency trend**: efficiency score over time, broken down by procedure type
- **Streak counter**: consecutive days with activity across any app
- **Weakness alerts**: "Your chi-square quiz scores (62%) are lower than your chi-square drill performance (88%). Try the calculator trainer for χ² procedures."

---

## 6. Phased Build Plan

### Phase 0: Curriculum Inventory (Week 0 — before anything else)

**Goal**: Build the curriculum manifest from structured data in existing repos.

See §3 for full details. Run Phase 0a (structured data from registry.json files) before starting Phase 1. Phase 0b and 0c can run in parallel with later phases.

**Exit criteria**: `curriculum-manifest.json` loads in Node, contains all 23 cartridge definitions and the full lesson registry.

### Phase 1: Foundation (Weeks 1–4)

**Goal**: A working skeleton — one URL, one login, one empty desktop.

1. **Scaffold the repo**
   - Vite project (vanilla JS, no framework — keep it consistent with existing code style)
   - Directory structure: `src/shell/`, `src/apps/`, `src/services/`, `src/shared/`, `content/`
   - Vitest for testing
   - Vercel deployment config
   - This file becomes `CLAUDE.md` at repo root

2. **Supabase project setup**
   - Create new Supabase project
   - Implement the schema from §4.2
   - Row Level Security policies: students can only read/write their own data
   - Audit existing Supabase instances: document what schema patterns to adopt vs. discard

3. **Auth system**
   - Supabase Auth with email/password (email = `fruitanimal@desk.local` — synthetic, never sent to)
   - Login screen: student enters Fruit_Animal username + password
   - Session management: JWT stored in memory + localStorage fallback
   - `getCurrentUser()` utility available to all modules

4. **The Desk shell**
   - System 7 desktop rendering: menu bar, icon grid, desktop background
   - Window manager: create, drag, close, minimize, maximize, z-order
   - App registry: JSON config mapping app IDs to window configs
   - Placeholder windows for each app (just a title + "Coming soon")

**Exit criteria**: Student can visit the Vercel URL, log in as Grape_Otter, see a System 7 desktop with 6 app icons, open/close/drag windows. Auth persists across refresh.

### Phase 2: Telemetry + Content Pipeline (Weeks 5–8)

**Goal**: Events flow from browser to Supabase. Curriculum content is loadable.

5. **Telemetry client**
   - Implement the Dexie.js queue from §4.3
   - Write flush logic with the three triggers
   - Add jitter to online reconnection
   - Test with simulated offline/online cycles
   - Verify UUID deduplication in Supabase

6. **Curriculum manifest**
   - Should be mostly done from Phase 0 (§3)
   - Fill gaps: quiz question banks from curriculum_render, remaining worksheet content
   - Content loading system: apps request content by unit/topic/type

7. **AI grading client**
   - Implement provider-routed client from §4.4
   - Port grading rubrics from curriculum_render and lrsl-driller
   - Test against DeepSeek `deepseek-chat` and `deepseek-reasoner`
   - Verify rubrics produce consistent grades across model versions

8. **Calculator engine integration**
   - Audit transpilation progress in `follow-alongs/ti84-trainer-v2/` — what % complete, what subsystems work (CPU, keypad, LCD, STAT menu, graph engine)
   - If transpilation is complete: import transpiled ROM as ES module, wrap with mount/unmount API
   - If still in progress: use existing native state machine (4,400 LOC) as bridge, swap in transpiled ROM when ready
   - Implement state serialization (full CPU/memory snapshot for per-question save/restore)
   - Implement keystroke recording → telemetry pipeline
   - Implement memory inspection (read computed values for answer verification)
   - Implement optimal path diffing + efficiency scoring
   - Build guided mode (step-by-step with real ROM state) and recall mode
   - Graph capture: intercept rendering calls for AI grading input
   - Port relevant tests from the 354 existing tests as validation suite

**Exit criteria**: `logEvent()` works from any app window, survives WiFi toggle, data appears in Supabase. Calculator engine renders in a test window, records keystrokes, computes efficiency. Curriculum content loads by unit/topic.

### Phase 3: Core Apps (Weeks 9–14)

**Goal**: Quiz and Drill engines are playable inside The Desk.

9. **Quiz engine**
   - Rebuild consensus quiz inside a Desk window
   - MCQ + FRQ with DeepSeek grading
   - Real-time peer answer distribution (WebSocket or Supabase Realtime)
   - Per-question timing, attempt tracking
   - Inline calculator guidance on tagged questions (mount calculator engine beside question)
   - FRQ appeal system
   - All interactions emit telemetry events

10. **Drill engine**
    - Rebuild cartridge-based drill platform inside a Desk window
    - Load cartridge definitions from curriculum manifest
    - SRS scheduling (use unified `srs_cards` table)
    - Star rating system, attempt tracking
    - AI grading for open-response drills
    - Inline calculator guidance where applicable
    - All interactions emit telemetry events

11. **Worksheet viewer**
    - Render worksheet content inside a Desk window
    - Video embed with timestamp-synced sections
    - AI-graded reflection questions
    - Section completion tracking
    - All interactions emit telemetry events

**Exit criteria**: A student can open Quiz, Drill, and Worksheet windows, complete activities in each, see their progress update in real time. Calculator guidance appears inline on tagged questions. All events are in Supabase.

### Phase 4: Dashboard, Metrics, Gradebook (Weeks 15–18)

**Goal**: My Progress dashboard works. Grades flow to Schoology automatically.

12. **My Progress dashboard**
    - Cross-app heatmap (topics × apps × mastery)
    - SRS due-card counter
    - Calculator fluency trend chart
    - Streak counter
    - Weakness alerts (cross-app pattern detection)

13. **Daily metrics job**
    - Node.js script (runs in Agent repo or standalone cron)
    - Queries events table, computes per-student daily_metrics
    - Writes to daily_metrics table

14. **Schoology gradebook push**
    - Extend Agent's Puppeteer/CDP automation
    - Create assignment columns per category per unit
    - Push daily_metrics → Schoology grades with comments
    - Mark pushed records

15. **Formula Defense integration**
    - Either rewrite inside The Desk OR embed via iframe with postMessage bridge for telemetry
    - Connect SRS data to unified srs_cards table
    - Decision point: if rewrite cost > 2 weeks, use iframe approach

16. **Study Mode**
    - Query srs_cards for due items across all apps
    - Query daily_metrics for weak dimensions
    - Generate a mixed-practice session: alternate between quiz questions, calculator procedures, and drill problems targeting the student's weakest skills
    - Interleaving across content types (not just topics)

**Exit criteria**: Full end-to-end flow — student uses The Desk all day, My Progress updates live, metrics job runs overnight, grades appear in Schoology by morning. Study Mode generates a personalized 10-minute review session.

---

## 7. Creative Features (Build If Time Permits, In Priority Order)

These are the compound-value features that make The Desk more than a portal.

### 7.1 Cross-App SRS Engine
One SRS schedule per skill, updated by evidence from any app. A student who nails z-scores in the drill app gets credit in the quiz review schedule too. Implements interleaving effect — mixed-practice sessions alternate content types by design.

### 7.2 Keystroke Replay (Peer Worked Examples)
Record calculator interactions as timestamped traces. Allow students to watch anonymized replays of successful peers' procedures. Research-backed: worked example effect is one of the strongest findings in educational psychology. Fading: as a student masters sub-steps, hide those steps from future replays.

### 7.3 Cross-App Skill Heatmap with Predictive Alerts
The heatmap reveals gaps no single app can see. Add predictive alerts: "Students who struggle with list operations in calculator trainer are 73% more likely to miss inference questions on quizzes" — mined from cross-app correlation data.

### 7.4 Tower Defense as Diagnostic Engine
Each tower type represents a statistical concept. Enemies generated from the student's weakest skills across all apps. Towers display real-time performance statistics (mean damage, SD of hit rate). Game performance reveals integration weaknesses.

### 7.5 Metacognitive Pulse
Brief post-session reflections: "You spent 45s on Q3 (average is 20s). Your calculator trainer shows you nail this formula. What made the quiz harder?" Bridges the gap between awareness and regulation.

---

## 8. Technical Standards

### 8.1 Code Style
- Vanilla JavaScript (ES modules, no TypeScript, no framework)
- Vite for dev server and build
- Vitest for testing — port the spirit of existing tests, not the implementations
- CSS: System 7 aesthetic via CSS custom properties. Dark mode not needed (classroom use).
- Target: Chrome 90+ (Chromebooks), Safari 15+ (iPhones), Firefox 100+

### 8.2 File Organization
```
the-desk/
├── CLAUDE.md                          ← this file
├── package.json
├── vite.config.js
├── vercel.json
├── src/
│   ├── main.js                        ← entry point
│   ├── shell/                         ← The Desk desktop environment
│   │   ├── desktop.js                 ← icon grid, background, layout
│   │   ├── window-manager.js          ← create, drag, close, minimize, maximize
│   │   ├── menu-bar.js                ← System 7 menu bar
│   │   └── styles/                    ← System 7 CSS
│   ├── apps/                          ← each app as a module
│   │   ├── quiz/
│   │   ├── drill/
│   │   ├── worksheet/
│   │   ├── calculator/
│   │   ├── formulas/                  ← Formula Defense
│   │   ├── study-mode/
│   │   └── progress/                  ← My Progress dashboard
│   ├── services/                      ← shared infrastructure
│   │   ├── auth.js
│   │   ├── telemetry.js               ← Dexie.js queue + flush
│   │   ├── grading.js                 ← provider-routed AI client
│   │   ├── srs.js                     ← unified SRS engine
│   │   ├── supabase.js                ← client config
│   │   └── calculator-engine/         ← transpiled TI-84 ROM + integration layer
│   │       ├── rom.js                 ← transpiled ROM (imported from follow-alongs when ready)
│   │       ├── bridge.js              ← mount API, state serialization, keystroke capture
│   │       ├── memory-inspector.js    ← read computed values from calculator memory
│   │       ├── graph-capture.js       ← intercept graph rendering for AI input
│   │       ├── path-differ.js         ← optimal vs actual keystroke path analysis
│   │       └── native-fallback/       ← existing state machine as bridge until ROM is complete
│   │           ├── ti84-native.js
│   │           ├── stat-math.js
│   │           ├── form-engine.js
│   │           ├── screen-renderer.js
│   │           ├── result-formatter.js
│   │           ├── menu-nav.js
│   │           ├── field-tables.js
│   │           └── menu-tables.js
│   └── shared/                        ← utilities
│       ├── event-bus.js
│       └── utils.js
├── content/
│   ├── curriculum-manifest.json       ← all content indexed by unit/topic/type
│   ├── quiz-banks/                    ← question definitions
│   ├── cartridges/                    ← drill cartridge definitions
│   ├── worksheets/                    ← worksheet content
│   ├── formulas/                      ← formula definitions
│   ├── procedures/                    ← TI-84 optimal keystroke paths
│   └── rubrics/                       ← AI grading rubrics
├── scripts/
│   ├── build-manifest.js              ← crawls old repos → curriculum-manifest.json
│   ├── metrics-job.js                 ← daily metrics computation
│   └── schoology-push.js             ← Puppeteer gradebook automation
├── tests/
│   ├── services/
│   ├── apps/
│   └── shell/
└── docs/
    ├── schema.sql                     ← canonical Supabase DDL
    ├── telemetry-events.md            ← event type catalog
    └── gradebook-mapping.md           ← Schoology column definitions
```

### 8.3 Testing Strategy
- Unit tests for services (auth, telemetry, grading, SRS, calculator engine)
- Integration tests for app flows (quiz completion → telemetry → metrics)
- E2E tests for critical paths (login → open quiz → answer question → see progress update)
- Port relevant tests from old repos (especially the 354 calculator tests and key quiz flow tests)
- Target: >80% coverage on services, >60% on apps

### 8.4 Performance Budget
- Initial load: <2s on school WiFi (3G simulation)
- App window open: <500ms
- Calculator LCD render: 60fps on Chromebook
- Telemetry flush: non-blocking, <100ms per batch
- Total bundle size: <500KB gzipped (excluding content JSON, which lazy-loads)

---

## 9. What NOT to Build

Explicitly out of scope to prevent scope creep:

- **No TypeScript** — adding a type system to a solo vanilla JS project adds compile steps without proportional benefit at this scale
- **No React/Vue/Svelte** — the existing code is vanilla JS and works. A framework migration is a rewrite-within-a-rewrite.
- **No real-time collaboration features** — the consensus quiz's peer distribution is sufficient. No Google Docs-style simultaneous editing.
- **No parent-facing portal** — parents see Schoology. The Desk is for students.
- **No mobile-native app** — responsive web is fine. Students use Chromebooks primarily.
- **No LTI integration** — would be nice but requires admin cooperation that isn't available
- **No CEmu WASM emulation** — the transpiled ROM (target) and native state machine (fallback/bridge) replace this entirely
- **No TensorFlow.js** — the Ghost System concept from driller can be approximated with simpler heuristics on the telemetry data
- **No complex conflict resolution** — append-only events don't conflict. SRS uses last-write-wins (same student, same device, sequential usage — no real conflicts).

---

## 10. Context for Claude Code

When working on this project:

- **You are building a from-scratch rewrite**, not migrating existing code. The old repos are reference material.
- **The user is a solo teacher-developer**, not a full-time engineer. Simplicity > elegance. Working > perfect.
- **60 students, 2 periods**. This is not a scale problem. Don't over-engineer for scale.
- **School WiFi is unreliable**. Every student-facing feature must work offline and sync when connectivity returns.
- **The System 7 aesthetic is sacred**. The Desk should feel like a Mac from 1991 — warm, familiar, charming. Not a modern SaaS dashboard.
- **Curriculum content is the real asset**. The code is a delivery vehicle for AP Statistics and Algebra 2 instruction. Protect the content, iterate the code.
- **The AP Statistics exam is May 7** (of any given year). Every feature should be evaluated against: "Does this help students pass the AP exam?"
- **Refer to this document** whenever making architectural decisions. If something contradicts this document, flag it and ask — don't silently deviate.

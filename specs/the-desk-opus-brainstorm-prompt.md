# Claude Opus Brainstorm Prompt — The Desk Platform

Paste this into a fresh Claude Opus conversation (web UI, not Code). Goal: creative architectural brainstorming with someone who has full context.

---

## Prompt

I need your help as a creative thinking partner. I'm an AP Statistics teacher who has been building educational software for my classroom across 5 separate repos over several months. I'm now at the point where I want to unify them into a single platform. I have a spec (below) but I'm stuck on several architectural decisions and I want to brainstorm *creatively* — not just pick the safest option.

### What I've Built (the pieces)

**1. Real-time Consensus Quiz** (~94K LOC)
A live quiz app where all 30 students answer AP Stats questions simultaneously and see peer answer distributions in real time. Has AI-graded free-response questions with an appeal system. Express backend on Railway, Supabase for storage, WebSocket for live updates. The index.html is a 580KB monolith.

**2. Drill/Cartridge Platform** (~152K LOC)
A "console-cartridge" architecture: a topic-neutral game engine that loads lesson modules. 23 cartridges across AP Stats, Algebra 2, and CS. Dual AI grading (regex first, then AI upgrade). Ghost System (AI learns student behavior), SRS, Manim animations. Vite + Tailwind + Three.js + TensorFlow.js. Deployed on Vercel + Railway.

**3. Live Worksheets + TI-84 Calculator Trainer**
30+ interactive worksheets students complete while watching instructional videos. Plus a standalone TI-84 Plus CE trainer that runs a real calculator ROM in the browser via CEmu WASM. A native JS state machine (~4,400 LOC, 354 tests) validates every keystroke against 27 statistical procedures. It knows the exact optimal key sequence for every AP Stats calculator operation.

**4. Formula Defense Game** (~12K LOC)
Tower-defense game with Three.js 3D graphics where students type formulas to kill enemies. Spaced repetition scheduling. Full music editor. Pure client-side, zero dependencies (everything via CDN).

**5. "The Desk" Hub**
A System 7 Mac-styled desktop environment that already serves as a portal. Draggable icons, window management (close/minimize/maximize), iframe-based app embedding. Has a "My Progress" window that queries both Supabase instances to show cross-app stats. Currently lives inside the worksheets repo.

**6. Teacher Automation Pipeline** (Agent repo)
A 12-step pipeline that: ingests lesson videos via Gemini → generates worksheets, Blooket quizzes, and drill cartridges via Codex → renders Manim animations → uploads to Supabase → posts everything to Schoology → tracks status in a lesson registry. Also has Puppeteer/CDP automation for Schoology and a parallel Codex agent dispatch system.

### What I Want to Build Next

**A. Inline TI-84 guidance in quiz questions.** When a student hits a calculator-heavy question (run a t-test, find a confidence interval), a mini TI-84 widget appears inline. It shows the correct keystroke sequence step-by-step, with a live LCD canvas rendering what they should see. Their actual keystrokes are recorded and diffed against the optimal path.

**B. Keystroke telemetry + efficiency metrics.** Every calculator interaction gets logged: optimal path vs actual path, extra keystrokes, backtracking, hesitation time. This data feeds into a per-student "calculator fluency" score.

**C. Granular quiz completion tracking.** Per-question timestamps, attempt counts, time-on-task — not just final scores.

**D. Daily automated gradebook push.** A collation job aggregates metrics across all apps, computes composite scores, and pushes them into the Schoology gradebook via the same Puppeteer/CDP framework already used for lesson posting.

**E. Unified AI grading on DeepSeek v4.** Replace the patchwork of Groq + Gemini with a single DeepSeek v4 endpoint (I already have per-project API keys).

### The Spec's Open Questions (where I need creative help)

Here's where I'm stuck. For each, I don't want the "safe" answer — I want you to think about what would be *elegantly simple*, what would *compound in value over time*, and what a *solo teacher-developer* can actually maintain.

**1. The Widget Problem**
The TI-84 native module (4,400 LOC) was built to run standalone. Now I want it embedded inline in quiz questions inside curriculum_render (a 580KB monolithic HTML file). Three options:
- Deep embed into curriculum_render
- Floating overlay from The Desk hub
- Hybrid with postMessage bridge

But maybe there's a 4th option I haven't considered. What if the widget isn't embedded *in* the quiz at all, but the quiz is embedded *in* the widget? Or what if the calculator becomes the primary interface and the questions are overlaid on it? Think about what the *student experience* should feel like for a question like "Find the p-value for H₀: μ=65 given x̄=67.3, s=4.2, n=25, α=0.05" — they need to know which test, which menu, which fields, AND interpret the result.

**2. The Telemetry Architecture**
I have 5 apps that need to log to one place. But they're deployed across 3 different hosts (GitHub Pages, Vercel, Railway). Some are iframes in The Desk, some are standalone. School WiFi is unreliable. Students might close the tab mid-question. What's the most resilient way to collect this data? Think about:
- What if the browser is the database and Supabase is just the sync target?
- What if each app writes to its own IndexedDB and a service worker handles sync?
- What if the telemetry is append-only and conflict-free?

**3. The Gradebook Mapping Problem**
I'm going to have per-student data across 5 dimensions: quiz scores, calculator fluency, drill progress, worksheet completion, formula SRS. Schoology gradebooks have assignment columns with point values. How should rich multi-dimensional learning data map to a flat gradebook? Think about:
- What's actually *useful* for the student to see as a grade?
- What's useful for *me* as a teacher to see?
- What's useful for *parents* who look at Schoology?
- Could the gradebook push be more than just numbers — e.g., pushing comments or links to dashboards?

**4. The "What compounds" Question**
I'm building this over summer 2026 for a late-August launch (SY26-27). I have ~4.5 months — enough time to do it right, but I'm one person. What should I build *first* so that everything else is easier? What's the foundational layer that makes the rest fall into place? And what should I explicitly *not* build because it won't compound?

**5. The Repo Question**
Should this be:
- A new monorepo that subsumes everything (maximum control, massive migration effort)
- A thin integration layer that coordinates existing repos (lightweight, but another thing to maintain)
- An extension of The Desk hub (it's already a portal — just keep growing it)
- Something else entirely — like a Supabase Edge Functions project where the "repo" is really just database logic and the apps stay independent

**6. Wild Ideas Welcome**
I've been heads-down building for months. I might have tunnel vision. Are there creative angles I'm missing? For example:
- What if students could see each other's calculator keystroke replays (peer learning from watching efficient paths)?
- What if the drill cartridge system could auto-generate TI-84 procedure walkthroughs as a new cartridge type?
- What if the formula defense game's SRS data cross-pollinated with the calculator trainer's SRS to identify "knows the formula but can't execute on calculator" gaps?
- What if The Desk had a "study mode" that pulled the student's weakest areas across all apps and generated a personalized review session?

Push me on anything that seems overengineered or underambitious. I want to hear ideas that are both wild and buildable by one person.

### Constraints

- Solo developer (teacher who codes, not full-time engineer)
- ~60 students across 2 periods (Period B and Period E) — next year's cohort
- **Target: SY26-27 launch (late August 2026)** — building over summer, ~4.5 months of dev time
- Current year's students stay on existing deployments through end of SY25-26 — no disruption
- This means I *can* make breaking changes, restructure repos, and build proper infrastructure
- School WiFi is unreliable; offline-first matters
- Students use a mix of Chromebooks, phones, and personal laptops
- I already have: Supabase, Railway, Vercel, GitHub Pages, DeepSeek API keys, Puppeteer CDP automation for Schoology
- My LLM toolchain: Claude Code (hub), Codex (executor), Gemini (visual/ingest), DeepSeek (grading), ChatGPT (research)

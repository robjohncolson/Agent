# The Desk: an architectural blueprint for unifying five apps in one summer

Robert has five working apps, 300K lines of vanilla JS, and 4.5 months before students walk in the door. The central insight driving every recommendation below: **this is a federation problem, not a rewrite problem.** The apps work. The goal is to make them feel like one platform, share data that compounds, and ship reliably on school WiFi. Every architectural choice below optimizes for one thing: maximum leverage per hour of solo dev time.

What follows is a deeply researched, opinionated answer to each of the six architectural questions — backed by how Desmos, Khan Academy, and IXL actually solve these problems in production, what learning science says about the creative features, and what real solo developers report about platform unification.

---

## 1. The calculator widget belongs inside the quiz, not beside it

The TI-84 state machine should be a **Web Component with Shadow DOM, embedded directly into quiz questions as a singleton that repositions per question**. This is not a close call.

Both Desmos and GeoGebra — the two most successful educational math widget platforms — use direct DOM injection via JavaScript API, not iframes. Desmos exposes a `Desmos.GraphingCalculator(element, options)` constructor that renders into a host-page `<div>`. GeoGebra explicitly states: "The recommended way to embed a GeoGebra applet is to embed it directly as a div element." They fall back to iframes only when forced by hostile LMS environments like Moodle. The state synchronization pattern both use is identical: `getState()` serializes to JSON, `setState()` restores, and `observeEvent('change', callback)` fires on any modification. This is the gold standard.

**Shadow DOM solves the real problem** — CSS isolation against the 580KB monolithic HTML. The calculator's styles won't leak out; the quiz's styles won't bleed in. Unlike an iframe, there's no separate browsing context, no additional HTTP request, no serialization overhead. The 4,400 LOC state machine runs in the same JavaScript context as the quiz, enabling synchronous function calls like `calculator.getCurrentExpression()` with zero latency. PostMessage performance is technically fine for keystrokes (sub-millisecond for ~200-byte payloads), but it adds architectural complexity that a solo developer doesn't need when direct function calls work.

**The singleton pattern is critical.** Desmos's own team warns: "Loading lots of separate calculators on one page is pretty resource intensive." Create one `<ti84-calculator>` element, reposition it into each question's container as the student navigates, and save/restore state per question via `getState()`/`setState()`. This keeps memory flat regardless of quiz length.

The implementation is roughly 50 lines of Web Component boilerplate wrapping the existing state machine:

- `class TI84Calculator extends HTMLElement` with `attachShadow({ mode: 'open' })`
- Inject existing CSS and JS into the shadow root
- Expose `getState()`, `setState()`, and a `result-ready` custom event
- Quiz controller moves the element between question containers and manages per-question state

**The creative inversion — "quiz embedded in calculator" — is research-backed but situational.** GeoGebra's Moodle integration does exactly this: the tool IS the assessment, with a `grade` variable inside GeoGebra communicating scores back. For the ~8 AP Stats procedures where the calculator IS the entire question (running a 1-PropZTest, performing LinReg), inverting the UI so the calculator is primary and the question prompt floats above it would match the cognitive task structure. For questions where the calculator merely assists, keep the standard embed. **Build both modes into the Web Component** — a `data-mode="primary"` attribute that flips the layout.

**Fallback strategy**: If the monolithic HTML's JavaScript environment proves hostile (global variable collisions, unexpected event interference), upgrade to iframe + Penpal (~2KB library, promise-based postMessage). Design the widget interface now to support either transport — same API, different plumbing.

---

## 2. A 100-line IndexedDB queue beats every fancy sync framework

The telemetry architecture should be a **shared ~100-line module using IndexedDB (via Dexie.js client library) with flush-on-online/interval/visibility-change, writing batches to a Supabase table with UUID-based deduplication.** Skip CRDTs, skip Dexie Cloud, skip Background Sync API, skip ElectricSQL/PowerSync/RxDB.

The reasoning is blunt: **append-only event logs have no conflicts by definition.** CRDTs solve concurrent modifications to shared mutable state — a problem that doesn't exist when every event is a unique, immutable record with a `crypto.randomUUID()` primary key. The entire local-first sync ecosystem (ElectricSQL, PowerSync, cr-sqlite) is designed for bidirectional sync of application data. For one-way telemetry from 60 students, this is like using a fire truck to water a houseplant.

The Background Sync API works on Chromebooks (Chrome 49+, **78.75% global browser support**) but fails on Safari and Firefox entirely. Students on iPhones get nothing. Worse, Chrome's implementation only retries 3 times with exponential backoff before dropping the sync tag. The complexity of service worker registration across 5 apps on 3 different hosts (GitHub Pages, Vercel, Railway) isn't worth the marginal benefit over a simpler approach.

**The practical implementation** that works everywhere:

Each of the 5 apps includes a shared telemetry module that calls `logEvent(type, data)`, which writes to a Dexie.js table with a UUID, client timestamp, app ID, and student ID. Three triggers fire `flush()`: the `online` event, a 30-second interval, and `visibilitychange`. Flush reads unsynced events, POSTs batches of up to 50 to a Supabase table, and deletes successfully synced records. The Supabase table uses `ON CONFLICT (id) DO NOTHING` for idempotent deduplication.

**One critical detail for school WiFi**: reconnection storms. When WiFi drops and returns, 60 Chromebooks will all fire `online` simultaneously. Add **random jitter** (0–5 seconds) to the flush timer: `setTimeout(flush, Math.random() * 5000)`. This spreads the load across 5 seconds instead of hammering Supabase with 60 concurrent requests.

**Supabase has no native offline support** — confirmed by official GitHub discussions. The team recommends third-party tools like PowerSync. But for append-only telemetry, the DIY queue is simpler, cheaper, and more reliable than adding another service dependency. Dexie.js (the client library, not Cloud) provides a clean IndexedDB wrapper at ~29KB — far better than raw IndexedDB's callback-heavy API.

The Supabase table schema:

```
events (
  id UUID PRIMARY KEY,
  app_id TEXT,
  student_id TEXT,
  event_type TEXT,
  event_data JSONB,
  client_ts TIMESTAMPTZ,
  server_ts TIMESTAMPTZ DEFAULT now()
)
```

**Total new code: ~100 lines shared across all 5 apps.** Total new dependencies: Dexie.js (optional — raw IndexedDB works too). Total new infrastructure: one Supabase table.

---

## 3. Push simple scores to Schoology, build the real gradebook elsewhere

Every major edtech platform follows the same pattern: **push simple numeric scores per-activity to the LMS gradebook; keep rich analytics in their own dashboard.** Khan Academy, IXL, and DeltaMath all do exactly this. None push composite scores. None push multi-dimensional data into single cells.

Khan Academy syncs each assignment as its own 100-point column — individual assignment scores only, never mastery data. Course Mastery Goals explicitly "will NEVER sync to the LMS." IXL pushes binary pass/fail per skill based on whether a student's SmartScore met a configurable goal. DeltaMath maps 1:1 — each assignment becomes one Schoology gradebook entry with a single percentage. **The universal lesson: the gradebook is a low-resolution display; the platform dashboard is the real gradebook.**

The Schoology API (or Puppeteer automation) supports several underutilized features that make the hybrid approach work:

- **Grade comments** (`comment` field on grade objects): attach text like "Q:85 C:72 D:90 W:100 S:68" alongside every numeric grade. With `show_comments: 1`, students and parents see the dimensional breakdown.
- **`count_in_grade: 0`**: create informational-only columns that appear in the gradebook but don't affect the calculated grade. Perfect for showing SRS streaks or drill progress without penalizing students.
- **Assignment `description` field**: accepts HTML, enabling embedded links to an external dashboard showing the full multi-dimensional view.
- **Grading categories**: organize columns into "Quiz Mastery," "Calculator Fluency," "Drill Progress," etc., each with configurable weights.

**The recommended mapping for 5 dimensions**:

Create **5 grading categories** in Schoology, each mapped to one learning dimension, with periodic "snapshot" assignments (weekly or per-unit) that capture current levels. Use the `comment` field on every grade for dimension-specific detail. Create one additional `count_in_grade: 0` "Dashboard" assignment whose description links to an external per-student dashboard showing the full cross-app heatmap. This mirrors what Khan/IXL/DeltaMath do while preserving diagnostic granularity.

**Education research supports this split.** Composite scores mask important patterns — a student scoring high on reading comprehension but low on decoding produces an average composite that hides the weakness. The Federation of American Scientists recommends a hybrid: composite scores for administrative purposes, **skill-based dashboards** for instructional decisions. The gradebook serves parents and administrators; the dashboard serves teaching.

If Schoology API credentials are obtainable (admin generates them at School Management → Integration → API), use the REST API with two-legged OAuth 1.0 — it's far more reliable and faster than Puppeteer for batch operations. The `PUT /v1/sections/{section_id}/grades` endpoint accepts arrays of grade objects with comments in a single request. If API access isn't available, the existing Puppeteer pipeline works — it just has to navigate to each grade cell and open the comment dialog.

---

## 4. Auth first, shell second, then strangle your own apps

The build order should follow the **load-bearing infrastructure principle**: build what everything else depends on first, then use the strangler fig pattern to incrementally absorb existing apps. With Claude Code providing a realistic **2–3x velocity multiplier** on implementation tasks (not the 10x that Medium posts claim), 4.5 months is tight but feasible.

**The compound value hierarchy is clear:**

1. **Unified authentication** (Supabase Auth) — every app needs to know who the user is. 100% of subsequent work benefits from this being done. A single Supabase project with one auth pool means all 5 apps share sessions, JWTs, and user profiles. Run everything under a single domain with subpath routing (`thedesk.app/quiz`, `/drill`, etc.) to eliminate cross-domain cookie issues entirely.

2. **Platform shell + routing** — the strangler fig façade. An Express app on Railway that serves shared navigation and routes to each app. Initially, each subpath proxies to the existing standalone app running unchanged. Users log in once and access everything. This is a visible milestone that proves the concept works.

3. **Shared data layer** — the cross-app progress schema that makes the platform more than the sum of its parts. Once quiz results can inform drill recommendations and drill performance generates worksheets, the compound platform effect kicks in.

**The strangler fig pattern** (Martin Fowler, Microsoft Azure docs) is the proven approach: introduce a façade that routes requests to either old or new systems, then migrate one app at a time. Each migrated app gets shared auth, shared data, and shared UI while the others keep working unchanged. Start with the **quiz app** — it shares the most data patterns with other apps and represents the clearest migration path.

**Realistic AI-assisted timeline** (9 two-week sprints):

- **Weeks 1–6 (Foundation)**: Unified Supabase project, auth flow, platform shell with routing, shared nav Web Component, cross-app data schema, shared API patterns. Deploy the shell with proxied access to all 5 existing apps behind unified login.
- **Weeks 7–14 (Migration)**: Migrate apps in order of shared-data potential — quiz first, then drill (reuses quiz infrastructure), then worksheet generator and calculator trainer, then tower defense (most independent, stays loosely coupled).
- **Weeks 15–18 (Polish)**: Unified dashboard, cross-app features, end-to-end testing, performance optimization, launch prep.

**The critical practice for AI-assisted development**: maintain a `.claude/` directory with architecture docs, conventions, and app-specific context. One solo developer building a 6-microservice platform with Claude Code found this essential — "A solo developer with an AI coding partner can maintain architecture that would normally need a team of 5–8. The tradeoff is heavy investment in documentation." Write granular atomic GitHub issues, use Claude Code to implement, test, merge, clear context, repeat.

**The METR randomized controlled trial** is worth noting: 16 experienced OSS developers took 19% longer with AI tools on tasks in familiar codebases, while believing they were 24% faster. But this studied experienced devs on code they already knew — the opposite of unification work where AI excels at scaffolding, boilerplate, and pattern migration across apps. The Faros AI study (10,000+ developers) found teams with high AI adoption completed **21% more tasks** and merged 98% more PRs, though review times ballooned 91%. For a solo developer with no review bottleneck, the gains skew higher.

---

## 5. Federate with Web Components and import maps — skip the monorepo

**Do not create a monorepo.** Do not install Turborepo or Nx. Do not migrate 300K+ LOC. The apps are vanilla JS with no shared framework, deployed across three different hosts. Monorepo tooling optimizes build caching for framework-heavy projects with shared component libraries — neither condition applies here. The migration cost alone would consume weeks with near-zero benefit.

**The right architecture is "federation via shared scripts"** — the same fundamental approach Google uses across Gmail, Calendar, Drive, and Maps. Each Google product is independently deployed but shares authentication (Google Account), design system (Material Design), and the navigation waffle grid. The shared elements are injected via scripts, not monorepo build outputs.

The implementation uses three browser-native technologies that require zero build tooling:

**Web Components for shared UI (~1 week).** Create `<unified-nav>` as a vanilla JS Custom Element with Shadow DOM. Host the JS file on GitHub Pages. Each app includes a single `<script>` tag and uses `<unified-nav></unified-nav>`. Shadow DOM provides style isolation. No framework required. All modern browsers support Custom Elements natively. This is the single highest-ROI action — instant visual unification with ~50 lines of code per component.

**Import maps for shared code (~1 week).** Browser-native `<script type="importmap">` maps bare module specifiers to CDN URLs. Create a `shared/` repo on GitHub Pages serving ES modules — Supabase client config, auth utilities, telemetry module, date formatting. Each app includes the import map and uses `import { logEvent } from 'shared-telemetry'`. Supported in all major browsers since 2023. Zero build step. Perfect for vanilla JS.

**Supabase Edge Functions as thin coordination layer (~1 week).** One or two Edge Functions handling cross-app concerns: shared auth state, user preferences, cross-app analytics aggregation. Edge Functions have a **2-second CPU time limit** (a hard constraint — one developer called it "a bad joke for production apps"), so they handle lightweight coordination only, not heavy processing. Keep the existing Express backends for app-specific logic.

**The resulting architecture**:

```
[Hub Page — GitHub Pages or Vercel]
  ├── <unified-nav> Web Component (CDN-hosted JS)
  ├── <script type="importmap"> → shared ES modules
  ├── Links/routes to each app
  └── Supabase Edge Function (auth coordination)

[Quiz — Vercel]  [Drill — Railway]  [Worksheets — GitHub Pages] ...
  Each includes:
  ├── <script src="shared-nav.js">
  ├── <script type="importmap"> → shared utilities
  ├── <link href="shared-styles.css">
  └── Own Express backend (unchanged)
```

Total new infrastructure: one GitHub Pages repo for shared assets, 1–2 Supabase Edge Functions, one shared CSS file with design tokens. The apps stay in separate repos, on their current hosting, with their current deployment pipelines. **Estimated effort: 4–6 weeks, leaving 2.5–3 months for feature development and migration.**

---

## 6. The creative features that only a unified platform can build

The most valuable creative features aren't individual app enhancements — they're capabilities that emerge from having **five apps sharing telemetry data about the same students studying the same subject.** Learning science provides strong backing for several specific ideas.

### Keystroke replay is a worked example machine

The **worked example effect** (Sweller & Cooper, 1985) is one of the strongest findings in educational psychology: studying step-by-step solutions produces superior learning compared to problem-solving alone, especially for novices. Recording timestamped keystroke and interaction sequences from the calculator trainer, quiz, and drill apps creates a library of peer-generated worked examples at zero content creation cost.

The chess analogy is precise. Chess.com's game review lets players step through moves, see where mistakes happened, and compare with engine recommendations. The AP Statistics equivalent: a student who failed a chi-square test question watches an anonymized replay of a successful student's calculator keystrokes, with pauses highlighted as "thinking moments." Research shows cognitive pauses during problem-solving correlate with difficulty points — making these visible teaches students where to slow down.

**Fading worked examples** (Renkl et al., 2004) are the optimal progression: as students demonstrate mastery of sub-steps, the walkthrough progressively hides solved steps. The telemetry data enables this automatically — if a student consistently gets the degrees-of-freedom step right, fade that step from future replays and focus on the steps they struggle with.

### Cross-app SRS leverages the interleaving effect

The **interleaving effect** (Taylor & Rohrer, 2010) is distinct from spacing and produces "vastly superior retention and generalization." Practicing A-B-C-A-B-C outperforms A-A-A-B-B-B-C-C-C because it forces students to discriminate between problem types. A unified SRS engine spanning all 5 apps creates interleaving automatically.

**The practical implementation is a single skill mastery table.** Each knowledge component (e.g., "z-score calculation") has one SRS schedule updated by evidence from any app. If a student correctly uses the z-score formula in the calculator trainer, the interval extends in the drill app too. Math Academy calls this "micro-interleaving" — when practice in one context provides implicit spaced repetition credit for component skills, reducing review overload.

The killer feature: **"mixed review" sessions** that alternate between a calculator procedure, a conceptual quiz question, and a worksheet problem on the same topic. The telemetry data identifies which skills are due for review across all apps and assembles a 10-minute interleaved session drawing problems from whichever app best targets each skill.

### The cross-app heatmap reveals what no single app can see

**Deep Knowledge Tracing** (Piech et al., 2015) can implicitly discover prerequisite structures among skills without expert annotation — the system automatically discovers that poor calculator skills predict quiz failures on specific topics. With telemetry from 5 apps, the platform can build a **cross-app skill graph** where each node is a skill and edges connect prerequisites.

The most immediately useful visualization: a **single heatmap with AP Statistics topics as rows, all 5 apps as columns, and mastery level as color intensity.** A student who scores well on probability drills but poorly on probability quiz questions reveals an application gap, not a knowledge gap — a distinction invisible to any single app. A student fast on calculator procedures but slow on the same procedures during quizzes reveals test anxiety or context-switching difficulty.

**Predictive weakness alerts** become possible: "Students who struggle with TI-84 list operations in calculator trainer are 73% more likely to miss inference questions on the quiz" — mined from cross-app telemetry correlations. When a student hits the leading indicator, the system preemptively assigns targeted practice before the quiz failure occurs.

### Tower defense becomes the diagnostic engine

Research on tower defense games in mathematics education (Hernández-Sabaté et al., International Journal of Serious Games) found the genre creates natural "mathematicisable moments" combining resource allocation, probability, and data analysis. The researchers specifically recommended adding "tools for displaying graphs of the damage processes caused by different towers" — making the game's statistics visible and analyzable.

The deep integration: **each tower type represents a statistical concept**, and towers display real-time performance statistics (mean damage, standard deviation of hit rate, confidence interval for DPS). Students make upgrade decisions based on statistical reasoning. Enemies are generated from the student's weakest skills across all 5 apps — a student weak in probability faces "Probability Golem" enemies that require answering probability questions to defeat. **The game becomes a diagnostic tool**: since it requires synthesizing multiple skills under time pressure, game performance reveals integration weaknesses that isolated app usage misses.

### The metacognitive dashboard that actually works

Learning analytics dashboard research (Chen et al., 2020, 2021) identifies **4 essential elements**: appropriate visualizations, comparison functions, goal-monitoring, and consistent feedback. A randomized controlled study showed that dashboards displaying performance alongside slightly-better-performing peers with similar goals "successfully promotes extrinsic motivation and leads to higher academic achievement." The key word is *slightly* — showing top performers discourages; showing near-peers motivates.

The cross-app data enables a "**Metacognitive Pulse**" — brief post-session reflections like "You spent 45s on Q3 (average is 20s). Your calculator trainer shows you nail this formula. What made the quiz harder?" This bridges the gap between awareness and regulation, the two components of metacognition that predict academic success.

---

## Conclusion: what compounds and what doesn't

The architecture of The Desk reduces to three load-bearing decisions that compound, and several tempting rabbit holes that don't.

**What compounds**: unified auth (every feature benefits), the shared telemetry table (every creative feature depends on cross-app data), and the Web Component nav (every app looks unified). These three investments — roughly 3–4 weeks of work — create the foundation that makes everything else possible. The cross-app SRS engine and skill mastery table are the fourth high-leverage investment, enabling interleaving, weakness detection, and personalized review generation.

**What doesn't compound**: monorepo migration (weeks of restructuring with zero user-visible benefit), sophisticated sync infrastructure (overkill for append-only logs from 60 students), and framework adoption (vanilla JS works, and 4.5 months is not the time to learn React). The strongest move is the one that feels counterintuitive: **keep the apps mostly as they are**, federate them behind shared scripts and a shared data layer, and spend the saved time building the cross-app features that no individual app can offer. The platform's value isn't in the code architecture — it's in the data connections between five windows into the same student's learning.
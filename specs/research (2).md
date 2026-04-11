# The Desk Platform Deep Research Report

## Keystroke-level analytics for calculator fluency

**Key findings (actionable)**

- **“Process data” (timestamped interaction traces) is already a mainstream evidence source in computer-based assessment research**, especially through log-file analyses that move beyond correct/incorrect to infer *strategy*, *exploration vs. execution*, and *problem-solving pathways* (including sequence variants and clusters). This has been done at scale in OECD PISA computer-based tasks (e.g., “Climate Control”), using event logs to distinguish behavioral patterns. citeturn23search5turn23search2turn23search25turn23search17  
- **A strong, practical precedent for “procedure efficiency” measurement comes from Intelligent Tutoring Systems (ITS)**: systems log step-by-step actions (attempts, errors, hint usage) and use those traces to estimate learning/knowledge and even predict external outcomes (e.g., state test performance). “Assistance required” (hints/attempts) has been shown to add predictive value beyond correctness alone in tutoring contexts. citeturn24search2turn24search6turn24search18  
- **Timing and micro-behavior features have published predictive value**: “first response time” (time-to-first-action) has been explicitly incorporated into knowledge-tracing models and shown to improve prediction vs. correctness-only tracing; help-seeking behaviors include productive vs. unproductive patterns (e.g., hint abuse), and “gaming the system” detection work explicitly leverages interaction logs to flag non-learning behaviors. citeturn24search7turn24search13turn24search0  
- **You can ground “calculator fluency” in a formal HCI efficiency baseline using the Keystroke-Level Model (KLM)**: KLM was designed to estimate expert task completion time from a task’s atomic operators (keystrokes, pointing, mental preparation), offering a principled way to define “expert expected time” and compare students’ observed timelines and action counts against a reference method. This maps unusually well to TI-84 procedures because they are discrete, scripted sequences. citeturn23search0turn23search4  
- **Data storage at scale is typically framed as event logs (“case/trace of events”)**: process mining treats each attempt/session as a “case,” each action as an event with timestamp plus attributes. In a entity["company","Supabase","hosted postgres platform"] + Postgres setup, time-based partitioning and scheduled aggregation jobs are well-aligned to this pattern. citeturn9search26turn25search2turn25search4  

**Specific resources (papers, precedents, documentation)**

Core precedents you can directly pattern-match to “calculator keystrokes as procedure traces” include: PISA log-file analysis work (for strategy inference at scale), ITS help-seeking and “assistance required” metrics (for predicting mastery beyond correctness), and KLM (for defining an expert efficiency baseline). citeturn23search5turn24search2turn23search0  

```text
Keystroke-Level Model (KLM) baseline
- https://dl.acm.org/doi/10.1145/358886.358895
- https://iiif.library.cmu.edu/file/Newell_box00072_fld05094_doc0001/Newell_box00072_fld05094_doc0001.pdf

Log-file / process data in assessments (PISA & beyond)
- https://www.sciencedirect.com/science/article/abs/pii/S0360131515300671
- https://www.sciencedirect.com/science/article/abs/pii/S0360131525001666
- https://link.springer.com/article/10.1007/s11165-023-10134-5
- https://onlinelibrary.wiley.com/doi/full/10.1002/tea.21657

ITS step-by-step efficiency / assistance metrics / help-seeking
- https://pact.cs.cmu.edu/pubs/Feng%2C%20Heffernan%20Koedinger%202006.pdf
- https://web.cs.wpi.edu/~mfeng/pub/USER562.pdf
- https://www.cs.cmu.edu/~aleven/Papers/2004/Aleven_ea_ITS2004_HelpSeeking.pdf
- https://pact.cs.cmu.edu/koedinger/pubs/Baker%2C%20R.%2C%20Walonoski%2C%20J.A.%2C%20Heffernan%2C%20N.T.%2C%20Roll%2C%20I.%20Corbett%2C%20A.%2C%20Koedinger%2C%20K.R..pdf
- https://educationaldatamining.org/EDM2012/uploads/procs/Short_Papers/edm2012_short_13.pdf

Event-log framing (definitions useful for schema design)
- https://www.processmining.org/event-data.html
```

**Risks and gotchas for your stack and scale (~60 students, school Wi‑Fi, single teacher-dev)**

- **Over-instrumentation risk**: logging every keystroke “live” to the backend can create avoidable network chatter and “death by a thousand inserts.” Process-data literature typically logs *events*, but that doesn’t imply “flush on every keypress”; you can batch per attempt/session. citeturn23search5turn13search0  
- **Misinterpreting “efficiency” as “understanding”**: ITS research repeatedly shows that students can optimize for the system (e.g., hint abuse, systematic guessing) rather than learning; your keystroke diffs must explicitly model “productive vs. unproductive” behaviors, not just speed. citeturn24search13turn24search0  
- **Multiple valid solution paths**: TI-84 procedures often have legitimate alternative sequences (different menus, shortcuts, prior window state). A single “optimal” path can unfairly penalize students unless you represent equivalence classes (or do “edit distance to any valid path”). This is exactly the kind of ambiguity process-mining work warns about when clustering trace variants. citeturn23search2turn23search13  
- **Privacy re-identification**: even “Fruit_Animal” pseudonyms are still education data if you can map them to real students; and granular traces can be sensitive because they can reveal struggling patterns. Federal guidance emphasizes minimization and careful handling of student PII and de-identification is non-trivial. citeturn10search6turn10search3turn10search7  
- **COPPA edge case**: high-school populations are usually 14–18, but if you have any under-13 students (rare but possible), COPPA obligations can become relevant for “online personal information” collection. citeturn10search1turn10search17  

**Recommended approach under your constraints (most “bang for buck”)**

Your integration spec implies you’re unifying multiple already-deployed apps and want a common student platform while keeping current deployments running. fileciteturn0file0  
A pragmatic analytics architecture that matches both the research precedents and your infrastructure:

1. **Log at the “attempt/session” granularity, not the “keypress streaming” granularity.**  
   Buffer keystrokes locally (in-memory, and optionally IndexedDB as a resilience layer), then emit a single “procedure_attempt_completed” payload containing:
   - canonical procedure id (e.g., `t_test_2sample`), start/end timestamps, correctness (your existing validator), and *compressed trace* (see next step)  
   This aligns with event-log “case/trace” modeling and avoids Wi‑Fi flakiness degrading UX. citeturn9search26turn23search5turn13search0  

2. **Store raw traces compactly + precompute the metrics you actually chart.**  
   Instead of “one row per keypress,” store:
   - `trace_keys`: small-int array or base64 string of key codes  
   - `trace_dt_ms`: delta-time array (varint-like) or coarse bucketed timings  
   - `derived_metrics`: JSON (edit distance to each valid path, backtrack count, “hesitation events,” time-to-first-action, etc.)  
   This keeps analysis queries fast and reduces database amplification. The metric choices are directly motivated by ITS findings (assistance required, help-seeking patterns, timing features). citeturn24search7turn24search2turn24search13  

3. **Define an “expert baseline” per procedure with KLM-inspired timing targets.**  
   You do not need to implement full GOMS modeling; you can adopt KLM’s core idea (“task time = sum of operators”), then compare:
   - student time vs. baseline (normalized)  
   - extra operator count (extra keys) vs. baseline  
   - backtrack density  
   This gives you a defensible “fluency” construct vs. arbitrary speed scoring. citeturn23search0turn23search4  

4. **Adopt a privacy-first policy: minimize, separate identifiers, and set retention.**  
   Use documented de-identification concepts and school-oriented best practices: store only what you need, avoid IP capture unless necessary, and define retention windows (e.g., raw traces retained X weeks; aggregates retained longer). citeturn10search6turn10search3turn10search7  

## Automating LMS gradebook entry in Schoology

**Key findings (actionable)**

- **Before expanding entity["organization","Puppeteer","headless browser automation"] / entity["organization","Chrome DevTools Protocol","browser automation protocol"] automation, verify whether you can push grades via Schoology’s REST API**: Schoology documents grade-related endpoints (including grade objects and user grades) and supports reading/writing through API operations across many objects. This is structurally more stable than DOM automation. citeturn2view1turn26search0turn26search24  
- **Schoology now documents explicit rate limiting for *both* API and web UI traffic using a “request credits” model** (important if you’re currently CDP-posting materials and want to add grade entry): defaults include 50 credits for the public API and 15 credits for web requests, refilled every 5 seconds; POST/PUT/DELETE cost more credits; overages return HTTP 429 with Retry-After. citeturn26search3  
- **There was a major API authentication policy change effective June 25, 2025**: Schoology states that “Personal API keys cannot access other user data,” and integrations using personal keys will receive 401 errors; this pushes you toward proper app registration/App Center patterns for multi-student grade operations. citeturn26search15  
- **LTI 1.3 is the long-term “standards-correct” way to do grade passback**, using entity["organization","LTI 1.3","1edtech lti core spec"] plus Assignment & Grade Services (AGS) to create gradebook columns (line items) and post scores. AGS is explicitly designed to extend tool ↔ platform gradebook interaction beyond older “basic outcomes” patterns. citeturn27search0turn27search1turn27search7  
- **Schoology itself documents a key limitation of “External Tool” items: it cannot automatically detect submissions from external tools** (and does not generate the same submission/reminder notifications). That means if “The Desk” lives as an external tool, you should expect to rely on AGS grade passback (or explicit workflows) rather than hoping Schoology notices completions on its own. citeturn27search21  

**Specific resources (papers, repos, official docs)**

The highest-leverage set of docs for this topic are: (1) Schoology REST API docs + authentication policy update, (2) PowerSchool Engagement docs documenting rate limits and CSV import/export, and (3) 1EdTech’s LTI 1.3 + AGS specs (for a standards-track integration). citeturn26search27turn26search15turn26search3turn27search0turn27search1turn27search12  

```text
Schoology REST API docs (grades/auth)
- https://developers.schoology.com/api-documentation/rest-api-v1/
- https://developers.schoology.com/api-documentation/authentication/
- https://developers.schoology.com/api-documentation/rest-api-v1/grade/
- https://developers.schoology.com/api-documentation/rest-api-v1/user-grades/
- https://developers.schoology.com/api-documentation/important-api-authentication-update/

Schoology rate limits (PowerSchool Engagement docs)
- https://uc.powerschool-docs.com/en/schoology/latest/system-requirements

CSV gradebook export/import workflows (PowerSchool Engagement docs)
- https://uc.powerschool-docs.com/en/schoology/latest/moving-student-grades-from-one-section-to-another

LTI 1.3 + AGS (standards)
- https://www.imsglobal.org/spec/lti/v1p3
- https://www.imsglobal.org/spec/lti-ags/v2p0
- https://www.1edtech.org/standards/lti
- https://www.imsglobal.org/lti-advantage-overview
- https://www.imsglobal.org/spec/lti/v1p3/migr

Schoology LTI integration guide (PDF)
- https://www.imsglobal.org/sites/default/files/lti/SchoologyLTIIntegrationGuide.pdf

SIS passback via OneRoster (district-level pattern)
- https://uc.powerschool-docs.com/en/schoology/latest/sis-integrations-with-oneroster
- https://www.imsglobal.org/oneroster-v11-final-specification
```

**Risks and gotchas specific to your current approach (CDP + classroom scale)**

- **UI automation is now explicitly rate-limited (“web request credits”) separately from API calls**, which means a CDP-based grade push can trip a different limiter than API-based calls; robust retries and backoff are not optional. citeturn26search3  
- **Authentication drift and key policy drift**: the June 25, 2025 personal-key restriction creates a failure mode where scripts that “used to work” start returning 401 when you attempt multi-student operations. citeturn26search15  
- **LTI external-tool materials won’t inherently behave like native assignments**: Schoology warns it can’t automatically detect submissions for external tools, which can surprise teachers expecting “normal” submission workflows. citeturn27search21  
- **True SIS grade passback is typically a district integration surface, not a teacher script surface**: SIS Connect is described as syncing roster and passing grades back to the SIS via OneRoster, which generally implies administrative configuration and vendor cooperation. citeturn26search29turn26search13  

**Recommended approach under your constraints (solo dev, keep current deployments live)**

1. **Prefer REST API grade writes over DOM writes whenever possible.**  
   Build a small “grade sync” service that:
   - maps your internal assignment ids → Schoology assignment/grade identifiers  
   - writes grades via REST API endpoints  
   - implements a credit-aware scheduler (see next step)  
   This aligns with Schoology’s documented API surfaces and avoids brittle selectors. citeturn26search0turn26search27turn26search3  

2. **Implement a rate-limit-aware work queue sized to your classroom reality.**  
   With ~60 students × ~20 columns, even “full resync” is manageable—but you should still treat rate limiting as real:
   - cap concurrency (e.g., 1–2 in-flight writes)  
   - treat POST/PUT/DELETE as higher cost (3 credits per doc)  
   - parse 429 + Retry-After and sleep exactly as instructed  
   citeturn26search3  

3. **Keep CSV import as a “dead simple escape hatch.”**  
   Schoology documents gradebook export/import via CSV from the gradebook UI; this is useful for emergency recovery or “end-of-term bulk push,” even if your primary path is API-based. citeturn27search12  

4. **Treat LTI 1.3 + AGS as a second-phase integration (not a summer must-have) unless your district already supports it cleanly.**  
   LTI 1.3 exists specifically to integrate tools into LMSs with modern security and optional grade services (AGS). If you later turn “The Desk” into an LTI tool, AGS is the standards route for grade passback. citeturn27search0turn27search1turn27search7  

## Embedding a TI-84-style calculator widget inside assessments

**Key findings (actionable)**

- **The dominant “embed calculator next to questions” pattern in major platforms is either a first-class embedded tool or a strongly sandboxed embed**: entity["organization","Desmos","graphing calculator platform"] provides an embed API intended for products to integrate calculators in-page; entity["organization","GeoGebra","math app platform"] explicitly supports iframe embedding and a JavaScript API for interaction/listeners. citeturn8search32turn8search29turn8search37  
- **College Board’s “Bluebook” model (as described in third-party analysis) uses an integrated Desmos calculator in the testing app**, signaling that “calculator-in-context” is an accepted modern assessment UX—but note that Bluebook is an app environment, not a normal webpage. citeturn8search27  
- **If you want “guided calculator” UX, ITS literature strongly supports scaffolding + gradual fading**: the “assistance dilemma” framing and worked-example/fading research suggests you should design explicit “practice mode” scaffolds and then fade/disable them in assessment mode to avoid conflating help with mastery. citeturn9search3turn9search24turn9search20  
- **Mobile UX precedent: calculators are often presented as a resizable side panel on desktop and a slide-up drawer/modal on small screens** (because persistent split-pane on phones is cramped). Your tool can copy this ergonomic pattern while still collecting keystroke telemetry in the background (batched). citeturn8search32turn8search29  
- **Your best technical compatibility pattern is “calculator as a reusable component with a strict interface,” ideally isolated**: the embed precedents above and cross-context messaging standards (postMessage) make it straightforward to treat your calculator as a widget that can live in quizzes, worksheets, and the hub without app-specific rewrite. citeturn12search0turn12search32  

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["Desmos graphing calculator embedded in website example","GeoGebra applet embedded iframe example","TI-84 emulator web interface example","College Board Bluebook Desmos calculator screenshot"],"num_per_query":1}

**Specific resources (docs and real-world examples)**

The most implementation-relevant docs here are Desmos’ official API entry point and GeoGebra’s embedding/JS API references; these give concrete parameters and event hooks you can mirror for your TI-84 widget interface. citeturn8search32turn8search29turn8search37  

```text
Desmos embedding
- https://www.desmos.com/my-api

GeoGebra embedding + JS API examples
- https://www.geogebra.org/m/vuyvwvxw
- https://wiki.geogebra.org/en/Reference:Material_Embedding_(Iframe)
- https://geogebra.github.io/integration/example-api-sync.html

Bluebook/Desmos mention (context for “calculator inside test app” UX)
- https://www.applerouth.com/blog/key-features-of-college-boards-bluebook-app

Instructional design (scaffolding/fading)
- https://www.researchgate.net/publication/226963584_Exploring_the_Assistance_Dilemma_in_Experiments_with_Cognitive_Tutors
- https://cogscisci.wordpress.com/wp-content/uploads/2019/08/sweller-guidance-fading.pdf
```

**Risks and gotchas for your stack**

- **Mode confusion risk**: if the same widget supports “step-by-step guidance” and “assessment,” students will assume hints exist in tests unless the UI makes mode boundaries unmistakable. The assistance dilemma literature is explicit that guidance can improve outcomes but can also distort what you’re measuring if not managed. citeturn9search3turn9search20  
- **Embedding complexity across heterogeneous apps**: since you have Vite apps and plain static apps, the widget must ship in a format those environments can load consistently (an ES module build + a UMD/IIFE fallback is common). This is directly addressed by Vite “library mode.” citeturn22search0turn22search3  
- **Keyboard focus & event capture collisions**: calculators want to capture keystrokes; quizzes want typing; you’ll need a deliberate focus model (click-to-focus on calculator, ESC to return). (This is a design gotcha more than a “research citation” issue, but it’s consistently where embedded tools break in practice.)  

**Recommended approach (summer 2026 build, minimal rework across apps)**

1. **Ship the TI-84 emulator as a standalone “calculator iframe” plus an optional “lite renderer.”**  
   - Iframe gives you isolation (CSS, focus handling, and crash containment).  
   - The parent app communicates via a minimal message protocol (“key pressed,” “screen buffer changed,” “attempt started/ended”).  
   This mirrors the embed mental model of Desmos/GeoGebra while keeping your core emulator reusable. citeturn8search32turn8search29turn12search0  

2. **Two explicit modes from day one**:  
   - **Practice mode**: overlays guided steps; allows hints; logs help usage.  
   - **Assessment mode**: no hints; still logs keystrokes/timing.  
   Then you can fade guidance over time (worked-example fading) without creating a new tool. citeturn9search24turn9search20  

3. **Design responsive UX intentionally**:  
   - Desktop: split-pane with draggable divider (question left, calculator right).  
   - Mobile: bottom-sheet calculator that can snap between 40% and 90% height.  
   This is consistent with “calculator as an auxiliary tool” embed patterns and avoids unusable tiny panes on phones. citeturn8search32turn8search29  

## Unified telemetry across multiple web apps and iframes

**Key findings (actionable)**

- **Cross-iframe, cross-origin event collection should use `window.postMessage` with explicit origin checking**: MDN documents postMessage as the safe way to communicate between windows/iframes, and the HTML spec emphasizes that messages can be discarded if target origin doesn’t match (and that `*` should be used cautiously). citeturn12search0turn12search32  
- **For same-origin multi-context messaging (tabs/iframes/workers), BroadcastChannel is a simple event bus**: MDN describes BroadcastChannel as enabling communication across browsing contexts of the same origin. citeturn12search29turn12search5  
- **Learning analytics standards already provide event vocabularies you can borrow**:  
  - entity["organization","Caliper Analytics","1edtech learning analytics standard"] models events with actor/action/object and a “Sensor” concept for emitting events from tools. citeturn11search1turn11search9turn11search5  
  - entity["organization","xAPI","experience api standard"] models a “Statement” with Actor/Verb/Object plus Result/Context and is explicitly intended to track learning beyond formal systems. citeturn11search12turn11search8  
- **Supabase-specific constraints and features matter**: Row Level Security policies are attached SQL rules at the table level, and Supabase Auth/JWTs are foundational to enforcing RLS. Realtime “Postgres Changes” requires replication/publication configuration for tables you want to subscribe to. citeturn11search2turn11search6turn11search3  
- **Offline-first telemetry batching is a solved web pattern**: Workbox documents a Background Sync Queue that stores failed requests in IndexedDB and retries when connectivity returns; MDN documents the Background Synchronization API as deferring server sync via a service worker when offline. citeturn13search0turn13search1  

**Specific resources (standards + concrete implementation docs)**

The best “future-proof” decision you can make is to choose an internal event schema that is *compatible in spirit* with Caliper/xAPI (actor/action/object, timestamps, context), even if you don’t fully conform on day one. This keeps the door open for later LMS analytics integrations. citeturn11search1turn11search12turn11search5turn11search16  

```text
Cross-context messaging (browser primitives)
- https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- https://html.spec.whatwg.org/multipage/web-messaging.html
- https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

Learning analytics standards
- https://www.imsglobal.org/spec/caliper/v1p2
- https://www.imsglobal.org/spec/caliper/v1p2/impl
- https://github.com/1EdTech/caliper-spec
- https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Communication.md
- https://adlnet.github.io/xapi-profiles/xapi-profiles-structure.html

Supabase implementation surfaces
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/jwts
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/database/partitions

Offline queueing & retry
- https://developer.chrome.com/docs/workbox/modules/workbox-background-sync
- https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
```

**Risks and gotchas for your stack**

- **Realtime does not scale if you subscribe to “everything”**: you’ll want realtime on *aggregated* or *scoped* tables rather than raw keystroke traces; Supabase’s “Postgres Changes” model is powerful but should be enabled selectively. citeturn11search3turn11search15  
- **`postMessage` security pitfalls**: failing to validate `event.origin` and failing to specify strict target origins are well-known footguns; MDN’s guidance exists because this is routinely exploited. citeturn12search0turn12search4turn12search32  
- **Background Sync support is uneven**: MDN describes it, but the API is explicitly flagged and you should confirm real device support in your Chromebook/iPad mix; Workbox’s queue pattern helps but still depends on service worker lifecycle reliability. citeturn13search1turn13search31turn13search0  

**Recommended approach (unified telemetry without rewriting all five apps)**

1. **Create a single telemetry client package with a strict “track() contract.”**  
   - Emits events in an actor/action/object-like shape (Caliper/xAPI-inspired) even if stored in your own schema. citeturn11search1turn11search12  

2. **Use a narrow “events” table + JSON payload + time partitioning.**  
   - Narrow table fits event-log theory (case + activity + timestamp + attributes). citeturn9search26turn25search2  

3. **Batch and debounce**:  
   - Flush every N events or every T seconds, plus “flush on visibilitychange/unload.”  
   - For unreliable Wi‑Fi, pair with Workbox Background Sync Queue for “store-and-forward.” citeturn13search0turn13search1  

4. **Daily aggregation via Supabase Cron**:  
   - Build rollups that drive dashboards (per-student mastery, per-procedure fluency, per-module engagement) using scheduled jobs inside Postgres. citeturn25search4turn25search1  

## DeepSeek as the grading backbone

**Key findings (actionable)**

- **As of April 11, 2026, DeepSeek’s official API documentation describes an OpenAI-compatible API surface** (same SDK concept, configurable `base_url`), which is excellent for “provider routing” and fallback architectures. citeturn15view1turn15view2  
- **Officially documented API model IDs are `deepseek-chat` and `deepseek-reasoner`, mapped to DeepSeek‑V3.2** with a 128K context length; pricing is published per 1M tokens with context caching (“cache hit” vs. “cache miss”) and tool calling support. citeturn15view0turn15view2  
- **DeepSeek’s own docs state they do not constrain user rate limits**, but do warn about high-traffic behavior, keep-alives, and a server-side cutoff if inference hasn’t started after 10 minutes—this matters for classroom “submit many FRQs at once” spikes and should drive queue design + student-visible status messaging. citeturn18view0  
- **DeepSeek V4 appears “not yet stabilized as an API surface” in official docs**, even though reporting indicates DeepSeek is preparing to launch V4 in the coming weeks; your architecture should assume V4 availability can change and should not hard-code a single model id path. citeturn16news31turn17view2  
- **Evidence about LLM grading reliability strongly supports keeping “human-in-the-loop” oversight**: a large comparative study of LLMs in automated grading of programming submissions included DeepSeek models (`deepseek-chat`, `deepseek-reasoner`) and found systematic model-to-model differences and only moderate agreement with human teacher grades; short-answer grading research with other frontier models similarly emphasizes prompt/rubric specificity and ongoing evaluation. citeturn19view0turn20search1turn20search3  

**Specific resources (official docs + benchmarks/case studies)**

For “what DeepSeek supports in production” you should treat DeepSeek’s API docs and model list endpoint as the source of truth; for “grading quality,” the most relevant available peer-reviewed/academic evidence today is cross-model grading studies and rubric scoring research, even when not DeepSeek-specific. citeturn17view2turn15view0turn19view0turn20search3  

```text
DeepSeek official API docs (compatibility, models, pricing, tool calls)
- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/api/list-models
- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/quick_start/rate_limit
- https://api-docs.deepseek.com/guides/tool_calls
- https://status.deepseek.com/

DeepSeek V4 status signal (news reporting)
- (Reuters report) https://www.reuters.com/world/china/deepseeks-v4-model-will-run-huawei-chips-information-reports-2026-04-03/

LLM grading research (includes DeepSeek models for grading)
- https://arxiv.org/html/2509.26483v1

Short-answer grading precedents (rubric/prompt sensitivity, reliability concerns)
- https://ojs.aaai.org/index.php/AAAI/article/view/30364
- https://link.springer.com/article/10.1186/s12909-024-06026-5
```

**Risks and gotchas for your grading pipeline**

- **Model availability mismatch**: your stated plan to move to “DeepSeek v4” conflicts with what the official API model list currently returns; you need a routing layer that can shift between `deepseek-reasoner`, `deepseek-chat`, and any future V4 id without rewriting your apps. citeturn17view2turn15view0  
- **Spike traffic & long waits**: DeepSeek documents “no rate limit” but also documents long-held connections and a 10-minute cutoff before inference starts under load; that implies you should grade asynchronously and show “queued / grading / done” states in the UI. citeturn18view0  
- **Rubric grading reliability**: even in domains where LLM grading is promising, research repeatedly shows non-trivial gaps vs. human assessment and differences in strictness; this argues for periodic calibration sets and teacher override flows. citeturn19view0turn20search3  
- **Security/privacy**: student responses are education records in most school contexts; vendor docs and federal guidance emphasize minimizing disclosure and controlling access. If you send student work to a third-party model API, you need to account for district policy and data governance expectations. citeturn10search6turn10search0  

**Recommended approach (robust, low-maintenance, “solo dev friendly”)**

1. **Implement a “grading gateway” service with an OpenAI-compatible interface and provider routing.**  
   Since DeepSeek is OpenAI-compatible, you can keep the rest of your platform stable and only swap `base_url`/model ids in the gateway. citeturn15view1  

2. **Default to `deepseek-reasoner` for FRQ grading, fall back to `deepseek-chat` for fast feedback, and keep a second provider hot.**  
   The Jukiewicz et al. cross-model grading study suggests “grader personality” differences across models; you can exploit that by routing: “reasoner” for high-stakes rubrics, “chat” for formative feedback drafts. citeturn19view0turn15view0  

3. **Use context caching strategically.**  
   Keep rubric + exemplars as a stable prefix across requests to maximize cached input pricing (DeepSeek explicitly prices cache hits vs misses). citeturn15view0  

4. **Operational hardening**: circuit breakers + status page integration.  
   If the status page indicates degraded API service, your gateway should automatically shift to the fallback provider and mark results as “graded by fallback model.” citeturn17view1  

## Monorepo patterns for a multi-app educational platform

**Key findings (actionable)**

- **entity["organization","pnpm","javascript package manager"] workspaces are built-in and require a `pnpm-workspace.yaml` file**, making them a clean baseline for consolidating multiple apps and shared packages without forcing a heavier framework. citeturn21search0  
- **entity["organization","Turborepo","js build system"] is tightly integrated with entity["company","Vercel","web hosting platform"] monorepo deployments and emphasizes caching/remote cache**—useful when you have multiple frontend builds and shared packages. citeturn21search1turn21search5  
- **entity["organization","Nx","monorepo build system"] provides “project graph” and “affected” execution**, which can be extremely powerful if you later grow beyond a solo workflow; it’s optional overhead up front, but it’s the most feature-rich for complex monorepos. citeturn21search2turn21search6  
- **For sharing code between a Vite app and vanilla/static apps, Vite “library mode” is the most direct tool**: it explicitly supports building browser-oriented libraries rather than only full apps, enabling you to ship your TI-84 widget + telemetry client as consumable bundles. citeturn22search0turn22search3  
- **Educational platform precedent is partial but informative**: entity["organization","Khan Academy","education nonprofit"] openly publishes key interactive components like Perseus, but not necessarily the entire monolith; this suggests a pragmatic direction: open/shared libraries + internal platform glue. citeturn21search15turn21search11  

**Specific resources (docs that matter in practice)**

```text
pnpm workspaces and deployment
- https://pnpm.io/workspaces
- https://pnpm.io/cli/deploy

Turborepo + Vercel monorepo support
- https://vercel.com/docs/monorepos/turborepo
- https://turborepo.dev/docs/crafting-your-repository/caching
- https://turborepo.dev/docs/crafting-your-repository/constructing-ci

Nx project graph / affected builds
- https://nx.dev/docs/features/explore-graph
- https://nx.dev/docs/features/ci-features/affected

Vite library mode (for widget packages)
- https://vite.dev/guide/build
- https://vite.dev/config/build-options

Khan Academy open source components (example of “library-first” openness)
- https://khan.github.io/
```

**Risks and gotchas given your current portfolio (Vite + vanilla + single-file games, multiple hosts like entity["company","GitHub Pages","static hosting by github"] and entity["company","Railway","app hosting platform"])**

- **Monorepo-deploy friction**: you may want to keep some apps on GitHub Pages and others on Railway; monorepo helps shared code, but you must design builds so each app can still deploy independently (and keep current live deployments stable during the school year). citeturn21search1turn21search28  
- **Bundling mismatch**: vanilla apps pulling in modern ESM dependencies (especially entity["organization","Three.js","javascript 3d library"] ecosystems) can hit import-map quirks if you try to “no-bundler” your way through; the Three.js community explicitly recommends consistent module resolution and often a bundler for sanity. citeturn22search30turn22search6  

**Recommended approach (fits your timeline and minimizes rewrites)**

1. **Start with pnpm workspaces + Turborepo (skip Nx initially).**  
   - pnpm gives you the monorepo dependency wiring with minimal ceremony. citeturn21search0  
   - Turborepo + Vercel gives you straightforward caching and multi-app pipelines. citeturn21search1turn21search5  

2. **Split code into “apps” vs “packages” immediately.**  
   - `packages/ti84-widget` (built via Vite library mode; ships ESM + UMD) citeturn22search3  
   - `packages/telemetry-client` (same)  
   - `packages/grading-client` (thin wrapper around your grading gateway)  
   - `apps/portal-hub`, `apps/quiz`, `apps/driller`, etc., each deployable on its current hosting target

3. **Keep existing deployments live by treating the monorepo as “the next version,” not a forced migration.**  
   - You can publish versioned widget bundles and incrementally adopt them in the legacy apps first, then migrate the full apps into the monorepo once stable near late summer 2026.

4. **Use Vite library mode to avoid rewriting vanilla apps into Vite-only apps.**  
   - This is the shortest path to “shared widget library” + “shared telemetry client” across heterogeneous frontends. citeturn22search0turn22search3
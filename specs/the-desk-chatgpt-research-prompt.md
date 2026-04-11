# ChatGPT Deep Research Prompt — The Desk Platform

Use this with ChatGPT Deep Research mode. Goal: gather real-world precedent, technical patterns, and gotchas before we commit to an architecture.

---

## Prompt

I'm a high school AP Statistics teacher building a unified student platform called "The Desk." I need you to research several interconnected topics deeply. For each, I want real examples, technical specifics, and known pitfalls — not generic advice.

### Context

I have 5 existing repos that I'm integrating:
- **A real-time quiz app** (vanilla JS, Express, Supabase, WebSocket) where students see peer answer distributions and get AI-graded FRQ responses
- **A drill/cartridge platform** (Vite, Tailwind, Three.js, Supabase) with 23 lesson modules, dual AI grading, SRS, and game mechanics
- **30+ interactive live worksheets** for video follow-alongs with AI-graded reflections
- **A TI-84 Plus CE calculator trainer** with real CEmu WASM emulation and a native JS state machine (~4,400 LOC) that validates keystrokes against 27 statistical procedures (t-tests, chi-square, regression, etc.)
- **A formula defense game** (Three.js tower-defense with SRS)

All are deployed (Vercel, GitHub Pages, Railway). Students authenticate via Fruit_Animal usernames (e.g., "Grape_Otter") against Supabase.

### Research Topics

**1. Keystroke-level analytics in educational software**

Research how keystroke logging and path analysis is used in educational contexts. Specifically:
- Are there existing frameworks or research papers on measuring "calculator fluency" or "procedural efficiency" via keystroke diffs?
- How do systems like cognitive tutors (Carnegie Learning, ALEKS, ASSISTments) measure step-by-step problem-solving efficiency?
- What metrics beyond "correct/incorrect" have been shown to predict student understanding? (time-to-first-action, backtrack rate, hesitation patterns, help-seeking behavior)
- How is keystroke data typically stored and analyzed at scale? Schema patterns, compression, aggregation windows.
- Privacy considerations for storing granular student interaction data (FERPA, COPPA, school district policies).

**2. Puppeteer/CDP automation for LMS gradebook entry**

I already use Puppeteer (via Chrome DevTools Protocol) to automate posting lesson materials to Schoology. I want to extend this to push computed grades into the Schoology gradebook.
- Has anyone documented automating Schoology gradebook entry via Puppeteer or CDP? Blog posts, GitHub repos, scripts?
- What are the Schoology gradebook DOM patterns? (assignment columns, grade cells, save triggers)
- Does Schoology have an official Gradebook API (REST) that could avoid CDP altogether? What are its limitations?
- What about the Schoology PowerSchool SIS integration — can grades flow through an API rather than browser automation?
- Rate limiting, session management, and failure recovery patterns for CDP-based LMS automation at the classroom scale (~60 students, ~20 assignment columns).
- Alternative LMS integration patterns: LTI 1.3 tool provider, Schoology app registration, CSV grade import.

**3. Embedding interactive calculator widgets in web-based assessments**

I have a TI-84 emulator (CEmu WASM) and a native JS state machine that can validate keystroke sequences. I want to embed a calculator widget inline with quiz questions.
- How do existing online math assessment platforms (Desmos, GeoGebra, NumWorks) embed calculator tools alongside questions?
- Are there examples of "guided calculator" UX where students are walked through a procedure step-by-step within an assessment context?
- How do AP exam digital testing platforms (College Board's Bluebook) handle calculator integration?
- UX patterns for side-by-side question + calculator layouts on mobile (responsive, touch-friendly)
- How do platforms handle the tension between "guided practice" and "assessment" modes for the same tool?

**4. Unified telemetry across multiple web apps**

I have 5 apps that need to log events to a single Supabase event store.
- What are the best patterns for cross-iframe event collection? (postMessage, shared service worker, parent frame event bus)
- Schema design for high-volume educational telemetry: wide table vs. narrow event table vs. event sourcing
- Supabase-specific: Row-level security for student data, realtime subscriptions for live dashboards, pg_cron for daily aggregation
- How do xAPI (Tin Can) and Caliper analytics standards model learning events? Could conforming to these standards help with future LMS integration?
- Batching, debouncing, and offline-first patterns for telemetry in unreliable school WiFi environments

**5. DeepSeek API as a grading backbone**

I'm consolidating from Groq (llama-3.3-70b) + Google Gemini to DeepSeek v4 for all AI grading.
- DeepSeek v4 capabilities: what's known about its reasoning quality vs. GPT-4o, Claude, Llama 3.3 for rubric-based grading?
- DeepSeek API specifics: rate limits, pricing, context window, function calling support, OpenAI API compatibility level
- Has anyone published benchmarks or case studies using DeepSeek for educational assessment / rubric grading?
- Fallback strategies: if DeepSeek is down or rate-limited, should I keep Groq as a fallback, or is there a better pattern?

**6. Monorepo patterns for multi-app educational platforms**

I'm creating a new repo that houses: a portal/hub, a reusable widget library (TI-84), a telemetry client, a grading client, and a metrics pipeline.
- What monorepo tools work best for this? (npm workspaces, pnpm, turborepo, nx)
- How do educational platforms like Khan Academy, Brilliant, or Coursera structure their frontend codebases?
- Patterns for sharing code between a Vite app (driller), vanilla HTML apps (quiz, worksheets), and a single-file HTML app (formula game)
- Build/deploy strategies when some apps are static (GitHub Pages) and others need servers (Railway)

### Output Format

For each topic, give me:
1. **Key findings** (3-5 bullet points of the most actionable information)
2. **Specific resources** (links to papers, repos, blog posts, documentation)
3. **Risks and gotchas** specific to my stack and scale (~60 students, school WiFi, Supabase backend)
4. **Recommended approach** given my constraints (solo teacher-developer, building over summer 2026 for SY26-27 launch in late August, existing deployments stay live for current students through end of year)

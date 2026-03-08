# Agent: Shared AI Grading Proxy

## Phase
P5-infrastructure | No dependencies | Working dir: `C:/Users/ColsonR`

## Objective
Extract the shared AI grading logic from curriculum_render and lrsl-driller into a standalone Express service that both apps can call.

## Context: Why Extract

Both apps implement identical 3-tier grading:
1. Keywords/regex (instant)
2. Groq llama-3.3-70b AI (30s timeout)
3. Appeal with framework context (AI can only upgrade)

Duplicating this means bugs fixed in one app may not be fixed in the other. A shared proxy:
- Single source of truth for grading logic
- One place to update Groq model/API key
- Both apps become thinner (just call the proxy)

## Dependency: grading-api-v1 Contract

```
POST /grade
  Request:  { questionId, questionType, studentAnswer, correctAnswer, rubric?, frameworkContext? }
  Response: { score: "E"|"P"|"I", feedback, matched[], missing[], provider, model }

POST /appeal
  Request:  { questionId, studentAnswer, currentScore, reasoning, frameworkContext }
  Response: { score: "E"|"P"|"I" (only upgrade), feedback, upgraded: boolean }

GET /health
  Response: { status: "ok", groqAvailable: boolean, uptime: number }
```

**Invariant:** Appeal score can ONLY be >= currentScore. Enforced server-side.

## Read First (Source Material to Extract From)
1. `curriculum_render/railway-server/server.js` — **1875 lines**. Contains full `GradingQueue` class
   (rate-limited at 25 RPM / 2.5s between requests), MCQ enforcement (wrong MCQ answers capped at P),
   robust JSON extraction (3 fallback strategies: direct parse → smart-quote repair → regex extraction),
   and `/api/ai/grade` + `/api/ai/appeal` endpoints. This is the **primary extraction source**.
2. `curriculum_render/js/grading/grading-engine.js` — client-side keyword grading logic
3. `lrsl-driller/railway-server/server.js` — same endpoints (simpler implementation)
4. `lrsl-driller/platform/core/grading-engine.js` — keyword grading logic
5. `curriculum_render/railway-server/frameworks.js` — AP framework injection

## Owned Paths
- `shared-grading-proxy/` (new directory)

## Implementation Structure

```
shared-grading-proxy/
├── server.js            # Express server with /grade, /appeal, /health
├── grading-queue.js     # EXTRACT from curriculum_render: GradingQueue class
│                        #   - Rate limit: 25 RPM, 2.5s minimum between requests
│                        #   - Token bucket with queue drain loop
│                        #   - Timeout handling (30s per request)
├── keyword-grader.js    # Shared keyword/regex grading (extracted from both apps)
├── ai-grader.js         # Groq API calls via GradingQueue (NOT direct fetch)
│                        #   - Model: groq llama-3.3-70b-versatile
│                        #   - Temperature: 0.1
│                        #   - Robust JSON extraction (3 fallback strategies)
├── mcq-enforcer.js      # MCQ protection: wrong MCQ answers capped at P even if AI says E
├── json-extractor.js    # EXTRACT: 3-strategy JSON extraction from AI responses
│                        #   1. Direct JSON.parse
│                        #   2. Smart-quote repair (curly quotes → straight quotes)
│                        #   3. Regex extraction (find JSON object in prose response)
├── appeal-handler.js    # Appeal logic with upgrade-only invariant
├── framework-context.js # AP framework data injection
├── package.json         # express, groq-sdk (or node-fetch for Groq REST)
├── Dockerfile           # For Railway deployment
├── .env.example         # GROQ_API_KEY, PORT
└── tests/
    ├── grading-queue.test.js    # Rate limit enforcement, queue drain, timeout
    ├── json-extractor.test.js   # All 3 fallback strategies
    ├── mcq-enforcer.test.js     # Wrong MCQ capped at P
    └── grading-proxy.test.js    # Integration tests for all endpoints
```

## Key Implementation Details

### grading-queue.js — Rate-Limited Queue (EXTRACT from server.js)
```javascript
// Extract the GradingQueue class from curriculum_render/railway-server/server.js
// Key parameters to preserve:
class GradingQueue {
  constructor(maxRPM = 25) {
    this.maxRPM = maxRPM;
    this.minInterval = 60000 / maxRPM;  // 2400ms between requests
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
  }

  async enqueue(gradingFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn: gradingFn, resolve, reject });
      this.drain();
    });
  }

  async drain() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const elapsed = Date.now() - this.lastRequestTime;
      if (elapsed < this.minInterval) {
        await new Promise(r => setTimeout(r, this.minInterval - elapsed));
      }
      const { fn, resolve, reject } = this.queue.shift();
      this.lastRequestTime = Date.now();
      try { resolve(await fn()); } catch (e) { reject(e); }
    }
    this.processing = false;
  }
}
```

### json-extractor.js — 3-Strategy Extraction (EXTRACT from server.js)
```javascript
export function extractJSON(raw) {
  // Strategy 1: Direct parse
  try { return JSON.parse(raw); } catch {}

  // Strategy 2: Smart-quote repair (curly quotes from AI responses)
  try {
    const repaired = raw.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    return JSON.parse(repaired);
  } catch {}

  // Strategy 3: Regex extraction (AI wrapped JSON in prose)
  const match = raw.match(/\{[\s\S]*?"score"\s*:\s*"[EPI]"[\s\S]*?\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }

  throw new Error('Failed to extract JSON from AI response');
}
```

### mcq-enforcer.js — MCQ Score Capping
```javascript
// CRITICAL: Wrong MCQ answers are capped at P even if AI returns E
// This prevents AI hallucination from giving full credit for wrong factual answers
export function enforceMCQ(questionType, studentAnswer, correctAnswer, aiScore) {
  if (questionType !== 'mcq') return aiScore;
  if (studentAnswer.trim().toLowerCase() !== correctAnswer.trim().toLowerCase()) {
    return aiScore === 'E' ? 'P' : aiScore;  // Cap at P
  }
  return aiScore;
}
```

### keyword-grader.js
```javascript
export function gradeByKeywords(studentAnswer, correctAnswer, rubric) {
  if (!rubric?.expectedElements) {
    // Simple match
    return studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
      ? { score: 'E', feedback: 'Correct', matched: [correctAnswer], missing: [] }
      : { score: 'I', feedback: 'Incorrect', matched: [], missing: [correctAnswer] };
  }

  // Rubric-based matching
  const matched = rubric.expectedElements.filter(e =>
    new RegExp(e.pattern || e.description, 'i').test(studentAnswer)
  );
  const required = rubric.expectedElements.filter(e => e.required);
  const requiredMatched = matched.filter(e => e.required);

  if (requiredMatched.length === required.length) return { score: 'E', ... };
  if (matched.length > 0) return { score: 'P', ... };
  return { score: 'I', ... };
}
```

### appeal-handler.js — Upgrade-Only Invariant
```javascript
const SCORE_ORDER = { 'I': 0, 'P': 1, 'E': 2 };

export function validateAppealScore(currentScore, proposedScore) {
  // CRITICAL INVARIANT: appeals can only upgrade
  return SCORE_ORDER[proposedScore] >= SCORE_ORDER[currentScore]
    ? proposedScore
    : currentScore;  // Reject downgrade silently
}
```

## Constraints
- The proxy must be a standalone deployable (its own Railway service)
- Must handle Groq API failures gracefully (fall back to keyword score)
- 30s timeout on AI calls (match existing behavior)
- **Rate limiting**: 25 RPM to Groq API via GradingQueue (extract, don't reinvent)
- **MCQ protection**: wrong MCQ answers capped at P even if AI says E
- **JSON extraction**: must handle all 3 failure modes (malformed JSON, smart quotes, prose-wrapped)
- **Model**: groq `llama-3.3-70b-versatile`, temperature 0.1 (match existing)
- CORS enabled for both curriculum_render and lrsl-driller origins
- The existing `GradingQueue` in curriculum_render/server.js is battle-tested in production —
  extract it faithfully rather than reimplementing from scratch

## Verification
```bash
cd shared-grading-proxy && npm install && npm test
# Manual test:
curl -X POST http://localhost:3000/grade \
  -H "Content-Type: application/json" \
  -d '{"questionId":"test","questionType":"frq","studentAnswer":"sampling variability means samples differ","correctAnswer":"variation across samples due to random selection"}'
```

# Agent: Wire Grading Proxy into Curriculum Render

## Phase
P5-infrastructure | Depends on: shared-grading-proxy | Working dir: `C:/Users/ColsonR/curriculum_render`

## Objective
Update curriculum_render to call the shared grading proxy instead of its own inline grading logic.

## Dependencies
- **shared-grading-proxy** must be deployed and accessible

## Context: What Changes

The current `railway-server/server.js` (**1875 lines**) contains substantial grading infrastructure
that was extracted into the shared proxy in P5-01:
- `GradingQueue` class (rate-limited at 25 RPM, token-bucket drain loop)
- MCQ enforcement (wrong answers capped at P)
- 3-strategy JSON extraction (direct parse → smart-quote repair → regex)
- Groq API calls (llama-3.3-70b-versatile, 0.1 temp, 30s timeout)

```
BEFORE:
  Browser → POST /api/ai/grade → server.js → GradingQueue → Groq API
  Browser → POST /api/ai/appeal → server.js → GradingQueue → Groq API

AFTER:
  Browser → POST /api/ai/grade → server.js → shared-grading-proxy/grade
  Browser → POST /api/ai/appeal → server.js → shared-grading-proxy/appeal
```

The Railway server becomes a thin proxy. Client-side code does NOT change (same endpoints).
**The `GradingQueue`, JSON extraction, and MCQ enforcement all move to the shared proxy** —
remove them from server.js to avoid duplication.

## Read First
1. `railway-server/server.js` — **1875 lines**. Find the `GradingQueue` class, `/api/ai/grade` handler,
   `/api/ai/appeal` handler, MCQ enforcement logic, and JSON extraction functions.
   All of these will be REMOVED (they now live in the shared proxy from P5-01).
2. `js/grading/grading-engine.js` — client-side grading (keyword tier stays client-side, unchanged)
3. `railway_config.js` — server URL configuration
4. `shared-grading-proxy/server.js` — the P5-01 output (to understand the API contract)

## Owned Paths
- `railway-server/server.js`
- `js/grading/grading-engine.js`

## Implementation

### server.js — Replace GradingQueue + Groq calls with proxy calls

**Remove** the following from server.js (they now live in shared-grading-proxy):
- The `GradingQueue` class definition (~40 lines)
- The `extractJSON()` / JSON extraction helper functions (~30 lines)
- The MCQ enforcement logic (embedded in the grade handler)
- The `require('groq-sdk')` or Groq fetch calls
- The `GROQ_API_KEY` env var usage (proxy owns this now)

**Replace** the `/api/ai/grade` and `/api/ai/appeal` handlers with thin proxies:

```javascript
const GRADING_PROXY = process.env.GRADING_PROXY_URL || 'http://localhost:3002';

app.post('/api/ai/grade', async (req, res) => {
  try {
    const proxyResponse = await fetch(`${GRADING_PROXY}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(35000)  // 35s > proxy's 30s internal timeout
    });
    const result = await proxyResponse.json();
    res.json(result);
  } catch (err) {
    // Fallback: return keyword-only score (client already computed this)
    res.json({ score: req.body.keywordScore || 'I', feedback: 'AI unavailable', provider: 'fallback' });
  }
});

app.post('/api/ai/appeal', async (req, res) => {
  try {
    const proxyResponse = await fetch(`${GRADING_PROXY}/appeal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(35000)
    });
    const result = await proxyResponse.json();
    res.json(result);
  } catch (err) {
    res.json({ score: req.body.currentScore, feedback: 'Appeal service unavailable', upgraded: false });
  }
});
```

### Add to .env
```
GRADING_PROXY_URL=https://shared-grading-proxy-production.up.railway.app
```

### Cleanup Checklist
After wiring, verify that server.js no longer contains:
- [ ] `GradingQueue` class or instantiation
- [ ] `extractJSON` or JSON repair functions
- [ ] Direct Groq API calls or `GROQ_API_KEY` references
- [ ] MCQ enforcement logic (now in proxy)
- [ ] Smart-quote repair code

This should reduce server.js by ~200-300 lines.

## Constraints
- Client-side endpoints do NOT change (backward compatible)
- Client-side keyword grading stays client-side (no network dependency for Tier 1)
- If grading proxy is down, fall back to keyword score (existing resilience pattern)
- 667+ tests must still pass
- The `GradingQueue` rate limiting, MCQ enforcement, and JSON extraction are the proxy's
  responsibility now — do NOT keep duplicate copies in server.js
- Proxy timeout (35s) must exceed the proxy's internal Groq timeout (30s) to avoid
  double-timeout race conditions

## Verification
```bash
npm test  # All 667+ tests pass
# Integration test:
curl -X POST http://localhost:3001/api/ai/grade \
  -H "Content-Type: application/json" \
  -d '{"questionId":"test","studentAnswer":"test","correctAnswer":"test"}'
```

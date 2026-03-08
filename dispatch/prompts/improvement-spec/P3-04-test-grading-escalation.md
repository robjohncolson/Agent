# Agent: Test Grading Escalation E2E

## Phase
P3-education-hardening | No dependencies | Working dir: `C:/Users/ColsonR/curriculum_render`

## Objective
Write integration tests for the full 3-tier grading escalation chain, verifying the invariant that AI can only upgrade scores, never downgrade.

## Context: The Grading Escalation Dependency Chain

```
Student submits answer
  ↓
TIER 1: Keyword Grading (instant, client-side)
  ├── grading-engine.js → gradeField(questionId, answer, rubric)
  ├── Regex/keyword matching against rubric.expectedElements[]
  ├── Score: E (all required elements) / P (some) / I (none)
  └── If score == E → DONE (no AI needed)
  ↓ (score < E)
TIER 2: AI Review (30s timeout, server-side)
  ├── POST /api/ai/grade → railway-server/server.js
  ├── Server builds prompt from rubric + framework context
  ├── Groq llama-3.3-70b evaluates
  ├── AI returns: { score, feedback }
  └── Final = max(keywordScore, aiScore)  ← CRITICAL INVARIANT
  ↓ (student disagrees)
TIER 3: Appeal (student provides reasoning)
  ├── POST /api/ai/appeal → railway-server/server.js
  ├── Server injects AP framework context (learning objectives, essential knowledge)
  ├── Groq re-evaluates with student reasoning
  ├── AI returns: { score, feedback, upgraded }
  └── Score can ONLY go UP (I→P, P→E, I→E), NEVER down  ← ENFORCED 3 PLACES
```

**The 3-place invariant enforcement:**
1. `railway-server/server.js` — appeal endpoint checks `newScore >= currentScore`
2. `js/grading/grading-engine.js` — client-side max() of keyword and AI scores
3. Client-side validation — `is_correct` flag sent with request

## Read First
1. `js/grading/grading-engine.js` — full grading logic
2. `js/grading/frq-grading-rules.js` — FRQ-specific rules
3. `railway-server/server.js` — `/api/ai/grade` and `/api/ai/appeal` endpoints
4. `railway-server/frameworks.js` — AP framework context injection
5. `tests/grading-engine.test.js` — existing tests (extend, don't duplicate)

## Owned Paths
- `tests/grading/escalation-e2e.test.js`

## Test Structure

```javascript
describe('Tier 1: Keyword Grading', () => {
  test('exact match scores E', () => {});
  test('partial match scores P', () => {});
  test('no match scores I', () => {});
  test('MCQ correct answer scores E immediately', () => {});
});

describe('Tier 2: AI Review', () => {
  test('AI score upgrades keyword I to P', () => {
    // keyword: I, AI: P → final: P
  });
  test('AI score cannot downgrade keyword P to I', () => {
    // keyword: P, AI: I → final: P (max wins)
  });
  test('AI timeout falls back to keyword score', () => {
    // Mock 30s timeout → final: keyword score
  });
});

describe('Tier 3: Appeal', () => {
  test('appeal can upgrade P to E with good reasoning', () => {});
  test('appeal CANNOT downgrade E to P', () => {
    // This is the critical invariant
  });
  test('appeal CANNOT downgrade P to I', () => {});
  test('appeal injects AP framework context', () => {
    // Verify learning objectives and essential knowledge are in prompt
  });
});

describe('Invariant: Score Can Only Go Up', () => {
  test('full escalation chain: I → P (AI) → E (appeal)', () => {
    // keyword: I → AI upgrades to P → appeal upgrades to E
    // Each step must be >= previous
  });
  test('server-side enforcement blocks downgrade', () => {
    // Mock AI returning lower score → server rejects
  });
  test('client-side enforcement blocks downgrade', () => {
    // Verify grading-engine.js max() logic
  });
  test('MCQ wrong answer capped at P even if AI says E', () => {
    // MCQ protection: wrong answers can never get E
  });
});
```

## Verification
```bash
npx vitest run tests/grading/escalation-e2e.test.js --reporter=verbose
npm test  # Full suite
```

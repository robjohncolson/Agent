# Agent: Wire Grading Proxy into LRSL-Driller

## Phase
P5-infrastructure | Depends on: shared-grading-proxy | Working dir: `C:/Users/ColsonR/lrsl-driller`

## Objective
Update lrsl-driller to call the shared grading proxy instead of its own inline AI grading logic.

## Dependencies
- **shared-grading-proxy** must be deployed and accessible

## Context: What Changes

Same pattern as curriculum_render — Railway server becomes a thin proxy to the shared grading service. Client-side endpoints unchanged.

```
BEFORE:
  platform/core/grading-engine.js → POST /api/ai/grade → railway-server/server.js → Groq/Gemini
AFTER:
  platform/core/grading-engine.js → POST /api/ai/grade → railway-server/server.js → shared-grading-proxy
```

## Read First
1. `railway-server/server.js` — find AI grading endpoints
2. `platform/core/grading-engine.js` — client-side grading (Tier 1 stays)
3. `railway-server/prompt-utils.js` — prompt templating (may move to proxy)

## Owned Paths
- `platform/core/grading-engine.js`
- `railway-server/server.js`

## Implementation
Same pattern as P5-02 (curriculum_render):
1. Replace inline Groq/Gemini calls in server.js with fetch to grading proxy
2. Add GRADING_PROXY_URL to .env
3. Keep client-side keyword grading untouched
4. Fallback to keyword score if proxy is down

## Constraints
- 1682+ tests must still pass
- Client-side code unchanged (same /api/ai/grade endpoint)
- Cartridge-specific `ai-grader-prompt.txt` templates must be forwarded to proxy as `rubric` field

## Verification
```bash
npm test  # All 1682+ tests pass
```

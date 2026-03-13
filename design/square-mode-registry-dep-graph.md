# Dependency Graph: Square Mode Registry Integration

## Wave 1 (parallel)

| Agent | Task | Type | Complexity | Timeout |
|-------|------|------|------------|---------|
| A | Build script: add SQUARE_HTML injection | Codex | S | 90s |
| B | Square mode HTML: full registry integration | CC-direct | L | — |

**No dependencies** — Agent A adds injection to the build script; Agent B adds the placeholder the injection targets. Both produce correct output independently.

## Wave 2 (sequential, after Wave 1)

- Run `node scripts/build-roadmap-data.mjs` to verify injection works
- Manual browser check: link icons, status dots, period toggle

## Notes

- Agent B is CC-direct because:
  - 4400-line file with 7 scattered modification points
  - Old→new registry shape mapping requires understanding both data shapes
  - Resource panel rewrite needs careful logic translation
  - Previous Codex tasks on similar multi-point HTML edits timed out

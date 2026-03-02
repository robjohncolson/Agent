# Agent — LLM Routing Intelligence Layer

Data-gathering repo that profiles LLM characteristics from observed workflows.
Goal: build structured routing knowledge that will eventually automate message dispatch.

## Phase: Data Gathering

User narrates their multi-LLM workflow. We capture:
- **Which LLM** was used and why
- **Task type** (code review, research, brainstorming, debugging, etc.)
- **Observed strengths/weaknesses** per model
- **Context/cost factors** (quota, existing context, speed)
- **Outcome quality** — did the choice pay off?

## Structure

```
profiles/       # One JSON per LLM — accumulated characteristics
observations/   # Timestamped routing decisions + outcomes
schema/         # JSON schemas defining the data shapes
```

## LLM Roster

### Terminal (agentic, file-access)
- **codex** — OpenAI Codex CLI
- **claude-code** — Anthropic Claude Code CLI

### Web UI (conversational, no file-access)
- **deepseek** — DeepSeek chat
- **chatgpt-deep-research** — ChatGPT Deep Research mode
- **gemini** — Google Gemini 3.1 Pro
- **grok** — xAI Grok

## Conventions

- All data is JSON
- Profiles are living documents — updated as new observations come in
- Observations are append-only logs
- Slug IDs: lowercase, hyphenated (e.g., `chatgpt-deep-research`)

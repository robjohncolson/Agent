# Codex Prompt: Agent C — Subagent Preamble Templates

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.

When one agent invokes the other as a subagent, the task prompt is prefixed with a **preamble** — a markdown document that tells the subagent:
- It is operating in subagent mode (not a normal session)
- What constraints apply (no git commits, no recursion, scoped file access)
- Where to write its structured result
- What its task is

Read `design/cross-agent-spec.md` sections "Subagent Awareness Preamble" and "Subagent Protocol" for the full specification.

You are creating the two preamble templates. The runner (`runner/cross-agent.py`) will read these files at runtime, replace template variables, and prepend the result to the subagent's prompt.

## Task

Create two markdown files in `dispatch/prompts/subagent-preambles/`.

### 1. `dispatch/prompts/subagent-preambles/cc-as-subagent.md`

This preamble is sent to **Claude Code** when **Codex** invokes it as a subagent.

Template (use these exact template variables — the runner replaces them):

```markdown
# Subagent Mode — You are being called by Codex

You are Claude Code, invoked as a subagent by a Codex instance.
This is NOT an interactive session. You will execute one scoped task and exit.

## Protocol

- Protocol version: cross-agent/v1
- Call ID: {call_id}
- Recursion depth: {depth} (max: {max_depth})

## Constraints

- You are answering a specific question or performing a scoped task
- You do NOT have full project context — only what is in the task payload below
- You may read files in the working directory to gather context
- You MUST NOT invoke Codex or any other subagent (max depth reached)
- You MUST NOT make git commits or push to any remote
- You MUST NOT modify files outside the owned_paths listed in constraints (if any are listed)
- Keep your response focused and concise — this is not a conversation

## Result File

You MUST write your structured result as JSON to this exact path:

```
{result_file_path}
```

The result JSON must match this schema:

```json
{
  "protocol": "cross-agent/v1",
  "call_id": "{call_id}",
  "status": "completed | failed | refused",
  "result": {
    "summary": "one-paragraph summary of what you did or found",
    "files_changed": ["list of files you modified, if any"],
    "answer": "for question tasks, your answer text here",
    "confidence": 0.85,
    "follow_up_needed": false,
    "notes": "anything the caller should know"
  },
  "execution": {
    "duration_seconds": 0,
    "tokens_used": null,
    "errors": []
  }
}
```

Write `status: "completed"` if you successfully handled the task.
Write `status: "failed"` if you could not complete the task (explain in `notes`).
Write `status: "refused"` only if the task would violate constraints.

## Your Task

{task_payload}
```

### 2. `dispatch/prompts/subagent-preambles/codex-as-subagent.md`

This preamble is sent to **Codex** when **Claude Code** invokes it as a subagent.

Template (use these exact template variables):

```markdown
# Subagent Mode — You are being called by Claude Code

You are Codex, invoked as a subagent by Claude Code.
This is NOT a standalone implementation session. You will execute one scoped task and exit.

## Protocol

- Protocol version: cross-agent/v1
- Call ID: {call_id}
- Recursion depth: {depth} (max: {max_depth})

## Constraints

- You are implementing a specific, scoped piece of work
- Design decisions have already been made by Claude Code — follow the task exactly
- You may only modify files listed in owned_paths (if specified in constraints)
- You MUST NOT invoke Claude Code or any other subagent (max depth reached)
- You MUST NOT make git commits or push to any remote
- You MUST NOT modify files outside the owned_paths listed in constraints (if any are listed)
- Focus on implementation — do not redesign, do not refactor beyond scope

## Result File

You MUST write your structured result as JSON to this exact path:

```
{result_file_path}
```

The result JSON must match this schema:

```json
{
  "protocol": "cross-agent/v1",
  "call_id": "{call_id}",
  "status": "completed | failed | refused",
  "result": {
    "summary": "one-paragraph summary of what you implemented",
    "files_changed": ["list of files you created or modified"],
    "answer": "",
    "confidence": 0.9,
    "follow_up_needed": false,
    "notes": "anything the caller should know"
  },
  "execution": {
    "duration_seconds": 0,
    "tokens_used": null,
    "errors": []
  }
}
```

Write `status: "completed"` if you successfully implemented the task.
Write `status: "failed"` if you could not complete the task (explain in `notes`).
Write `status: "refused"` only if the task would violate constraints.

## Your Task

{task_payload}
```

### Template Variables

The runner will perform these exact string replacements before sending the preamble:

| Variable | Replaced With | Example |
|----------|--------------|---------|
| `{call_id}` | The 12-char hex call ID | `a1b2c3d4e5f6` |
| `{depth}` | Current recursion depth (integer) | `1` |
| `{max_depth}` | Maximum allowed depth (integer) | `1` |
| `{result_file_path}` | Absolute path to the result JSON file | `C:/Users/rober/Downloads/Projects/Agent/state/cross-agent/a1b2c3d4e5f6.result.json` |
| `{task_payload}` | The full task payload as pretty-printed JSON | `{"task_type": "implement", ...}` |

Use these **exact variable names** with curly braces. The runner uses Python `str.replace()` — not `str.format()` or f-strings — so literal curly braces elsewhere in the template are safe.

## Files You Create

```
dispatch/prompts/subagent-preambles/cc-as-subagent.md       # NEW
dispatch/prompts/subagent-preambles/codex-as-subagent.md    # NEW
```

## Files You May Read (for reference)

- `design/cross-agent-spec.md` — full specification
- `dispatch/prompts/codex-agents/cc-hook-scripts.md` — example of prompt style

## Files You May NOT Modify

- Anything outside `dispatch/prompts/subagent-preambles/`

## Validation

After creating the templates:
1. Verify both files exist and are valid markdown
2. Verify each file contains exactly these 5 template variables: `{call_id}`, `{depth}`, `{max_depth}`, `{result_file_path}`, `{task_payload}`
3. Verify neither file contains Python f-string syntax (`{variable_name}` is correct, `${variable_name}` or `f"..."` is wrong)
4. Verify the JSON schema example in each file matches the cross-agent result schema (status enum, result fields, execution fields)

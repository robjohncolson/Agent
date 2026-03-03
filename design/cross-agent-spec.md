# Cross-Agent Subagent Spec — CC↔Codex Bidirectional Cross-Talk

## Status: DRAFT — Phase 6

## Problem

Today's architecture is **hub-spoke, one-directional**:

```
CC (hub) ──dispatch──► Codex (worker)
CC (hub) ◄──review───  Codex (worker)
```

CC can invoke Codex via the parallel runner, but:
- It's batch/async — no mid-task conversation
- Codex cannot call CC at all
- Neither agent can pause, ask the other a question, and resume
- The "review" arrow is actually CC reading files after Codex exits — not live communication

This means the user is still the message bus for certain interactions:
- Codex hits a design question → user copies it to CC → user copies answer back
- CC needs a quick implementation test → user manually runs Codex
- CC wants Codex's opinion on a code change → not possible without manual relay

## Goal

**Both agents can invoke the other as a subagent during their own execution.** The invocation is synchronous from the caller's perspective: send task, get structured result, continue.

```
CC ──subagent──► Codex ──result──► CC       (exists as batch; upgrade to inline)
Codex ──subagent──► CC ──result──► Codex    (new capability)
```

## Non-Goals

- Real-time streaming between agents (too complex, insufficient value)
- More than one level of nesting (CC→Codex→CC→Codex — see Recursion Guard)
- Replacing the parallel runner (that stays for batch fan-out)
- Changing either tool's core architecture or requiring upstream patches
- Inter-worker communication (Codex↔Codex remains forbidden per Dispatch-Harvest-Evaluate)

---

## Architecture

### Invocation Mechanisms (What Already Works)

Both CLIs support non-interactive invocation today:

| Direction | Command | Proven? |
|-----------|---------|---------|
| CC → Codex | `codex exec --full-auto - <<< "$prompt"` | Yes — parallel runner uses this |
| Codex → CC | `claude -p "$prompt" --output-format json` | Untested in subagent context |

The shell primitives exist. What's missing is the **protocol layer** on top.

### Subagent Protocol

A subagent call has four parts:

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. ENVELOPE │ ──► │  2. TASK PAYLOAD  │ ──► │  3. EXECUTION │ ──► │  4. RESULT    │
│  (metadata)  │     │  (the actual work)│     │  (subagent)   │     │  (structured) │
└─────────────┘     └──────────────────┘     └──────────────┘     └──────────────┘
```

#### 1. Envelope (caller writes)

```json
{
  "protocol": "cross-agent/v1",
  "direction": "cc-to-codex | codex-to-cc",
  "caller": "claude-code | codex",
  "call_id": "uuid",
  "depth": 0,
  "max_depth": 1,
  "timeout_seconds": 300,
  "working_dir": "/path/to/repo",
  "context": {
    "parent_task": "short description of what caller is doing",
    "why_delegating": "reason this subtask suits the other agent",
    "files_relevant": ["path/to/file1", "path/to/file2"]
  }
}
```

#### 2. Task Payload (caller writes)

```json
{
  "task_type": "implement | review | investigate | validate | design-question",
  "prompt": "the actual task description in natural language",
  "constraints": {
    "owned_paths": ["optional — files subagent may modify"],
    "read_only": false,
    "no_git_commits": true,
    "max_files_changed": 5
  },
  "expected_output": "code-changes | analysis | answer | file-list"
}
```

#### 3. Execution

The caller:
1. Writes envelope + payload to a temp file: `state/cross-agent/{call_id}.request.json`
2. Invokes the subagent CLI with a wrapper prompt that includes the protocol preamble
3. Waits for exit (with timeout)
4. Reads the result file: `state/cross-agent/{call_id}.result.json`

The subagent:
1. Receives a prompt that starts with the protocol preamble (telling it "you are a subagent")
2. Executes the task within the constraints
3. Writes its result to the result file
4. Exits

#### 4. Result (subagent writes)

```json
{
  "protocol": "cross-agent/v1",
  "call_id": "uuid",
  "status": "completed | failed | refused | timeout",
  "result": {
    "summary": "one-paragraph natural language summary",
    "files_changed": ["list of modified files, if any"],
    "answer": "for investigation/question tasks, the answer text",
    "confidence": 0.0-1.0,
    "follow_up_needed": false,
    "notes": "anything the caller should know"
  },
  "execution": {
    "duration_seconds": 42,
    "tokens_used": null,
    "errors": []
  }
}
```

---

## Use Cases by Direction

### CC → Codex (inline subagent)

Today CC can dispatch batch Codex work via the parallel runner. Inline subagent calls serve a different need: **small, synchronous tasks during CC's own reasoning.**

| Use Case | Why Codex? | Example |
|----------|-----------|---------|
| **Quick implementation** | CC designed it, Codex is faster at bulk code | "Implement this 3-function module I just spec'd" |
| **Validation by execution** | Codex can run code CC just reviewed | "Run pytest on these 3 files and report results" |
| **Scaffolding** | Codex excels at boilerplate from specs | "Generate the JSON schema for this data structure" |
| **Parallel micro-tasks** | CC can fan out 2-3 small tasks inline | "Create test fixtures for units 3, 5, and 7" |

**Key difference from parallel runner**: Inline calls are small (seconds to low minutes), single-purpose, and CC continues its own reasoning with the result. The parallel runner is for large multi-agent batch execution.

### Codex → CC (new capability)

This is the fundamentally new direction. Codex currently has no way to ask CC anything.

| Use Case | Why CC? | Example |
|----------|--------|---------|
| **Design question** | CC is the architect | "This module needs a data structure — should I use a dict or a dataclass?" |
| **Scope clarification** | CC authored the constraints | "The spec says 'update the tests' but tests import module X which I can't touch — what should I do?" |
| **Code review mid-flight** | CC is the quality gate | "I've written 200 lines — does this approach match the architecture before I continue?" |
| **Dependency lookup** | CC has web search, Codex doesn't | "What's the correct import path for X in library Y version Z?" |
| **Conflict detection** | CC sees the full project | "I'm about to modify utils.py — is any other agent touching it?" |

**Key insight**: Codex already surfaces these questions today (obs #34 — "asked for direction instead of overwriting") but has to bubble them up through the user. Cross-talk lets Codex get answers without human relay.

---

## Recursion Guard

**Hard rule: maximum call depth is 1.**

```
CC → Codex           ✅  depth 0 → 1
Codex → CC           ✅  depth 0 → 1
CC → Codex → CC      ❌  depth would be 0 → 1 → 2, blocked
```

The envelope carries `depth` (current) and `max_depth` (limit). The subagent wrapper prompt includes:

> You are operating as a subagent (depth 1). You MUST NOT invoke the other agent.
> If you need the other agent's help, return status "refused" with reason "would exceed max_depth".

Enforcement is in the wrapper prompt (soft) AND in the runner script (hard — the subagent invocation function checks depth before spawning).

**Why depth 1 is sufficient**: In observed workflows, the need is always "I have a question for the other agent" — never "I have a question for the other agent who needs to ask me something to answer it." If depth > 1 emerges as a real need, it can be revisited with evidence.

---

## Subagent Awareness Preamble

When an agent is invoked as a subagent, its prompt is prefixed with a preamble so it knows its role:

### CC-as-Subagent Preamble

```markdown
# Subagent Mode — You are being called by Codex

You are Claude Code, invoked as a subagent by a Codex instance.

## Constraints
- You are answering a specific question or performing a scoped task
- You do NOT have the full project context — only what's in the payload
- You may read files in the working directory for context
- You MUST NOT invoke Codex (max depth reached)
- You MUST NOT make git commits
- You MUST write your result to: {result_file_path}
- Keep your response focused and concise — this is not a conversation

## Your Task
{task_payload}
```

### Codex-as-Subagent Preamble

```markdown
# Subagent Mode — You are being called by Claude Code

You are Codex, invoked as a subagent by Claude Code.

## Constraints
- You are implementing a specific, scoped piece of work
- You may only modify files listed in owned_paths (if specified)
- You MUST NOT invoke Claude Code (max depth reached)
- You MUST NOT make git commits
- You MUST write your result to: {result_file_path}
- Focus on implementation — design decisions were already made by CC

## Your Task
{task_payload}
```

---

## Runner Integration

### New: `runner/cross-agent.py`

A lightweight runner (distinct from the parallel batch runner) that handles:

1. **Envelope construction** — builds the request JSON from caller arguments
2. **Prompt assembly** — prepends the appropriate preamble to the task payload
3. **Subprocess management** — invokes the subagent CLI with timeout
4. **Result parsing** — reads and validates the result JSON
5. **State logging** — appends to `state/cross-agent-log.json` for observability

Interface (callable from both CC and Codex):

```
python runner/cross-agent.py \
  --direction cc-to-codex \
  --task-type implement \
  --prompt "Create a helper function that normalizes file paths for Windows/Unix" \
  --working-dir /path/to/repo \
  --owned-paths "utils/paths.py" \
  --timeout 120
```

Returns: the result JSON to stdout. Also writes to `state/cross-agent/{call_id}.result.json`.

### Integration with Parallel Runner

The parallel runner (`runner/parallel-codex-runner.py`) is unchanged. Cross-agent calls are a separate, complementary mechanism:

| Aspect | Parallel Runner | Cross-Agent |
|--------|----------------|-------------|
| Scale | Many agents, large batches | Single subagent call |
| Duration | Minutes to hours | Seconds to low minutes |
| Direction | CC → Codex only | Bidirectional |
| Branching | Per-agent branches + merge | No branching (caller's worktree) |
| Ownership | Manifest-enforced | Optional constraints |
| State | `state/parallel-batch.json` | `state/cross-agent-log.json` |
| When | Batch implementation phase | Ad-hoc during any task |

### Integration with Hooks

Two new hooks enable automatic cross-agent awareness:

1. **cross-agent-request** (fires when a subagent call begins)
   - Logs the call to `state/cross-agent-log.json`
   - Validates depth constraint
   - Optional: notify user that cross-talk is happening

2. **cross-agent-result** (fires when a subagent call completes)
   - Logs the result
   - Updates summary counters
   - Optional: append to observations if the cross-talk revealed routing intelligence

---

## State Management

### Cross-Agent Log

Append-only log of all subagent invocations:

```json
{
  "version": 1,
  "calls": [
    {
      "call_id": "uuid",
      "direction": "cc-to-codex",
      "task_type": "implement",
      "prompt_summary": "first 100 chars...",
      "status": "completed",
      "duration_seconds": 23,
      "timestamp": "ISO8601",
      "files_changed": ["utils/paths.py"],
      "depth": 1
    }
  ],
  "summary": {
    "total_calls": 1,
    "cc_to_codex": 1,
    "codex_to_cc": 0,
    "completed": 1,
    "failed": 0,
    "refused": 0,
    "avg_duration_seconds": 23
  }
}
```

### Request/Result Files

Stored in `state/cross-agent/` with call_id as filename:

```
state/cross-agent/
  abc123.request.json
  abc123.result.json
  def456.request.json
  def456.result.json
```

Cleaned up after 24 hours (or configurable retention).

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Subagent times out | Result status = "timeout", caller decides how to proceed |
| Subagent crashes | Result status = "failed", stderr captured in execution.errors |
| Subagent refuses (depth limit) | Result status = "refused", reason in notes |
| Subagent modifies files outside owned_paths | Post-execution ownership check, violations logged as warnings |
| Result file not written | Caller treats as failure, falls back to own reasoning |
| CLI not found | Pre-flight check at runner startup, fail fast with clear message |

**Fallback principle**: If cross-talk fails for any reason, the caller continues without the subagent's help. Cross-talk is an optimization, not a hard dependency. The user can always relay manually as they do today.

---

## Security and Isolation

### Git Safety
- Subagents MUST NOT make git commits (enforced in preamble + post-execution check)
- All file changes happen in the caller's worktree
- The caller decides whether to commit subagent changes

### Context Isolation
- Subagents start with a clean context (no conversation history from caller)
- Only the task payload and preamble are shared
- Subagents cannot read the caller's context window
- File system access is the only shared state (same repo checkout)

### Cost Awareness
- Each subagent call consumes tokens/quota from the respective service
- CC calls use the Max subscription, Codex calls use Codex tokens
- The cross-agent log tracks usage for cost visibility
- Callers should prefer their own reasoning for trivial tasks (don't delegate what you can answer in 10 tokens)

---

## Phased Rollout

### Phase 6a: CC → Codex Inline (lowest risk)

This extends existing, proven infrastructure:

1. Build `runner/cross-agent.py` with CC-to-Codex direction only
2. Test with simple tasks: "implement this function", "run these tests"
3. Integrate result parsing into CC's workflow
4. Add cross-agent log

**Validation**: CC successfully delegates a small implementation task to Codex inline and uses the result to continue its own work, without user relay.

### Phase 6b: Codex → CC (new capability)

1. Add Codex-to-CC direction to `runner/cross-agent.py`
2. Test with question tasks: "should I use X or Y?", "what's the import path?"
3. Validate that `claude -p` works reliably in subagent mode
4. Add CC-as-subagent preamble

**Validation**: Codex autonomously asks CC a design question mid-implementation and acts on the answer correctly.

### Phase 6c: Hooks + Observability

1. Wire cross-agent hooks into CC and Codex configurations
2. Add observation auto-capture for novel cross-talk patterns
3. Dashboard/summary in session-start hook output
4. Tune timeouts and constraints based on Phase 6a/6b data

**Validation**: Cross-agent calls are visible in session startup summary. Usage patterns inform routing profile updates.

### Phase 6d: Evaluation

After sufficient usage, evaluate:
- Which direction is used more? (hypothesis: Codex→CC for questions)
- What task types dominate? (hypothesis: design-question and validate)
- Does cross-talk reduce user relay time?
- Are there patterns that should be automated further?
- Should max_depth be increased?
- Should the parallel runner offer inline cross-talk during batch execution?

---

## Open Questions

1. **`claude -p` reliability**: Does CC's print mode work cleanly for subagent use on Windows/MSYS2? Need to test the same `.cmd` shim resolution that Codex required.

2. **Context window cost**: CC-as-subagent starts fresh each call. For repeated questions from the same Codex task, should we support a "session" mode where CC retains context across multiple subagent calls? (Adds complexity — defer unless data demands it.)

3. **Token budget**: Should the envelope include a token/cost budget so the caller can constrain subagent expense? Or is timeout sufficient as a proxy?

4. **Parallel runner integration**: In Phase 6d, should individual Codex agents within a parallel batch be able to call CC? This breaks the "no inter-worker communication" invariant indirectly (Codex→CC→decision that affects other agents). Needs careful design if pursued.

5. **Notification**: Should the user be notified when cross-talk happens? Options: always, never, only on failure, configurable. Recommendation: log silently, surface in session-start summary.

6. **AGENTS.md awareness**: Should the subagent preamble include the target repo's AGENTS.md/CLAUDE.md? This gives the subagent project-specific conventions but increases prompt size.

---

## Relationship to Existing Architecture

```
BEFORE (hub-spoke, one-directional):

  User ◄──────────────────────────────────► User
    │                                          │
    ▼                                          ▼
  CC (hub) ──batch dispatch──► Codex (worker)
  CC (hub) ◄──file review────  Codex (worker)


AFTER (hub-spoke with bidirectional cross-talk):

  User ◄──────────────────────────────────► User
    │                                          │
    ▼                                          ▼
  CC (hub) ──batch dispatch──► Codex (worker)     ← unchanged
  CC (hub) ◄──file review────  Codex (worker)     ← unchanged
  CC (hub) ──inline task────► Codex (subagent)    ← NEW
  CC (hub) ◄──inline result──  Codex (subagent)    ← NEW
  Codex    ──question────────► CC (subagent)       ← NEW
  Codex    ◄──answer──────────  CC (subagent)       ← NEW
```

The Dispatch-Harvest-Evaluate pattern is preserved:
- Batch execution (parallel runner) still follows hub-spoke with no inter-worker communication
- Cross-talk is **caller-to-subagent**, not **worker-to-worker**
- The subagent relationship is hierarchical (caller > callee), not peer-to-peer
- Hub identity is context-dependent: CC is hub during batch dispatch, but either agent can be the caller in cross-talk

---

## Success Criteria

1. CC can invoke Codex inline, get a structured result, and continue its task — no user relay
2. Codex can ask CC a design question, get an answer, and act on it — no user relay
3. Recursion depth is enforced (max 1 level)
4. All cross-agent calls are logged with full observability
5. Failure in cross-talk degrades gracefully (caller continues without subagent)
6. No changes to the parallel runner — the two systems coexist
7. User relay time for CC↔Codex interactions drops measurably

# Codex Prompt: Agent A — Cross-Agent Runner

## Context

You are working in the Agent repo at `C:\Users\rober\Downloads\Projects\Agent`.
This repo orchestrates LLM routing intelligence and multi-agent automation.

The repo already has a **parallel batch runner** (`runner/parallel-codex-runner.py`) that dispatches multiple Codex instances on separate branches. That runner is for large batch fan-out.

You are building a **different, complementary tool**: a lightweight runner for **inline, synchronous subagent calls** between Claude Code (CC) and Codex. Either agent can call the other mid-task, get a structured result, and continue.

Read `design/cross-agent-spec.md` for the full specification. Your job is to implement `runner/cross-agent.py` exactly as described there.

## Task

Create `runner/cross-agent.py` — a Python 3 script (stdlib only, no pip dependencies).

### CLI Interface

```
python runner/cross-agent.py \
  --direction cc-to-codex | codex-to-cc \
  --task-type implement | review | investigate | validate | design-question \
  --prompt "the natural language task" \
  --working-dir /path/to/repo \
  [--owned-paths "glob1" "glob2" ...] \
  [--read-only] \
  [--timeout 300] \
  [--depth 0] \
  [--max-depth 1] \
  [--codex-bin codex] \
  [--claude-bin claude] \
  [--dry-run]
```

### Required Functions

Implement these functions (names and signatures are mandatory):

#### `now_iso() -> str`
UTC ISO8601 timestamp, no microseconds, Z suffix. Copy the pattern from `runner/parallel-codex-runner.py`.

#### `generate_call_id() -> str`
`uuid.uuid4().hex[:12]` — short, filesystem-safe.

#### `resolve_cli_binary(direction: str, codex_bin: str, claude_bin: str) -> list[str]`
- For `cc-to-codex`: reuse the Windows `.cmd` shim resolution logic from `parallel-codex-runner.py` (`_resolve_codex_on_windows`). Fall back to `shlex.split(codex_bin)`.
- For `codex-to-cc`: check `shutil.which(claude_bin)`. On Windows, also check for `claude.cmd` and resolve past the shim the same way (look for a `.js` entry point under `node_modules/@anthropic/claude-code/`). If no shim resolution works, fall back to `shlex.split(claude_bin)`.
- Raise `SystemExit(1)` with a clear message if the binary can't be found.

#### `build_envelope(args, call_id: str) -> dict`
Build the envelope JSON from CLI args. Schema:
```json
{
  "protocol": "cross-agent/v1",
  "direction": "cc-to-codex",
  "caller": "claude-code",
  "call_id": "abc123def456",
  "depth": 0,
  "max_depth": 1,
  "timeout_seconds": 300,
  "working_dir": "/path/to/repo",
  "context": {
    "parent_task": "",
    "why_delegating": "",
    "files_relevant": []
  }
}
```
The `caller` field is derived from `direction`: `cc-to-codex` → caller is `claude-code`, `codex-to-cc` → caller is `codex`.

#### `build_payload(args) -> dict`
Build the task payload JSON from CLI args. Schema:
```json
{
  "task_type": "implement",
  "prompt": "the task text",
  "constraints": {
    "owned_paths": ["glob1"],
    "read_only": false,
    "no_git_commits": true,
    "max_files_changed": 10
  },
  "expected_output": "code-changes"
}
```
Map `task_type` → `expected_output`:
- `implement` → `code-changes`
- `review` → `analysis`
- `investigate` → `answer`
- `validate` → `analysis`
- `design-question` → `answer`

#### `assemble_prompt(direction: str, payload: dict, result_file: str, preamble_dir: str) -> str`
1. Read the appropriate preamble template from `preamble_dir`:
   - `cc-to-codex` → `codex-as-subagent.md`
   - `codex-to-cc` → `cc-as-subagent.md`
2. Replace `{result_file_path}` with the actual result file path
3. Replace `{task_payload}` with the JSON-serialized payload
4. If preamble files don't exist, use a hardcoded minimal preamble (the script must work even before Agent C creates the templates)

#### `invoke_subagent(cli_cmd: list[str], direction: str, assembled_prompt: str, working_dir: str, timeout: int) -> tuple[int, str, str]`
- For `cc-to-codex`: run `cli_cmd + ["exec", "--full-auto", "-"]` with `stdin=PIPE`, pipe the assembled prompt via stdin. Set `encoding="utf-8"` on Popen (Windows fix).
- For `codex-to-cc`: run `cli_cmd + ["-p", assembled_prompt, "--output-format", "json"]`. No stdin piping needed.
- Capture stdout and stderr.
- Apply timeout via `subprocess.Popen.communicate(timeout=timeout)`. On `TimeoutExpired`, kill the process and return exit code -1.
- Return `(exit_code, stdout, stderr)`.

#### `parse_result(call_id: str, state_dir: str) -> dict`
- Try to read `{state_dir}/cross-agent/{call_id}.result.json`
- If the file exists and is valid JSON, return it
- If not, construct a failure result:
```json
{
  "protocol": "cross-agent/v1",
  "call_id": "...",
  "status": "failed",
  "result": {
    "summary": "Subagent did not write a result file",
    "files_changed": [],
    "answer": "",
    "confidence": 0,
    "follow_up_needed": true,
    "notes": "stderr output here if available"
  },
  "execution": {
    "duration_seconds": 0,
    "tokens_used": null,
    "errors": ["no result file written"]
  }
}
```

#### `check_depth(depth: int, max_depth: int) -> None`
If `depth >= max_depth`, print an error message to stderr and `sys.exit(0)` — not an error exit, just a clean "I'm not allowed to recurse" signal. Write a result file with `status: "refused"` and `notes: "would exceed max_depth"`.

#### `log_call(state_dir: str, envelope: dict, result: dict, duration: float) -> None`
- Read `{state_dir}/cross-agent-log.json` (create if missing with `{"version": 1, "calls": [], "summary": {...}}`)
- Append a call entry to `calls[]`
- Update `summary` counters (total_calls, cc_to_codex, codex_to_cc, completed, failed, refused, avg_duration_seconds)
- Write back atomically (temp file + `os.replace`)

#### `main() -> None`
Orchestration:
1. Parse CLI args with `argparse`
2. `check_depth(depth, max_depth)`
3. `call_id = generate_call_id()`
4. `resolve_cli_binary(...)` — fail fast if binary not found
5. `envelope = build_envelope(...)`
6. `payload = build_payload(...)`
7. Write request file to `state/cross-agent/{call_id}.request.json`
8. `prompt = assemble_prompt(...)`
9. If `--dry-run`: print the assembled prompt to stdout and exit
10. `start = time.time()`
11. `exit_code, stdout, stderr = invoke_subagent(...)`
12. `duration = time.time() - start`
13. `result = parse_result(call_id, state_dir)`
14. If result status is still "failed" but exit_code was 0, check if subagent wrote changes and build a synthetic "completed" result from stdout
15. `log_call(state_dir, envelope, result, duration)`
16. Print result JSON to stdout
17. `sys.exit(0 if result["status"] == "completed" else 1)`

### Critical Implementation Details

1. **Windows/MSYS2 compatibility**: Use `encoding="utf-8"` on all `Popen` calls. Use forward slashes in paths. Handle both `\` and `/` path separators.
2. **Atomic writes**: Always write to a `.tmp` file then `os.replace()` to the final path. Copy this pattern from `parallel-codex-runner.py`.
3. **Directory creation**: `os.makedirs("state/cross-agent", exist_ok=True)` before writing any files.
4. **No git operations**: This script never runs git. That's the caller's job.
5. **Stdlib only**: `argparse`, `json`, `os`, `pathlib`, `re`, `shlex`, `shutil`, `subprocess`, `sys`, `threading`, `time`, `uuid`, `datetime`. Nothing from pip.
6. **Error handling**: Catch `FileNotFoundError`, `json.JSONDecodeError`, `subprocess.TimeoutExpired`, `OSError`. Never crash — always write a result file and exit cleanly.

## Files You Create

```
runner/cross-agent.py    # NEW — cross-agent subagent runner
```

## Files You May Read (for reference patterns)

- `runner/parallel-codex-runner.py` — reuse `now_iso()`, `_resolve_codex_on_windows()`, atomic write patterns, `normalize_repo_path()`
- `design/cross-agent-spec.md` — full specification

## Files You May NOT Modify

- `runner/parallel-codex-runner.py`
- Anything in `hooks/`, `schema/`, `dispatch/prompts/subagent-preambles/`, `state/`, `profiles/`, `observations/`

## Validation

After creating the script:
1. `python -m py_compile runner/cross-agent.py` (syntax check)
2. `python runner/cross-agent.py --help` (verify CLI interface)
3. `python runner/cross-agent.py --direction cc-to-codex --task-type implement --prompt "test" --working-dir . --dry-run` (verify prompt assembly without invoking anything)
4. Verify `state/cross-agent/` directory was created
5. Verify the dry-run output contains the preamble text and the task payload

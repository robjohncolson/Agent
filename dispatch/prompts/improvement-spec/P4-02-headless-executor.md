# Agent: Claude Code Headless Executor

## Phase
P4-pipeline-recovery | No dependencies | Working dir: `C:/Users/ColsonR/Agent`

## Objective
Update the parallel runner to support `--executor claude` using Claude Code headless mode, fixing the Windows TTY issues that blocked Codex CLI spawning.

## Context: The Problem

From session analysis:
- "Codex CLI spawning failed multiple times due to TTY requirements and Windows shell quoting issues"
- Had to pivot to spec-based approach instead of parallel execution
- Codex requires interactive TTY on Windows; Claude Code headless (`claude -p`) does not

## Dependency: Existing Parallel Runner

```
runner/parallel-codex-runner.py
  ├── Reads: dispatch/{batch}.manifest.json
  ├── For each agent in manifest:
  │   ├── Create git branch: codex/{agent-name}
  │   ├── Spawn: codex exec --task "prompt" --working-dir repo --ownership-manifest paths
  │   └── Wait for completion, collect results
  ├── Respects depends_on ordering
  └── Reports: success/failure per agent
```

## Read First
1. `runner/parallel-codex-runner.py` — existing implementation
2. `runner/parallel-runner.md` — documentation
3. `design/cross-agent-spec.md` — cross-agent protocol
4. `~/.codex/config.toml` — Codex config (for reference)

## Owned Paths
- `runner/parallel-codex-runner.py` (modify — add `--executor` flag)
- `runner/claude-headless.sh` (new — wrapper script)

## Implementation

### 1. Add `--executor` CLI flag to parallel-codex-runner.py

```python
# In argparse setup, add:
parser.add_argument('--executor', choices=['codex', 'claude'], default='codex',
                    help='Which CLI to use for execution (claude fixes Windows TTY issues)')
```

### 2. Claude headless execution function

```python
import subprocess

def execute_with_claude(agent, working_dir, prompt, owned_paths, timeout=600):
    """Execute agent task using Claude Code headless mode."""
    # Build allowed tools list
    allowed_tools = "Edit,Read,Write,Bash,Glob,Grep"

    # Build the prompt with ownership constraints
    full_prompt = f"""You are executing as part of a parallel agent batch.

## Your Task
{prompt}

## Constraints
- You may ONLY modify these files: {', '.join(owned_paths)}
- Do NOT modify files outside your ownership manifest
- Run tests after each change to verify correctness
- Commit your changes when done with message prefix: [{agent['name']}]
"""

    cmd = [
        'claude', '-p', full_prompt,
        '--allowedTools', allowed_tools,
        '--output-format', 'text'
    ]

    result = subprocess.run(
        cmd,
        cwd=working_dir,
        capture_output=True,
        text=True,
        timeout=timeout
    )

    return {
        'agent': agent['name'],
        'exit_code': result.returncode,
        'stdout': result.stdout,
        'stderr': result.stderr
    }
```

### 3. Wrapper script for Windows compatibility

```bash
#!/bin/bash
# runner/claude-headless.sh
# Wrapper for Claude Code headless execution on Windows (Git Bash)

PROMPT="$1"
WORKING_DIR="$2"
ALLOWED_TOOLS="${3:-Edit,Read,Write,Bash,Glob,Grep}"

cd "$WORKING_DIR" || exit 1

claude -p "$PROMPT" \
  --allowedTools "$ALLOWED_TOOLS" \
  --output-format text \
  2>&1
```

### 4. Update the main execution loop

```python
# In the main batch execution loop:
for agent in batch:
    if args.executor == 'claude':
        result = execute_with_claude(agent, working_dir, prompt, owned_paths)
    else:
        result = execute_with_codex(agent, working_dir, prompt, owned_paths)
```

## Constraints
- Do NOT remove Codex support — keep it as default for non-Windows environments
- Claude headless mode does not need TTY — it reads from `-p` flag
- Preserve the dependency ordering logic (depends_on)
- Preserve the branch-per-agent pattern
- Preserve ownership manifest enforcement

## Verification
```bash
# Test Claude headless works
claude -p "echo 'hello from headless'" --allowedTools "Bash" --output-format text

# Test the runner with claude executor
python runner/parallel-codex-runner.py \
  --manifest dispatch/improvement-spec.manifest.json \
  --phase P1-foundation \
  --executor claude \
  --dry-run
```

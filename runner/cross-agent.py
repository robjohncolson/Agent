#!/usr/bin/env python3
"""Lightweight bidirectional cross-agent subagent runner."""

import argparse
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone


DEFAULT_TIMEOUT_SECONDS = 300
DEFAULT_DEPTH = 0
DEFAULT_MAX_DEPTH = 1
DEFAULT_CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
DEFAULT_CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")

_CHECK_DEPTH_STATE_DIR = ""
_LAST_SUBPROCESS_STDERR = ""


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def generate_call_id() -> str:
    return uuid.uuid4().hex[:12]


def normalize_repo_path(value: str) -> str:
    cleaned = value.replace("\\", "/")
    cleaned = re.sub(r"^\./", "", cleaned)
    cleaned = re.sub(r"/+", "/", cleaned)
    return cleaned.strip("/")


def to_forward_slashes(value: str) -> str:
    return value.replace("\\", "/")


def _split_cli_value(raw_value: str, arg_name: str) -> list[str]:
    try:
        parts = shlex.split(raw_value, posix=(os.name != "nt"))
    except ValueError as exc:
        print(f"Invalid {arg_name} value: {raw_value}", file=sys.stderr)
        raise SystemExit(1) from exc
    if not parts:
        print(f"{arg_name} cannot be empty", file=sys.stderr)
        raise SystemExit(1)
    return parts


def _is_executable_resolvable(executable: str) -> bool:
    if (
        os.path.isabs(executable)
        or "/" in executable
        or "\\" in executable
        or executable.startswith(".")
    ):
        return os.path.exists(executable)
    return shutil.which(executable) is not None


def _resolve_codex_on_windows(codex_bin: str) -> list[str]:
    """Resolve npm .cmd shim to the underlying Codex JS entry point."""
    if os.name != "nt":
        return []
    cmd_path = shutil.which(f"{codex_bin}.cmd") or shutil.which(codex_bin)
    if not cmd_path:
        return []
    cmd_dir = pathlib.Path(cmd_path).parent
    js_entry = cmd_dir / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
    if js_entry.exists():
        return ["node", str(js_entry)]
    return []


def _resolve_claude_on_windows(claude_bin: str) -> list[str]:
    """Resolve npm .cmd shim to a Claude Code JS entry point."""
    if os.name != "nt":
        return []

    cmd_path = shutil.which(f"{claude_bin}.cmd") or shutil.which(claude_bin)
    if not cmd_path:
        return []

    cmd_dir = pathlib.Path(cmd_path).parent
    # Try both @anthropic-ai (actual npm package) and @anthropic (possible alt)
    for pkg_name in ("@anthropic-ai", "@anthropic"):
        package_dir = cmd_dir / "node_modules" / pkg_name / "claude-code"
        if package_dir.exists():
            break
    else:
        return []

    candidates = [
        package_dir / "bin" / "claude.js",
        package_dir / "bin" / "cli.js",
        package_dir / "cli.js",
        package_dir / "dist" / "cli.js",
    ]
    for candidate in candidates:
        if candidate.exists():
            return ["node", str(candidate)]

    try:
        js_candidates = sorted(package_dir.rglob("*.js"))
    except OSError:
        return []

    for candidate in js_candidates:
        lower_name = candidate.name.lower()
        if "claude" in lower_name or "cli" in lower_name:
            return ["node", str(candidate)]
    if js_candidates:
        return ["node", str(js_candidates[0])]
    return []


def resolve_cli_binary(direction: str, codex_bin: str, claude_bin: str) -> list[str]:
    if direction == "cc-to-codex":
        codex_parts = _split_cli_value(codex_bin, "--codex-bin")
        if os.name == "nt":
            resolved = _resolve_codex_on_windows(codex_parts[0])
            if resolved:
                command = resolved + codex_parts[1:]
                if _is_executable_resolvable(command[0]):
                    return command

        if not _is_executable_resolvable(codex_parts[0]):
            print(
                f"Unable to locate Codex binary for --codex-bin '{codex_bin}'.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        return codex_parts

    if direction == "codex-to-cc":
        claude_parts = _split_cli_value(claude_bin, "--claude-bin")
        _ = shutil.which(claude_bin)

        if os.name == "nt":
            resolved = _resolve_claude_on_windows(claude_parts[0])
            if resolved:
                command = resolved + claude_parts[1:]
                if _is_executable_resolvable(command[0]):
                    return command

        if not _is_executable_resolvable(claude_parts[0]):
            print(
                f"Unable to locate Claude binary for --claude-bin '{claude_bin}'.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        return claude_parts

    print(f"Unsupported direction: {direction}", file=sys.stderr)
    raise SystemExit(1)


def build_envelope(args, call_id: str) -> dict:
    caller = "claude-code" if args.direction == "cc-to-codex" else "codex"
    return {
        "protocol": "cross-agent/v1",
        "direction": args.direction,
        "caller": caller,
        "call_id": call_id,
        "depth": int(args.depth),
        "max_depth": int(args.max_depth),
        "timeout_seconds": int(args.timeout),
        "working_dir": to_forward_slashes(os.path.abspath(args.working_dir)),
        "context": {
            "parent_task": "",
            "why_delegating": "",
            "files_relevant": [],
        },
    }


def build_payload(args) -> dict:
    output_map = {
        "implement": "code-changes",
        "review": "analysis",
        "investigate": "answer",
        "validate": "analysis",
        "design-question": "answer",
    }
    owned_paths = [
        normalize_repo_path(str(item))
        for item in list(args.owned_paths or [])
        if str(item).strip()
    ]
    return {
        "task_type": args.task_type,
        "prompt": args.prompt,
        "constraints": {
            "owned_paths": owned_paths,
            "read_only": bool(args.read_only),
            "no_git_commits": True,
            "max_files_changed": 10,
        },
        "expected_output": output_map[args.task_type],
    }


def _fallback_preamble(direction: str) -> str:
    if direction == "cc-to-codex":
        return (
            "# Subagent Mode\n\n"
            "You are Codex, invoked as a subagent by Claude Code.\n"
            "Do not call Claude Code.\n"
            "Do not make git commits.\n"
            "After applying patches, write the result file and exit immediately. "
            "Do not run verification commands, tests, or lint checks.\n"
            "Write your result JSON to: {result_file_path}\n\n"
            "## Your Task\n"
            "{task_payload}\n"
        )
    return (
        "# Subagent Mode\n\n"
        "You are Claude Code, invoked as a subagent by Codex.\n"
        "Do not call Codex.\n"
        "Do not make git commits.\n"
        "Write your result JSON to: {result_file_path}\n\n"
        "## Your Task\n"
        "{task_payload}\n"
    )


def assemble_prompt(
    direction: str, payload: dict, result_file: str, preamble_dir: str,
    call_id: str = "", depth: int = 0, max_depth: int = 1,
) -> str:
    file_map = {
        "cc-to-codex": "codex-as-subagent.md",
        "codex-to-cc": "cc-as-subagent.md",
    }
    template_path = os.path.join(preamble_dir, file_map[direction])

    preamble_text = ""
    try:
        with open(template_path, "r", encoding="utf-8") as handle:
            preamble_text = handle.read()
    except OSError:
        preamble_text = _fallback_preamble(direction)

    payload_json = json.dumps(payload, indent=2)
    prompt = preamble_text.replace("{call_id}", call_id)
    prompt = prompt.replace("{depth}", str(depth))
    prompt = prompt.replace("{max_depth}", str(max_depth))
    prompt = prompt.replace("{result_file_path}", to_forward_slashes(result_file))
    prompt = prompt.replace("{task_payload}", payload_json)
    return prompt


def invoke_subagent(
    cli_cmd: list[str],
    direction: str,
    assembled_prompt: str,
    working_dir: str,
    timeout: int,
) -> tuple[int, str, str]:
    process: subprocess.Popen[str] | None = None
    stdout = ""
    stderr = ""

    try:
        if direction == "cc-to-codex":
            command = cli_cmd + ["exec", "--full-auto", "-"]
            process = subprocess.Popen(
                command,
                cwd=working_dir,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
            )
            stdout, stderr = process.communicate(
                input=assembled_prompt,
                timeout=timeout,
            )
        else:
            command = cli_cmd + ["-p", assembled_prompt, "--output-format", "json"]
            # CC refuses to start inside another CC session unless CLAUDECODE is unset
            env = os.environ.copy()
            env.pop("CLAUDECODE", None)
            process = subprocess.Popen(
                command,
                cwd=working_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                env=env,
            )
            stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if process is not None:
            process.kill()
            try:
                stdout, stderr = process.communicate()
            except OSError:
                stdout, stderr = "", ""
        timeout_note = f"Subagent timed out after {timeout} seconds."
        if stderr:
            stderr = f"{stderr}\n{timeout_note}"
        else:
            stderr = timeout_note
        return (-1, stdout or "", stderr or "")

    return (int(process.returncode if process is not None else 1), stdout or "", stderr or "")


def _failure_result_template(call_id: str, notes: str) -> dict:
    return {
        "protocol": "cross-agent/v1",
        "call_id": call_id,
        "status": "failed",
        "result": {
            "summary": "Subagent did not write a result file",
            "files_changed": [],
            "answer": "",
            "confidence": 0,
            "follow_up_needed": True,
            "notes": notes,
        },
        "execution": {
            "duration_seconds": 0,
            "tokens_used": None,
            "errors": ["no result file written"],
        },
    }


def parse_result(call_id: str, state_dir: str) -> dict:
    result_path = os.path.join(state_dir, "cross-agent", f"{call_id}.result.json")

    if os.path.exists(result_path):
        try:
            with open(result_path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                return loaded
        except (OSError, json.JSONDecodeError):
            pass

    notes = _LAST_SUBPROCESS_STDERR.strip() or "stderr output here if available"
    return _failure_result_template(call_id, notes)


def _write_json_atomic(path: str, payload: dict) -> None:
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    os.replace(tmp_path, path)


def check_depth(depth: int, max_depth: int) -> None:
    if depth < max_depth:
        return

    call_id = generate_call_id()
    state_dir = _CHECK_DEPTH_STATE_DIR or os.path.join(os.getcwd(), "state")
    result_path = os.path.join(state_dir, "cross-agent", f"{call_id}.result.json")
    refusal = {
        "protocol": "cross-agent/v1",
        "call_id": call_id,
        "status": "refused",
        "result": {
            "summary": "Subagent invocation refused",
            "files_changed": [],
            "answer": "",
            "confidence": 0,
            "follow_up_needed": True,
            "notes": "would exceed max_depth",
        },
        "execution": {
            "duration_seconds": 0,
            "tokens_used": None,
            "errors": ["would exceed max_depth"],
        },
    }
    try:
        _write_json_atomic(result_path, refusal)
    except OSError:
        pass

    print(
        f"Refusing subagent call because depth {depth} >= max_depth {max_depth}.",
        file=sys.stderr,
    )
    print(json.dumps(refusal, indent=2))
    sys.exit(0)


def _default_log_state() -> dict:
    return {
        "version": 1,
        "calls": [],
        "summary": {
            "total_calls": 0,
            "cc_to_codex": 0,
            "codex_to_cc": 0,
            "completed": 0,
            "failed": 0,
            "refused": 0,
            "avg_duration_seconds": 0,
        },
    }


def log_call(state_dir: str, envelope: dict, result: dict, duration: float) -> None:
    log_path = os.path.join(state_dir, "cross-agent-log.json")
    call_id = str(envelope.get("call_id", ""))

    log_data = _default_log_state()
    if os.path.exists(log_path):
        try:
            with open(log_path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                log_data = loaded
        except (OSError, json.JSONDecodeError):
            log_data = _default_log_state()

    calls = log_data.get("calls")
    if not isinstance(calls, list):
        calls = []
        log_data["calls"] = calls

    task_type = ""
    prompt_summary = ""
    request_path = os.path.join(state_dir, "cross-agent", f"{call_id}.request.json")
    if os.path.exists(request_path):
        try:
            with open(request_path, "r", encoding="utf-8") as handle:
                request_data = json.load(handle)
            if isinstance(request_data, dict):
                payload = request_data.get("payload", {})
                if isinstance(payload, dict):
                    task_type = str(payload.get("task_type", ""))
                    prompt_text = str(payload.get("prompt", ""))
                    prompt_summary = prompt_text[:100]
        except (OSError, json.JSONDecodeError):
            pass

    result_block = result.get("result", {}) if isinstance(result, dict) else {}
    files_changed = []
    if isinstance(result_block, dict):
        raw_files_changed = result_block.get("files_changed", [])
        if isinstance(raw_files_changed, list):
            files_changed = [str(item) for item in raw_files_changed]

    call_entry = {
        "call_id": call_id,
        "direction": envelope.get("direction", ""),
        "task_type": task_type,
        "prompt_summary": prompt_summary,
        "status": result.get("status", "failed"),
        "duration_seconds": round(float(duration), 3),
        "timestamp": now_iso(),
        "files_changed": files_changed,
        "depth": envelope.get("depth", 0),
    }
    calls.append(call_entry)

    completed = 0
    failed = 0
    refused = 0
    cc_to_codex = 0
    codex_to_cc = 0
    total_duration = 0.0

    for item in calls:
        if not isinstance(item, dict):
            continue
        direction = str(item.get("direction", ""))
        status = str(item.get("status", ""))
        call_duration = float(item.get("duration_seconds", 0) or 0)

        if direction == "cc-to-codex":
            cc_to_codex += 1
        if direction == "codex-to-cc":
            codex_to_cc += 1
        if status == "completed":
            completed += 1
        elif status == "refused":
            refused += 1
        elif status in {"failed", "timeout"}:
            failed += 1

        total_duration += call_duration

    total_calls = len(calls)
    avg_duration = round(total_duration / total_calls, 3) if total_calls else 0

    log_data["summary"] = {
        "total_calls": total_calls,
        "cc_to_codex": cc_to_codex,
        "codex_to_cc": codex_to_cc,
        "completed": completed,
        "failed": failed,
        "refused": refused,
        "avg_duration_seconds": avg_duration,
    }

    _write_json_atomic(log_path, log_data)


def _should_skip_dir(rel_dir: str) -> bool:
    if not rel_dir:
        return False
    return rel_dir == ".git" or rel_dir.startswith(".git/") or rel_dir.startswith("state/cross-agent")


def _capture_file_snapshot(working_dir: str) -> dict:
    snapshot: dict[str, tuple[int, int]] = {}
    working_dir_abs = os.path.abspath(working_dir)

    for root, dirs, files in os.walk(working_dir_abs, topdown=True):
        root_rel = normalize_repo_path(os.path.relpath(root, working_dir_abs))
        if root_rel == ".":
            root_rel = ""
        dirs[:] = [
            d
            for d in dirs
            if not _should_skip_dir(
                normalize_repo_path(f"{root_rel}/{d}" if root_rel else d)
            )
        ]
        for filename in files:
            abs_path = os.path.join(root, filename)
            rel_path = normalize_repo_path(os.path.relpath(abs_path, working_dir_abs))
            if _should_skip_dir(rel_path):
                continue
            try:
                stat_info = os.stat(abs_path)
            except OSError:
                continue
            snapshot[rel_path] = (int(stat_info.st_size), int(stat_info.st_mtime_ns))
    return snapshot


def _matches_owned_paths(path_value: str, patterns: list[str]) -> bool:
    if not patterns:
        return True
    pure_path = pathlib.PurePosixPath(path_value)
    for raw_pattern in patterns:
        pattern = normalize_repo_path(str(raw_pattern))
        if not pattern:
            continue
        if pure_path.match(pattern):
            return True
        if path_value == pattern:
            return True
        if path_value.startswith(f"{pattern.rstrip('/')}/"):
            return True
    return False


def _detect_changed_files(
    before_snapshot: dict,
    working_dir: str,
    owned_paths: list[str],
) -> list[str]:
    after_snapshot = _capture_file_snapshot(working_dir)
    changed = set()

    for path_value, metadata in after_snapshot.items():
        if before_snapshot.get(path_value) != metadata:
            if _matches_owned_paths(path_value, owned_paths):
                changed.add(path_value)

    for path_value in before_snapshot:
        if path_value not in after_snapshot:
            if _matches_owned_paths(path_value, owned_paths):
                changed.add(path_value)

    return sorted(changed)


def _build_timeout_result(
    call_id: str,
    timeout: int,
    duration: float,
    stderr_text: str,
) -> dict:
    notes = stderr_text.strip() or f"Subagent timed out after {timeout} seconds."
    return {
        "protocol": "cross-agent/v1",
        "call_id": call_id,
        "status": "timeout",
        "result": {
            "summary": "Subagent invocation timed out",
            "files_changed": [],
            "answer": "",
            "confidence": 0,
            "follow_up_needed": True,
            "notes": notes,
        },
        "execution": {
            "duration_seconds": round(float(duration), 3),
            "tokens_used": None,
            "errors": [f"timed out after {timeout} seconds"],
        },
    }


def _build_synthetic_completed_result(
    call_id: str,
    task_type: str,
    stdout_text: str,
    stderr_text: str,
    changed_files: list[str],
    duration: float,
) -> dict:
    stdout_trimmed = stdout_text.strip()
    stderr_trimmed = stderr_text.strip()

    if changed_files:
        summary = "Subagent completed and applied changes but did not write a result file"
    else:
        summary = "Subagent completed without writing a result file"

    answer_text = ""
    if task_type in {"review", "investigate", "validate", "design-question"}:
        answer_text = stdout_trimmed

    notes_parts = []
    if not answer_text and stdout_trimmed:
        notes_parts.append("stdout captured")
    if stderr_trimmed:
        notes_parts.append(f"stderr: {stderr_trimmed}")

    return {
        "protocol": "cross-agent/v1",
        "call_id": call_id,
        "status": "completed",
        "result": {
            "summary": summary,
            "files_changed": changed_files,
            "answer": answer_text,
            "confidence": 0.5,
            "follow_up_needed": False,
            "notes": "; ".join(notes_parts),
        },
        "execution": {
            "duration_seconds": round(float(duration), 3),
            "tokens_used": None,
            "errors": [],
        },
    }


def _build_runner_failure_result(call_id: str, message: str, notes: str, duration: float) -> dict:
    return {
        "protocol": "cross-agent/v1",
        "call_id": call_id,
        "status": "failed",
        "result": {
            "summary": message,
            "files_changed": [],
            "answer": "",
            "confidence": 0,
            "follow_up_needed": True,
            "notes": notes,
        },
        "execution": {
            "duration_seconds": round(float(duration), 3),
            "tokens_used": None,
            "errors": [message],
        },
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bidirectional cross-agent subagent runner for CC and Codex."
    )
    parser.add_argument(
        "--direction",
        required=True,
        choices=["cc-to-codex", "codex-to-cc"],
        help="Call direction for the subagent invocation.",
    )
    parser.add_argument(
        "--task-type",
        required=True,
        choices=["implement", "review", "investigate", "validate", "design-question"],
        help="Type of delegated task.",
    )
    parser.add_argument(
        "--prompt",
        required=True,
        help="Natural language task prompt for the subagent.",
    )
    parser.add_argument(
        "--working-dir",
        required=True,
        help="Repository working directory for invocation.",
    )
    parser.add_argument(
        "--owned-paths",
        nargs="*",
        default=[],
        help="Optional owned-path glob constraints.",
    )
    parser.add_argument(
        "--read-only",
        action="store_true",
        help="Set read-only constraint in the task payload.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Subagent timeout in seconds (default: {DEFAULT_TIMEOUT_SECONDS}).",
    )
    parser.add_argument(
        "--depth",
        type=int,
        default=DEFAULT_DEPTH,
        help=f"Current recursion depth (default: {DEFAULT_DEPTH}).",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=DEFAULT_MAX_DEPTH,
        help=f"Maximum allowed recursion depth (default: {DEFAULT_MAX_DEPTH}).",
    )
    parser.add_argument(
        "--codex-bin",
        default=DEFAULT_CODEX_BIN,
        help=f"Codex binary/command (default: {DEFAULT_CODEX_BIN}).",
    )
    parser.add_argument(
        "--claude-bin",
        default=DEFAULT_CLAUDE_BIN,
        help=f"Claude binary/command (default: {DEFAULT_CLAUDE_BIN}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print assembled prompt and exit without running subagent.",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv[1:])
    working_dir = os.path.abspath(args.working_dir)
    state_dir = os.path.join(working_dir, "state")
    cross_agent_dir = os.path.join(state_dir, "cross-agent")

    try:
        os.makedirs(cross_agent_dir, exist_ok=True)
    except OSError as exc:
        fallback_call_id = generate_call_id()
        fallback_result = _build_runner_failure_result(
            call_id=fallback_call_id,
            message="Unable to create state/cross-agent directory",
            notes=str(exc),
            duration=0,
        )
        fallback_state_dir = os.path.join(os.getcwd(), "state")
        fallback_result_path = os.path.join(
            fallback_state_dir, "cross-agent", f"{fallback_call_id}.result.json"
        )
        try:
            _write_json_atomic(fallback_result_path, fallback_result)
        except OSError:
            pass
        print(json.dumps(fallback_result, indent=2))
        sys.exit(1)

    global _CHECK_DEPTH_STATE_DIR
    _CHECK_DEPTH_STATE_DIR = state_dir
    check_depth(int(args.depth), int(args.max_depth))

    call_id = generate_call_id()
    request_path = os.path.join(cross_agent_dir, f"{call_id}.request.json")
    result_path = os.path.join(cross_agent_dir, f"{call_id}.result.json")

    envelope: dict | None = None
    result: dict = {}
    duration = 0.0
    start = 0.0

    try:
        cli_cmd = resolve_cli_binary(args.direction, args.codex_bin, args.claude_bin)
    except SystemExit:
        envelope = build_envelope(args, call_id)
        result = _build_runner_failure_result(
            call_id=call_id,
            message="Unable to resolve subagent CLI binary",
            notes="Check --codex-bin/--claude-bin and PATH",
            duration=0,
        )
        try:
            _write_json_atomic(result_path, result)
        except OSError:
            pass
        try:
            log_call(state_dir, envelope, result, 0)
        except OSError:
            pass
        print(json.dumps(result, indent=2))
        sys.exit(1)

    try:
        envelope = build_envelope(args, call_id)
        payload = build_payload(args)

        request_payload = {
            "envelope": envelope,
            "payload": payload,
            "created_at": now_iso(),
        }
        _write_json_atomic(request_path, request_payload)

        preamble_dir = os.path.join(
            working_dir, "dispatch", "prompts", "subagent-preambles"
        )
        assembled_prompt = assemble_prompt(
            direction=args.direction,
            payload=payload,
            result_file=to_forward_slashes(result_path),
            preamble_dir=preamble_dir,
            call_id=call_id,
            depth=int(args.depth),
            max_depth=int(args.max_depth),
        )

        if args.dry_run:
            print(assembled_prompt)
            return

        before_snapshot = _capture_file_snapshot(working_dir)
        start = time.time()
        exit_code, stdout_text, stderr_text = invoke_subagent(
            cli_cmd=cli_cmd,
            direction=args.direction,
            assembled_prompt=assembled_prompt,
            working_dir=working_dir,
            timeout=int(args.timeout),
        )
        duration = time.time() - start

        global _LAST_SUBPROCESS_STDERR
        _LAST_SUBPROCESS_STDERR = stderr_text or ""

        result = parse_result(call_id, state_dir)
        if not os.path.exists(result_path):
            try:
                _write_json_atomic(result_path, result)
            except OSError:
                pass

        status = str(result.get("status", "failed"))
        if exit_code == -1:
            result = _build_timeout_result(
                call_id=call_id,
                timeout=int(args.timeout),
                duration=duration,
                stderr_text=stderr_text,
            )
            _write_json_atomic(result_path, result)
        elif status == "failed" and exit_code == 0:
            changed_files = _detect_changed_files(
                before_snapshot=before_snapshot,
                working_dir=working_dir,
                owned_paths=list(args.owned_paths or []),
            )
            if changed_files or stdout_text.strip():
                result = _build_synthetic_completed_result(
                    call_id=call_id,
                    task_type=args.task_type,
                    stdout_text=stdout_text,
                    stderr_text=stderr_text,
                    changed_files=changed_files,
                    duration=duration,
                )
                _write_json_atomic(result_path, result)

        log_call(state_dir, envelope, result, duration)
        print(json.dumps(result, indent=2))
        sys.exit(0 if result.get("status") == "completed" else 1)

    except (FileNotFoundError, json.JSONDecodeError, subprocess.TimeoutExpired, OSError) as exc:
        if start:
            duration = time.time() - start
        if envelope is None:
            envelope = build_envelope(args, call_id)
        result = _build_runner_failure_result(
            call_id=call_id,
            message="Cross-agent runner encountered an error",
            notes=str(exc),
            duration=duration,
        )
        try:
            _write_json_atomic(result_path, result)
        except OSError:
            pass
        try:
            log_call(state_dir, envelope, result, duration)
        except OSError:
            pass
        print(json.dumps(result, indent=2))
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        if start:
            duration = time.time() - start
        if envelope is None:
            envelope = build_envelope(args, call_id)
        result = _build_runner_failure_result(
            call_id=call_id,
            message="Cross-agent runner failed unexpectedly",
            notes=str(exc),
            duration=duration,
        )
        try:
            _write_json_atomic(result_path, result)
        except OSError:
            pass
        try:
            log_call(state_dir, envelope, result, duration)
        except OSError:
            pass
        print(json.dumps(result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()

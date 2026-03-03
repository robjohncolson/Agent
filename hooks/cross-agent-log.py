#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


DEFAULT_STATE_DIR = Path("C:/Users/rober/Downloads/Projects/Agent/state")


def _default_log():
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


def _debug(message):
    try:
        sys.stderr.write(f"{message}\n")
    except Exception:
        pass


def _int_value(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _float_value(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def _text_value(value, default=""):
    if value is None:
        return default
    try:
        return str(value)
    except Exception:
        return default


def _list_value(value):
    if isinstance(value, list):
        return value
    return []


def _normalize_summary(summary):
    defaults = _default_log()["summary"]
    if not isinstance(summary, dict):
        return defaults

    return {
        "total_calls": _int_value(summary.get("total_calls"), 0),
        "cc_to_codex": _int_value(summary.get("cc_to_codex"), 0),
        "codex_to_cc": _int_value(summary.get("codex_to_cc"), 0),
        "completed": _int_value(summary.get("completed"), 0),
        "failed": _int_value(summary.get("failed"), 0),
        "refused": _int_value(summary.get("refused"), 0),
        "avg_duration_seconds": _float_value(
            summary.get("avg_duration_seconds"), defaults["avg_duration_seconds"]
        ),
    }


def _normalize_log(log_data):
    defaults = _default_log()
    if not isinstance(log_data, dict):
        return defaults

    calls = log_data.get("calls")
    if not isinstance(calls, list):
        calls = []

    return {
        "version": 1,
        "calls": calls,
        "summary": _normalize_summary(log_data.get("summary")),
    }


def _state_dir_path():
    override = _text_value(os.environ.get("AGENT_STATE_DIR"), "").strip()
    if override:
        return Path(override)
    return DEFAULT_STATE_DIR


def load_log(state_dir: str) -> dict:
    path = Path(state_dir) / "cross-agent-log.json"
    if not path.exists():
        return _default_log()

    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = handle.read()
    except Exception:
        return _default_log()

    if not raw.strip():
        return _default_log()

    try:
        data = json.loads(raw)
    except Exception:
        return _default_log()

    return _normalize_log(data)


def save_log(state_dir: str, log: dict) -> None:
    state_path = Path(state_dir)
    final_path = state_path / "cross-agent-log.json"
    tmp_path = state_path / "cross-agent-log.json.tmp"
    state_path.mkdir(parents=True, exist_ok=True)

    try:
        with tmp_path.open("w", encoding="utf-8") as handle:
            json.dump(log, handle, indent=2)
            handle.write("\n")
        os.replace(tmp_path, final_path)
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        raise


def update_summary(summary: dict, direction: str, status: str, duration: float) -> None:
    if not isinstance(summary, dict):
        return

    previous_total = _int_value(summary.get("total_calls"), 0)
    previous_avg = _float_value(summary.get("avg_duration_seconds"), 0.0)
    total = previous_total + 1
    summary["total_calls"] = total

    summary.setdefault("cc_to_codex", 0)
    summary.setdefault("codex_to_cc", 0)
    summary.setdefault("completed", 0)
    summary.setdefault("failed", 0)
    summary.setdefault("refused", 0)

    if direction == "cc-to-codex":
        summary["cc_to_codex"] = _int_value(summary.get("cc_to_codex"), 0) + 1
    elif direction == "codex-to-cc":
        summary["codex_to_cc"] = _int_value(summary.get("codex_to_cc"), 0) + 1

    if status == "completed":
        summary["completed"] = _int_value(summary.get("completed"), 0) + 1
    elif status == "failed":
        summary["failed"] = _int_value(summary.get("failed"), 0) + 1
    elif status == "refused":
        summary["refused"] = _int_value(summary.get("refused"), 0) + 1

    duration_value = _float_value(duration, 0.0)
    summary["avg_duration_seconds"] = ((previous_avg * (total - 1)) + duration_value) / total


def _handle_request(event):
    call_id = _text_value(event.get("call_id"), "unknown")
    direction = _text_value(event.get("direction"), "unknown")
    prompt_summary = _text_value(event.get("prompt_summary"), "")

    depth = event.get("depth")
    max_depth = event.get("max_depth")
    if max_depth is not None:
        depth_value = _int_value(depth, 0)
        max_depth_value = _int_value(max_depth, 0)
        if depth_value >= max_depth_value:
            _debug(
                f"[cross-agent] Warning: depth {depth_value} reached max_depth {max_depth_value} "
                f"for call {call_id}"
            )

    _debug(f"[cross-agent] Starting {direction} call {call_id}: {prompt_summary}")
    # TODO: Add configurable user notification support for request events.


def _handle_result(event):
    state_dir = _state_dir_path()
    call_id = _text_value(event.get("call_id"), "unknown")
    direction = _text_value(event.get("direction"), "unknown")
    task_type = _text_value(event.get("task_type"), "")
    status = _text_value(event.get("status"), "")
    duration = _float_value(event.get("duration_seconds"), 0.0)
    timestamp = _text_value(event.get("timestamp"), "")
    depth = _int_value(event.get("depth"), 0)
    files_changed = _list_value(event.get("files_changed"))
    prompt_summary = _text_value(event.get("prompt_summary"), "")

    log_data = load_log(state_dir.as_posix())
    log_entry = {
        "call_id": call_id,
        "direction": direction,
        "task_type": task_type,
        "prompt_summary": prompt_summary,
        "status": status,
        "duration_seconds": duration,
        "timestamp": timestamp,
        "files_changed": files_changed,
        "depth": depth,
    }
    log_data.setdefault("calls", []).append(log_entry)

    summary = log_data.get("summary")
    if not isinstance(summary, dict):
        summary = _default_log()["summary"]
        log_data["summary"] = summary
    update_summary(summary, direction, status, duration)

    save_log(state_dir.as_posix(), log_data)
    _debug(f"[cross-agent] Completed {direction} call {call_id}: {status} ({duration}s)")


def main() -> None:
    if len(sys.argv) < 2:
        return

    raw_input = _text_value(sys.argv[1], "")
    try:
        event = json.loads(raw_input)
    except Exception:
        _debug(f"[cross-agent] Unknown event or malformed input: {raw_input[:200]}")
        return

    if not isinstance(event, dict):
        _debug(f"[cross-agent] Unknown event or malformed input: {raw_input[:200]}")
        return

    event_name = event.get("event")

    try:
        if event_name == "request":
            _handle_request(event)
            return
        if event_name == "result":
            _handle_result(event)
            return
    except Exception as exc:
        _debug(f"[cross-agent] Error handling event: {exc}")
        return

    _debug(f"[cross-agent] Unknown event or malformed input: {raw_input[:200]}")
    return


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        _debug(f"[cross-agent] Unexpected error: {exc}")
    raise SystemExit(0)

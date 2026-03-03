#!/usr/bin/env python3
import json
import os
import re
import sys
from datetime import datetime, timezone


PHASE_FILE_RE = re.compile(r"(?i)(?P<file>(?:[\w.\-\\/]+)?phase-\d+[\w.\-]*\.md)")
PHASE_NUMBER_RE = re.compile(r"(?i)\bphase[\s_-]*0*(?P<num>\d+)\b(?:\s*(?:complete|completed))?")


def now_utc_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def debug(message):
    try:
        sys.stderr.write(f"{message}\n")
    except Exception:
        pass


def one_line(value, max_len=240):
    text = "" if value is None else str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def detect_project(cwd):
    if not cwd:
        return "unknown"
    normalized = os.path.normpath(str(cwd))
    cleaned = normalized.rstrip("\\/")
    base = os.path.basename(cleaned)
    return base or cleaned or "unknown"


def flatten_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        pieces = [flatten_text(item) for item in value]
        return "\n".join(piece for piece in pieces if piece)
    if isinstance(value, dict):
        pieces = []
        for key in ("role", "type", "text", "content", "message", "prompt", "input"):
            if key in value:
                text = flatten_text(value.get(key))
                if text:
                    pieces.append(f"{key}: {text}")
        if pieces:
            return "\n".join(pieces)
        try:
            return json.dumps(value, sort_keys=True)
        except Exception:
            return str(value)
    return str(value)


def extract_phase_number(text):
    if not text:
        return None
    match = PHASE_NUMBER_RE.search(str(text))
    if not match:
        return None
    return int(match.group("num"))


def extract_phase_info(last_assistant_message, input_messages):
    sources = []
    if last_assistant_message:
        sources.append(("assistant", str(last_assistant_message)))

    input_text = flatten_text(input_messages)
    if input_text:
        sources.append(("input", input_text))

    for source_name, text in sources:
        file_match = PHASE_FILE_RE.search(text)
        if file_match:
            phase_file = file_match.group("file").replace("\\", "/")
            phase_num = extract_phase_number(phase_file)
            return {
                "phase_number": phase_num,
                "phase_file": phase_file,
                "source": source_name,
                "raw_match": file_match.group(0),
            }

    for source_name, text in sources:
        number_match = PHASE_NUMBER_RE.search(text)
        if number_match:
            return {
                "phase_number": int(number_match.group("num")),
                "phase_file": None,
                "source": source_name,
                "raw_match": number_match.group(0),
            }

    return None


def state_defaults(timestamp):
    return {
        "phases": [],
        "last_event_at": timestamp,
        "untracked_completions": [],
    }


def ensure_state_shape(state, timestamp):
    if not isinstance(state, dict):
        state = state_defaults(timestamp)
    if not isinstance(state.get("phases"), list):
        state["phases"] = []
    if not isinstance(state.get("untracked_completions"), list):
        state["untracked_completions"] = []
    if not state.get("last_event_at"):
        state["last_event_at"] = timestamp
    return state


def append_log(log_path, line):
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(one_line(line, max_len=2000) + "\n")
    except Exception as exc:
        debug(f"[codex-notify] failed to write notify.log: {exc}")


def load_progress(progress_path, timestamp, log_path):
    if not os.path.exists(progress_path):
        return state_defaults(timestamp)

    try:
        with open(progress_path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except Exception as exc:
        append_log(log_path, f"[{timestamp}] error read-progress path={progress_path} err={exc}")
        return state_defaults(timestamp)

    if not raw.strip():
        return state_defaults(timestamp)

    try:
        state = json.loads(raw)
    except Exception as exc:
        append_log(log_path, f"[{timestamp}] error malformed-progress-json err={exc}")
        return state_defaults(timestamp)

    return ensure_state_shape(state, timestamp)


def atomic_write_json(path, payload):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        raise


def phase_number_from_entry(entry):
    if not isinstance(entry, dict):
        return None

    index_value = entry.get("index")
    if isinstance(index_value, int):
        return index_value
    if isinstance(index_value, str) and index_value.isdigit():
        return int(index_value)

    for key in ("phase", "phase_number", "id", "name", "title", "file"):
        value = entry.get(key)
        if value is None:
            continue
        match = PHASE_NUMBER_RE.search(str(value))
        if match:
            return int(match.group("num"))
    return None


def find_phase_entry(phases, phase_info):
    if not isinstance(phases, list):
        return None

    phase_file = (phase_info or {}).get("phase_file")
    phase_number = (phase_info or {}).get("phase_number")

    if phase_file:
        target_full = phase_file.lower()
        target_base = os.path.basename(phase_file).lower()
        for entry in phases:
            if not isinstance(entry, dict):
                continue
            candidate = entry.get("file")
            if not candidate:
                continue
            candidate_text = str(candidate).replace("\\", "/")
            if candidate_text.lower() == target_full:
                return entry
            if os.path.basename(candidate_text).lower() == target_base:
                return entry

    if phase_number is not None:
        for entry in phases:
            if phase_number_from_entry(entry) == phase_number:
                return entry

    return None


def upsert_phase_completion(state, phase_info, timestamp, thread_id, project):
    phases = state.get("phases")
    if not isinstance(phases, list):
        phases = []
        state["phases"] = phases

    entry = find_phase_entry(phases, phase_info)
    created = False

    if entry is None:
        entry = {}
        phase_number = phase_info.get("phase_number")
        phase_file = phase_info.get("phase_file")
        if phase_number is not None:
            entry["index"] = phase_number
            entry["name"] = f"Phase {phase_number}"
            entry["id"] = f"phase-{phase_number}"
        if phase_file:
            entry["file"] = phase_file
        phases.append(entry)
        created = True

    entry["status"] = "completed"
    entry["completed_at"] = timestamp
    entry["thread_id"] = thread_id
    entry["project"] = project

    if entry.get("started_at") is not None or "finished_at" in entry:
        entry["finished_at"] = timestamp

    if phase_info.get("phase_file") and not entry.get("file"):
        entry["file"] = phase_info["phase_file"]
    if phase_info.get("phase_number") is not None and entry.get("index") is None:
        entry["index"] = phase_info["phase_number"]

    return entry, created


def build_paths():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    state_dir = os.path.join(repo_root, "state")
    progress_path = os.path.join(state_dir, "codex-progress.json")
    log_path = os.path.join(state_dir, "codex-logs", "notify.log")
    return repo_root, progress_path, log_path


def main():
    _, progress_path, log_path = build_paths()
    timestamp = now_utc_iso()

    if len(sys.argv) < 2:
        return 0

    raw_arg = sys.argv[1]
    try:
        event = json.loads(raw_arg)
    except Exception as exc:
        append_log(log_path, f"[{timestamp}] error malformed-event-json err={exc} raw={one_line(raw_arg)}")
        debug(f"[codex-notify] malformed event json: {exc}")
        return 0

    if not isinstance(event, dict):
        return 0

    event_type = event.get("type")
    if event_type != "agent-turn-complete":
        return 0

    thread_id = event.get("thread-id") or event.get("thread_id") or "unknown"
    cwd = event.get("cwd") or ""
    project = detect_project(cwd)
    last_message = event.get("last-assistant-message") or event.get("last_assistant_message") or ""
    input_messages = event.get("input-messages") or event.get("input_messages") or []

    state = load_progress(progress_path, timestamp, log_path)
    state["last_event_at"] = timestamp
    if not state.get("project") or state.get("project") == "unset":
        state["project"] = project

    phase_info = extract_phase_info(last_message, input_messages)

    if phase_info:
        entry, created = upsert_phase_completion(state, phase_info, timestamp, thread_id, project)
        phase_label = phase_info.get("phase_file") or f"Phase {phase_info.get('phase_number')}"
        summary_line = (
            f"[{timestamp}] tracked completion project={project} phase={phase_label} "
            f"thread={thread_id} created={str(created).lower()} source={phase_info.get('source')}"
        )
    else:
        untracked_item = {
            "completed_at": timestamp,
            "thread_id": thread_id,
            "project": project,
            "cwd": cwd,
            "message_excerpt": one_line(last_message, max_len=180),
        }
        state.setdefault("untracked_completions", []).append(untracked_item)
        summary_line = (
            f"[{timestamp}] untracked task project={project} thread={thread_id} "
            f"cwd={one_line(cwd, max_len=120)}"
        )

    try:
        atomic_write_json(progress_path, state)
    except Exception as exc:
        append_log(log_path, f"[{timestamp}] error write-progress path={progress_path} err={exc}")
        debug(f"[codex-notify] failed writing progress file: {exc}")
        return 0

    append_log(log_path, summary_line)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        try:
            _, _, notify_log = build_paths()
            append_log(notify_log, f"[{now_utc_iso()}] error unexpected err={exc}")
            debug(f"[codex-notify] unexpected error: {exc}")
        except Exception:
            pass
        raise SystemExit(0)

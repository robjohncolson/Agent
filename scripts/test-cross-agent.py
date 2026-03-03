#!/usr/bin/env python3
"""Cross-agent integration tests using stdlib unittest only."""

import argparse
import contextlib
import importlib.util
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from collections.abc import Iterator
from unittest import mock


REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNNER_DIR = REPO_ROOT / "runner"
RUNNER_PATH = RUNNER_DIR / "cross-agent.py"

if str(RUNNER_DIR) not in sys.path:
    sys.path.insert(0, str(RUNNER_DIR))

cross_agent = None
_IMPORT_ERROR = None

try:
    import cross_agent  # type: ignore[no-redef]
except Exception as exc:  # pragma: no cover - exercised in import fallback path
    _IMPORT_ERROR = exc
    if RUNNER_PATH.exists():
        try:
            spec = importlib.util.spec_from_file_location("cross_agent", RUNNER_PATH)
            if spec is None or spec.loader is None:
                raise ImportError(f"Unable to load module spec from {RUNNER_PATH}")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            cross_agent = module
            _IMPORT_ERROR = None
        except Exception as fallback_exc:  # pragma: no cover
            _IMPORT_ERROR = fallback_exc
            cross_agent = None


RUNNER_UNAVAILABLE = cross_agent is None
SKIP_IF_NO_RUNNER = unittest.skipIf(
    RUNNER_UNAVAILABLE,
    f"cross_agent import unavailable: {_IMPORT_ERROR}",
)


def _args(**overrides) -> argparse.Namespace:
    base = {
        "direction": "cc-to-codex",
        "task_type": "implement",
        "prompt": "test prompt",
        "working_dir": ".",
        "owned_paths": [],
        "read_only": False,
        "timeout": 300,
        "depth": 0,
        "max_depth": 1,
        "codex_bin": "codex",
        "claude_bin": "claude",
        "dry_run": False,
    }
    base.update(overrides)
    return argparse.Namespace(**base)


def _load_json(path: pathlib.Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: pathlib.Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


@contextlib.contextmanager
def _temp_dir() -> Iterator[str]:
    temp_ctx = tempfile.TemporaryDirectory(
        ignore_cleanup_errors=True,
    )
    temp_path = pathlib.Path(temp_ctx.name)
    probe_path = temp_path / ".writable-probe"
    fallback_path: pathlib.Path | None = None
    using_fallback = False

    try:
        try:
            probe_path.write_text("ok", encoding="utf-8")
            probe_path.unlink(missing_ok=True)
            yield str(temp_path)
        except OSError:
            using_fallback = True
            try:
                temp_ctx.cleanup()
            except Exception:
                pass
            fallback_path = REPO_ROOT / "scripts" / f".tmp-cross-agent-{uuid.uuid4().hex}"
            fallback_path.mkdir(parents=True, exist_ok=True)
            yield str(fallback_path)
    finally:
        if using_fallback:
            if fallback_path is not None:
                shutil.rmtree(fallback_path, ignore_errors=True)
        else:
            try:
                temp_ctx.cleanup()
            except Exception:
                pass


def _result_payload(status: str, files_changed: list[str] | None = None) -> dict:
    return {
        "status": status,
        "result": {
            "files_changed": files_changed or [],
        },
    }


def _request_file(
    state_dir: pathlib.Path,
    call_id: str,
    task_type: str = "implement",
    prompt: str = "test prompt",
) -> None:
    _write_json(
        state_dir / "cross-agent" / f"{call_id}.request.json",
        {
            "payload": {
                "task_type": task_type,
                "prompt": prompt,
            }
        },
    )


class TestCrossAgent(unittest.TestCase):
    @SKIP_IF_NO_RUNNER
    def test_build_envelope_cc_to_codex(self) -> None:
        args = _args(direction="cc-to-codex")
        call_id = "a1b2c3d4e5f6"

        envelope = cross_agent.build_envelope(args, call_id)
        task_payload = cross_agent.build_payload(args)
        request_doc = {**envelope, "task": task_payload}

        schema = _load_json(REPO_ROOT / "schema" / "cross-agent-request.schema.json")
        for required_key in schema.get("required", []):
            self.assertIn(required_key, request_doc)

        self.assertEqual(envelope["direction"], "cc-to-codex")
        self.assertEqual(envelope["caller"], "claude-code")
        self.assertEqual(envelope["protocol"], "cross-agent/v1")

    @SKIP_IF_NO_RUNNER
    def test_build_envelope_codex_to_cc(self) -> None:
        args = _args(direction="codex-to-cc")
        call_id = "b1c2d3e4f5a6"

        envelope = cross_agent.build_envelope(args, call_id)
        task_payload = cross_agent.build_payload(args)
        request_doc = {**envelope, "task": task_payload}

        schema = _load_json(REPO_ROOT / "schema" / "cross-agent-request.schema.json")
        for required_key in schema.get("required", []):
            self.assertIn(required_key, request_doc)

        self.assertEqual(envelope["direction"], "codex-to-cc")
        self.assertEqual(envelope["caller"], "codex")
        self.assertEqual(envelope["protocol"], "cross-agent/v1")

    @SKIP_IF_NO_RUNNER
    def test_build_payload_task_types(self) -> None:
        expected = {
            "implement": "code-changes",
            "review": "analysis",
            "investigate": "answer",
            "validate": "analysis",
            "design-question": "answer",
        }
        for task_type, expected_output in expected.items():
            with self.subTest(task_type=task_type):
                payload = cross_agent.build_payload(_args(task_type=task_type))
                self.assertEqual(payload["task_type"], task_type)
                self.assertEqual(payload["expected_output"], expected_output)

    @SKIP_IF_NO_RUNNER
    def test_build_payload_owned_paths(self) -> None:
        payload = cross_agent.build_payload(
            _args(owned_paths=["src\\feature\\impl.py", "./tests/test_impl.py"])
        )
        self.assertEqual(
            payload["constraints"]["owned_paths"],
            ["src/feature/impl.py", "tests/test_impl.py"],
        )

    @SKIP_IF_NO_RUNNER
    def test_build_payload_read_only(self) -> None:
        payload = cross_agent.build_payload(_args(read_only=True))
        self.assertTrue(payload["constraints"]["read_only"])

    @SKIP_IF_NO_RUNNER
    def test_depth_zero_allowed(self) -> None:
        with _temp_dir() as temp_dir:
            with mock.patch.object(cross_agent, "_CHECK_DEPTH_STATE_DIR", temp_dir):
                cross_agent.check_depth(0, 1)

    @SKIP_IF_NO_RUNNER
    def test_depth_at_max_blocked(self) -> None:
        with _temp_dir() as temp_dir:
            with mock.patch.object(cross_agent, "_CHECK_DEPTH_STATE_DIR", temp_dir):
                with mock.patch.object(
                    cross_agent, "generate_call_id", return_value="deadbeefcafe"
                ):
                    with self.assertRaises(SystemExit) as ctx:
                        cross_agent.check_depth(1, 1)
            refusal_path = (
                pathlib.Path(temp_dir) / "cross-agent" / "deadbeefcafe.result.json"
            )
            self.assertTrue(refusal_path.exists())
            refusal_payload = _load_json(refusal_path)
            self.assertEqual(refusal_payload["status"], "refused")

        self.assertEqual(ctx.exception.code, 0)

    @SKIP_IF_NO_RUNNER
    def test_depth_above_max_blocked(self) -> None:
        with _temp_dir() as temp_dir:
            with mock.patch.object(cross_agent, "_CHECK_DEPTH_STATE_DIR", temp_dir):
                with mock.patch.object(
                    cross_agent, "generate_call_id", return_value="facefeedbead"
                ):
                    with self.assertRaises(SystemExit) as ctx:
                        cross_agent.check_depth(2, 1)
        self.assertEqual(ctx.exception.code, 0)

    @SKIP_IF_NO_RUNNER
    def test_assemble_prompt_cc_to_codex(self) -> None:
        with _temp_dir() as temp_dir:
            preamble_dir = pathlib.Path(temp_dir)
            (preamble_dir / "codex-as-subagent.md").write_text(
                "# Codex Preamble {call_id}\n{task_payload}\n",
                encoding="utf-8",
            )
            payload = cross_agent.build_payload(_args())
            prompt = cross_agent.assemble_prompt(
                direction="cc-to-codex",
                payload=payload,
                result_file="C:/tmp/result.json",
                preamble_dir=str(preamble_dir),
                call_id="feedfacecafe",
            )

        self.assertTrue(prompt.startswith("# Codex Preamble feedfacecafe"))
        self.assertNotIn("{call_id}", prompt)
        self.assertIn('"task_type": "implement"', prompt)
        self.assertIn('"prompt": "test prompt"', prompt)

    @SKIP_IF_NO_RUNNER
    def test_assemble_prompt_codex_to_cc(self) -> None:
        with _temp_dir() as temp_dir:
            preamble_dir = pathlib.Path(temp_dir)
            (preamble_dir / "cc-as-subagent.md").write_text(
                "# CC Preamble {call_id}\n{task_payload}\n",
                encoding="utf-8",
            )
            payload = cross_agent.build_payload(_args(task_type="design-question"))
            prompt = cross_agent.assemble_prompt(
                direction="codex-to-cc",
                payload=payload,
                result_file="C:/tmp/result.json",
                preamble_dir=str(preamble_dir),
                call_id="cafebabefeed",
            )

        self.assertTrue(prompt.startswith("# CC Preamble cafebabefeed"))
        self.assertNotIn("{call_id}", prompt)
        self.assertIn('"task_type": "design-question"', prompt)
        self.assertIn('"prompt": "test prompt"', prompt)

    @SKIP_IF_NO_RUNNER
    def test_assemble_prompt_missing_preamble(self) -> None:
        payload = cross_agent.build_payload(_args())
        prompt = cross_agent.assemble_prompt(
            direction="cc-to-codex",
            payload=payload,
            result_file="C:/tmp/result.json",
            preamble_dir=str(REPO_ROOT / "does-not-exist"),
            call_id="123456abcdef",
        )

        self.assertIn("You are Codex, invoked as a subagent by Claude Code.", prompt)
        self.assertIn('"task_type": "implement"', prompt)

    @SKIP_IF_NO_RUNNER
    def test_parse_result_valid(self) -> None:
        call_id = "112233aabbcc"
        valid_result = {
            "protocol": "cross-agent/v1",
            "call_id": call_id,
            "status": "completed",
            "result": {
                "summary": "ok",
                "files_changed": [],
                "answer": "",
                "confidence": 1.0,
                "follow_up_needed": False,
                "notes": "",
            },
            "execution": {
                "duration_seconds": 1,
                "tokens_used": None,
                "errors": [],
            },
        }
        with _temp_dir() as temp_dir:
            _write_json(
                pathlib.Path(temp_dir) / "cross-agent" / f"{call_id}.result.json",
                valid_result,
            )
            parsed = cross_agent.parse_result(call_id, temp_dir)
        self.assertEqual(parsed, valid_result)

    @SKIP_IF_NO_RUNNER
    def test_parse_result_missing_file(self) -> None:
        call_id = "aabbccddeeff"
        with _temp_dir() as temp_dir:
            with mock.patch.object(
                cross_agent, "_LAST_SUBPROCESS_STDERR", "missing result stderr"
            ):
                parsed = cross_agent.parse_result(call_id, temp_dir)
        self.assertEqual(parsed["status"], "failed")
        self.assertEqual(parsed["call_id"], call_id)
        self.assertIn("missing result stderr", parsed["result"]["notes"])

    @SKIP_IF_NO_RUNNER
    def test_parse_result_corrupt_json(self) -> None:
        call_id = "ffeeddccbbaa"
        with _temp_dir() as temp_dir:
            result_path = pathlib.Path(temp_dir) / "cross-agent" / f"{call_id}.result.json"
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text("{not:json", encoding="utf-8")
            with mock.patch.object(
                cross_agent, "_LAST_SUBPROCESS_STDERR", "corrupt result stderr"
            ):
                parsed = cross_agent.parse_result(call_id, temp_dir)
        self.assertEqual(parsed["status"], "failed")
        self.assertIn("corrupt result stderr", parsed["result"]["notes"])

    @SKIP_IF_NO_RUNNER
    def test_log_call_creates_file(self) -> None:
        call_id = "abcdeffedcba"
        with _temp_dir() as temp_dir:
            state_dir = pathlib.Path(temp_dir)
            _request_file(state_dir, call_id, task_type="implement", prompt="first call")

            envelope = {"call_id": call_id, "direction": "cc-to-codex", "depth": 0}
            result = _result_payload("completed", ["src/a.py"])
            cross_agent.log_call(str(state_dir), envelope, result, 9.5)

            log_path = state_dir / "cross-agent-log.json"
            self.assertTrue(log_path.exists())
            log_data = _load_json(log_path)

        self.assertEqual(log_data["version"], 1)
        self.assertEqual(len(log_data["calls"]), 1)
        self.assertEqual(log_data["calls"][0]["call_id"], call_id)
        self.assertEqual(log_data["summary"]["total_calls"], 1)

    @SKIP_IF_NO_RUNNER
    def test_log_call_appends(self) -> None:
        with _temp_dir() as temp_dir:
            state_dir = pathlib.Path(temp_dir)

            _request_file(state_dir, "111111aaaaaa", task_type="implement", prompt="first")
            _request_file(state_dir, "222222bbbbbb", task_type="review", prompt="second")

            cross_agent.log_call(
                str(state_dir),
                {"call_id": "111111aaaaaa", "direction": "cc-to-codex", "depth": 0},
                _result_payload("completed", ["a.py"]),
                4,
            )
            cross_agent.log_call(
                str(state_dir),
                {"call_id": "222222bbbbbb", "direction": "codex-to-cc", "depth": 0},
                _result_payload("failed", []),
                8,
            )

            log_data = _load_json(state_dir / "cross-agent-log.json")

        self.assertEqual(len(log_data["calls"]), 2)
        self.assertEqual(log_data["summary"]["total_calls"], 2)

    @SKIP_IF_NO_RUNNER
    def test_log_call_summary_counters(self) -> None:
        with _temp_dir() as temp_dir:
            state_dir = pathlib.Path(temp_dir)

            _request_file(state_dir, "333333cccccc", task_type="implement", prompt="ok")
            _request_file(state_dir, "444444dddddd", task_type="review", prompt="bad")

            cross_agent.log_call(
                str(state_dir),
                {"call_id": "333333cccccc", "direction": "cc-to-codex", "depth": 0},
                _result_payload("completed", ["x.py"]),
                5,
            )
            cross_agent.log_call(
                str(state_dir),
                {"call_id": "444444dddddd", "direction": "codex-to-cc", "depth": 0},
                _result_payload("failed", []),
                7,
            )

            summary = _load_json(state_dir / "cross-agent-log.json")["summary"]

        self.assertEqual(summary["total_calls"], 2)
        self.assertEqual(summary["cc_to_codex"], 1)
        self.assertEqual(summary["codex_to_cc"], 1)
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["refused"], 0)

    @SKIP_IF_NO_RUNNER
    def test_log_call_avg_duration(self) -> None:
        with _temp_dir() as temp_dir:
            state_dir = pathlib.Path(temp_dir)
            _request_file(state_dir, "555555eeeeee", prompt="a")
            _request_file(state_dir, "666666ffffff", prompt="b")

            cross_agent.log_call(
                str(state_dir),
                {"call_id": "555555eeeeee", "direction": "cc-to-codex", "depth": 0},
                _result_payload("completed", []),
                10,
            )
            cross_agent.log_call(
                str(state_dir),
                {"call_id": "666666ffffff", "direction": "cc-to-codex", "depth": 0},
                _result_payload("completed", []),
                20,
            )

            avg_duration = _load_json(state_dir / "cross-agent-log.json")["summary"][
                "avg_duration_seconds"
            ]

        self.assertAlmostEqual(avg_duration, 15)

    def test_request_schema_valid(self) -> None:
        schema = _load_json(REPO_ROOT / "schema" / "cross-agent-request.schema.json")
        self.assertIn("$schema", schema)
        self.assertIn("properties", schema)
        self.assertIn("required", schema)
        for field in ["protocol", "direction", "caller", "context", "task"]:
            self.assertIn(field, schema["properties"])

    def test_result_schema_valid(self) -> None:
        schema = _load_json(REPO_ROOT / "schema" / "cross-agent-result.schema.json")
        self.assertIn("$schema", schema)
        self.assertIn("properties", schema)
        self.assertIn("required", schema)
        for field in ["protocol", "call_id", "status", "result", "execution"]:
            self.assertIn(field, schema["properties"])

    def test_log_schema_valid(self) -> None:
        schema = _load_json(REPO_ROOT / "schema" / "cross-agent-log.schema.json")
        self.assertIn("$schema", schema)
        self.assertIn("properties", schema)
        self.assertIn("required", schema)
        for field in ["version", "calls", "summary"]:
            self.assertIn(field, schema["properties"])

    def test_e2e_dry_run_cc_to_codex(self) -> None:
        command = [
            sys.executable,
            str(RUNNER_PATH),
            "--direction",
            "cc-to-codex",
            "--task-type",
            "implement",
            "--prompt",
            "test task",
            "--working-dir",
            str(REPO_ROOT),
            "--codex-bin",
            sys.executable,
            "--dry-run",
        ]

        completed = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertTrue(completed.stdout.strip())
        self.assertIn("You are Codex, invoked as a subagent by Claude Code.", completed.stdout)
        self.assertIn('"task_type": "implement"', completed.stdout)
        self.assertIn("test task", completed.stdout)

    def test_e2e_dry_run_codex_to_cc(self) -> None:
        command = [
            sys.executable,
            str(RUNNER_PATH),
            "--direction",
            "codex-to-cc",
            "--task-type",
            "implement",
            "--prompt",
            "test task",
            "--working-dir",
            str(REPO_ROOT),
            "--claude-bin",
            sys.executable,
            "--dry-run",
        ]

        completed = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, msg=completed.stderr)
        self.assertTrue(completed.stdout.strip())
        self.assertIn("You are Claude Code, invoked as a subagent by a Codex instance.", completed.stdout)
        self.assertIn('"task_type": "implement"', completed.stdout)
        self.assertIn("test task", completed.stdout)


if __name__ == "__main__":
    unittest.main()

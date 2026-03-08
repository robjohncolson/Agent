#!/usr/bin/env python3
"""Phase 5 parallel executor runner with branch-per-agent orchestration."""

from __future__ import annotations

import argparse
import concurrent.futures
import fnmatch
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any


DEFAULT_MANIFEST = "dispatch/parallel-batch.manifest.json"
DEFAULT_STATE_FILE = "state/parallel-batch.json"
DEFAULT_ERROR_LOG = "state/parallel-runner-errors.log"
DEFAULT_LOG_DIR = "state/parallel-codex-logs"
DEFAULT_WORKTREE_ROOT = "state/parallel-worktrees"
DEFAULT_CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
DEFAULT_CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
DEFAULT_CLAUDE_ALLOWED_TOOLS = "Edit,Read,Write,Bash,Glob,Grep"

AGENT_TERMINAL_STATES = {"pending", "running", "completed", "failed", "blocked", "merged"}


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def normalize_repo_path(value: str) -> str:
    cleaned = value.replace("\\", "/")
    cleaned = re.sub(r"^\./", "", cleaned)
    cleaned = re.sub(r"/+", "/", cleaned)
    return cleaned.strip("/")


def to_forward_slashes(value: str) -> str:
    return value.replace("\\", "/")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    return slug.strip("-")


def shell_wrapper(command: str) -> list[str]:
    if os.name == "nt":
        return ["powershell", "-NoProfile", "-Command", command]
    return ["bash", "-lc", command]


def _resolve_codex_on_windows(codex_bin: str) -> list[str]:
    """On Windows, npm global installs create .cmd shims that don't work with
    subprocess.Popen + stdin=PIPE.  Resolve the underlying node entry point."""
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


def parse_codex_bin(codex_bin: str) -> list[str]:
    try:
        parts = shlex.split(codex_bin, posix=(os.name != "nt"))
    except ValueError as exc:
        raise ValueError(f"Invalid --codex-bin value: {codex_bin}") from exc
    # On Windows, try to resolve past .cmd shims when the default "codex" is used
    if parts == ["codex"]:
        resolved = _resolve_codex_on_windows("codex")
        if resolved:
            return resolved
    return parts


def parse_claude_bin(claude_bin: str) -> list[str]:
    try:
        parts = shlex.split(claude_bin, posix=(os.name != "nt"))
    except ValueError as exc:
        raise ValueError(f"Invalid --claude-bin value: {claude_bin}") from exc
    if parts == ["claude"]:
        resolved = _resolve_claude_on_windows("claude")
        if resolved:
            return resolved
    return parts


def read_json(path: pathlib.Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return data


class RunnerError(RuntimeError):
    """Custom runner error."""


class ParallelCodexRunner:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.repo_root = self._repo_root()

        self.manifest_path = self._resolve_path(args.manifest)
        self.state_file = self._resolve_path(args.state_file)
        self.error_log = self._resolve_path(args.error_log)
        self.codex_log_dir = self._resolve_path(args.codex_log_dir)
        self.worktree_root = self._resolve_path(args.worktree_root)
        self.claude_wrapper = self._resolve_path("runner/claude-headless.sh")

        self.codex_cmd_base = parse_codex_bin(args.codex_bin)
        self.claude_cmd_base = parse_claude_bin(args.claude_bin)

        self.state_lock = threading.Lock()
        self.state: dict[str, Any] = {}
        self.manifest: dict[str, Any] = {}
        self.agents_by_name: dict[str, dict[str, Any]] = {}
        self.agent_order: list[str] = []
        self.dependency_batches: list[list[str]] = []

        self.paths_to_ignore_for_clean_check: set[str] = set()

    def _repo_root(self) -> pathlib.Path:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RunnerError("Run this script inside a git repository.")
        return pathlib.Path(result.stdout.strip()).resolve()

    def _resolve_path(self, maybe_relative: str) -> pathlib.Path:
        candidate = pathlib.Path(maybe_relative)
        if candidate.is_absolute():
            return candidate.resolve()
        return (self.repo_root / candidate).resolve()

    def _repo_rel(self, absolute_path: pathlib.Path) -> str:
        return normalize_repo_path(str(absolute_path.relative_to(self.repo_root)))

    def _run(
        self,
        command: list[str],
        *,
        cwd: pathlib.Path | None = None,
        check: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        process = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
        )
        if check and process.returncode != 0:
            rendered = " ".join(command)
            raise RunnerError(
                f"Command failed ({process.returncode}): {rendered}\n"
                f"{process.stdout}{process.stderr}"
            )
        return process

    def _run_stream(
        self,
        command: list[str],
        *,
        cwd: pathlib.Path,
        log_handle: Any,
        stdin_text: str | None = None,
        env: dict[str, str] | None = None,
    ) -> int:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            stdin=subprocess.PIPE if stdin_text is not None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            env=env,
        )

        if stdin_text is not None:
            assert process.stdin is not None
            try:
                process.stdin.write(stdin_text)
            except BrokenPipeError:
                pass
            try:
                process.stdin.close()
            except OSError:
                pass

        assert process.stdout is not None
        for line in process.stdout:
            log_handle.write(line)
        process.wait()
        return int(process.returncode)

    def _append_error_log(self, message: str) -> None:
        self.error_log.parent.mkdir(parents=True, exist_ok=True)
        with self.error_log.open("a", encoding="utf-8") as handle:
            handle.write(f"[{now_iso()}] {message}\n")

    def _refresh_summary_locked(self) -> None:
        agents = self.state.get("agents", [])
        counts = {status: 0 for status in AGENT_TERMINAL_STATES}
        for agent in agents:
            status = agent.get("status", "pending")
            if status not in counts:
                counts[status] = 0
            counts[status] += 1

        self.state["summary"] = {
            "total_agents": len(agents),
            "pending": counts.get("pending", 0),
            "running": counts.get("running", 0),
            "completed": counts.get("completed", 0),
            "merged": counts.get("merged", 0),
            "failed": counts.get("failed", 0),
            "blocked": counts.get("blocked", 0),
            "dependency_batches_total": len(self.dependency_batches),
            "dependency_batches_completed": int(self.state.get("completed_batches", 0)),
        }

    def _write_state_locked(self) -> None:
        self.state["updated_at"] = now_iso()
        self._refresh_summary_locked()
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with self.state_file.open("w", encoding="utf-8") as handle:
            json.dump(self.state, handle, indent=2)
            handle.write("\n")

    def _mutate_state(self, mutator: Any) -> None:
        with self.state_lock:
            mutator(self.state)
            self._write_state_locked()

    def _agent_state_locked(self, agent_name: str) -> dict[str, Any]:
        for agent in self.state.get("agents", []):
            if agent.get("name") == agent_name:
                return agent
        raise KeyError(f"Unknown agent in state: {agent_name}")

    def _set_global_failure(self, stage: str, message: str) -> None:
        self._append_error_log(f"stage={stage} message={message}")

        def mutate(state: dict[str, Any]) -> None:
            state["status"] = "failed"
            state["last_error"] = {
                "stage": stage,
                "message": message,
                "timestamp": now_iso(),
            }

        self._mutate_state(mutate)

    def _load_manifest(self) -> None:
        if not self.manifest_path.exists():
            raise RunnerError(f"Manifest not found: {self.manifest_path}")
        manifest = read_json(self.manifest_path)
        self.manifest = self._normalize_manifest(manifest)
        self.agents_by_name = {
            item["name"]: item for item in self.manifest.get("agents", [])
        }
        self.agent_order = [item["name"] for item in self.manifest.get("agents", [])]
        self.dependency_batches = self._compute_dependency_batches()

    def _normalize_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        required = ["version", "batch_name", "target_branch", "agents"]
        missing = [key for key in required if key not in manifest]
        if missing:
            raise RunnerError(f"Manifest missing required keys: {', '.join(missing)}")

        agents_raw = manifest.get("agents")
        if not isinstance(agents_raw, list) or not agents_raw:
            raise RunnerError("Manifest 'agents' must be a non-empty array.")

        seen_names: set[str] = set()
        seen_branches: set[str] = set()
        normalized_agents: list[dict[str, Any]] = []
        global_verify = manifest.get("verify_commands", [])
        if global_verify is None:
            global_verify = []
        if not isinstance(global_verify, list):
            raise RunnerError("'verify_commands' must be an array when provided.")

        for raw in agents_raw:
            if not isinstance(raw, dict):
                raise RunnerError("Each agent entry must be a JSON object.")
            name = str(raw.get("name", "")).strip()
            if not name:
                raise RunnerError("Agent entry is missing a valid 'name'.")
            if name in seen_names:
                raise RunnerError(f"Duplicate agent name in manifest: {name}")
            seen_names.add(name)

            prompt_file = str(raw.get("prompt_file", "")).strip()
            if not prompt_file:
                raise RunnerError(f"Agent '{name}' missing 'prompt_file'.")
            prompt_path = self._resolve_path(prompt_file)
            if not prompt_path.exists():
                raise RunnerError(
                    f"Agent '{name}' prompt_file does not exist: {prompt_file}"
                )

            branch = str(raw.get("branch", "")).strip()
            if not branch:
                branch = f"codex/{slugify(name)}"
            if branch in seen_branches:
                raise RunnerError(f"Duplicate branch in manifest: {branch}")
            seen_branches.add(branch)

            depends_on = raw.get("depends_on", [])
            if depends_on is None:
                depends_on = []
            if not isinstance(depends_on, list):
                raise RunnerError(f"Agent '{name}' depends_on must be an array.")
            depends_on_names = [str(item).strip() for item in depends_on if str(item).strip()]

            owned_paths = raw.get("owned_paths", [])
            if not isinstance(owned_paths, list) or not owned_paths:
                raise RunnerError(
                    f"Agent '{name}' must define a non-empty owned_paths array."
                )
            normalized_owned_paths = [
                normalize_repo_path(str(path)) for path in owned_paths if str(path).strip()
            ]
            if not normalized_owned_paths:
                raise RunnerError(
                    f"Agent '{name}' owned_paths must contain at least one non-empty path."
                )

            verify_commands = raw.get("verify_commands", global_verify)
            if verify_commands is None:
                verify_commands = []
            if not isinstance(verify_commands, list):
                raise RunnerError(f"Agent '{name}' verify_commands must be an array.")

            normalized_agents.append(
                {
                    "name": name,
                    "description": str(raw.get("description", "")).strip(),
                    "prompt_file": normalize_repo_path(prompt_file),
                    "prompt_file_abs": str(prompt_path),
                    "branch": branch,
                    "depends_on": depends_on_names,
                    "owned_paths": normalized_owned_paths,
                    "verify_commands": [str(item) for item in verify_commands],
                    "allow_no_changes": bool(raw.get("allow_no_changes", False)),
                    "merge_enabled": bool(raw.get("merge_enabled", True)),
                    "slug": slugify(name),
                }
            )

        names = {agent["name"] for agent in normalized_agents}
        for agent in normalized_agents:
            for dep_name in agent["depends_on"]:
                if dep_name == agent["name"]:
                    raise RunnerError(
                        f"Agent '{agent['name']}' depends on itself."
                    )
                if dep_name not in names:
                    raise RunnerError(
                        f"Agent '{agent['name']}' has unknown dependency '{dep_name}'."
                    )

        contracts = manifest.get("contracts", [])
        if contracts is None:
            contracts = []
        if not isinstance(contracts, list):
            raise RunnerError("Manifest 'contracts' must be an array.")
        self._validate_contracts(contracts, normalized_agents)

        merge_cfg = manifest.get("merge", {})
        if merge_cfg is None:
            merge_cfg = {}
        if not isinstance(merge_cfg, dict):
            raise RunnerError("Manifest 'merge' must be an object.")

        normalized = {
            "version": int(manifest["version"]),
            "batch_name": str(manifest["batch_name"]),
            "target_branch": str(manifest["target_branch"]),
            "base_ref": str(manifest.get("base_ref", manifest["target_branch"])),
            "codex_approval_mode": str(manifest.get("codex_approval_mode", "suggest")),
            "verify_commands": [str(item) for item in global_verify],
            "agents": normalized_agents,
            "contracts": contracts,
            "evidence_observations": manifest.get("evidence_observations", []),
            "cc_merge_order": manifest.get("cc_merge_order", []),
            "merge": {
                "enabled": bool(merge_cfg.get("enabled", True)),
                "branch": str(merge_cfg.get("branch", "")).strip(),
                "commit_prefix": str(
                    merge_cfg.get("commit_prefix", "CC merge pass")
                ).strip(),
                "verify_commands": [
                    str(item) for item in merge_cfg.get("verify_commands", [])
                ],
            },
        }
        return normalized

    def _validate_contracts(
        self, contracts: list[Any], agents: list[dict[str, Any]]
    ) -> None:
        if not contracts:
            return

        agent_map = {agent["name"]: agent for agent in agents}
        for contract in contracts:
            if not isinstance(contract, dict):
                raise RunnerError("Every contract must be a JSON object.")
            contract_name = str(contract.get("name", "")).strip()
            if not contract_name:
                raise RunnerError("Contract is missing 'name'.")

            producer = str(contract.get("producer_agent", "")).strip()
            consumers = contract.get("consumer_agents", [])
            if not producer or producer not in agent_map:
                raise RunnerError(
                    f"Contract '{contract_name}' has unknown producer_agent '{producer}'."
                )
            if not isinstance(consumers, list) or not consumers:
                raise RunnerError(
                    f"Contract '{contract_name}' must define non-empty consumer_agents."
                )
            consumer_names = [str(item).strip() for item in consumers if str(item).strip()]
            for consumer in consumer_names:
                if consumer not in agent_map:
                    raise RunnerError(
                        f"Contract '{contract_name}' has unknown consumer agent '{consumer}'."
                    )

            python_contract = contract.get("python")
            r_contract = contract.get("r")
            if not isinstance(python_contract, dict) or not isinstance(r_contract, dict):
                raise RunnerError(
                    f"Contract '{contract_name}' must define both 'python' and 'r' objects."
                )

            python_shape = python_contract.get("json_shape")
            r_shape = r_contract.get("json_shape")
            if python_shape != r_shape:
                raise RunnerError(
                    f"Contract '{contract_name}' python/r json_shape mismatch."
                )

            for lang, spec in (("python", python_contract), ("r", r_contract)):
                owner = str(spec.get("agent", "")).strip()
                path_value = str(spec.get("path", "")).strip()
                if owner not in agent_map:
                    raise RunnerError(
                        f"Contract '{contract_name}' {lang}.agent '{owner}' is unknown."
                    )
                if not path_value:
                    raise RunnerError(
                        f"Contract '{contract_name}' {lang}.path is required."
                    )
                normalized_contract_path = normalize_repo_path(path_value)
                owner_patterns = agent_map[owner]["owned_paths"]
                if not self._is_owned(normalized_contract_path, owner_patterns):
                    raise RunnerError(
                        f"Contract '{contract_name}' {lang}.path '{path_value}' is not owned by agent '{owner}'."
                    )

    def _compute_dependency_batches(self) -> list[list[str]]:
        pending = set(self.agent_order)
        indegree: dict[str, int] = {}
        dependents: dict[str, list[str]] = {name: [] for name in self.agent_order}

        for name in self.agent_order:
            deps = self.agents_by_name[name]["depends_on"]
            indegree[name] = len(deps)
            for dep_name in deps:
                dependents.setdefault(dep_name, []).append(name)

        batches: list[list[str]] = []
        while pending:
            ready = [name for name in self.agent_order if name in pending and indegree[name] == 0]
            if not ready:
                raise RunnerError("Dependency cycle detected in agent graph.")
            batches.append(ready)
            for completed in ready:
                pending.remove(completed)
                for dependent in dependents.get(completed, []):
                    indegree[dependent] -= 1
        return batches

    def _init_state(self) -> None:
        if self.args.reset and self.state_file.exists():
            self.state_file.unlink()

        self.state = {
            "$schema": "../schema/parallel-batch-state.schema.json",
            "version": 1,
            "batch_name": self.manifest["batch_name"],
            "status": "idle",
            "target_branch": self.manifest["target_branch"],
            "base_ref": self.manifest["base_ref"],
            "manifest_file": self._repo_rel(self.manifest_path),
            "evidence_observations": self.manifest.get("evidence_observations", []),
            "dependency_batches": self.dependency_batches,
            "current_batch": None,
            "completed_batches": 0,
            "last_error": None,
            "updated_at": now_iso(),
            "agents": [],
            "merge": {
                "status": "pending",
                "branch": None,
                "started_at": None,
                "finished_at": None,
                "merged_agents": [],
                "verify_results": [],
                "commit": None,
                "error": None,
            },
            "summary": {},
        }

        for agent_name in self.agent_order:
            agent = self.agents_by_name[agent_name]
            self.state["agents"].append(
                {
                    "name": agent_name,
                    "branch": agent["branch"],
                    "status": "pending",
                    "depends_on": agent["depends_on"],
                    "owned_paths": agent["owned_paths"],
                    "prompt_file": agent["prompt_file"],
                    "verify_commands": agent["verify_commands"],
                    "attempts": 0,
                    "started_at": None,
                    "finished_at": None,
                    "commit": None,
                    "worktree": None,
                    "codex_log": None,
                    "verify_results": [],
                    "blocked_by": [],
                    "error": None,
                }
            )

        with self.state_lock:
            self._write_state_locked()

    def _is_owned(self, path_value: str, owned_patterns: list[str]) -> bool:
        normalized = normalize_repo_path(path_value)
        for pattern in owned_patterns:
            normalized_pattern = normalize_repo_path(pattern)
            if fnmatch.fnmatch(normalized, normalized_pattern):
                return True
        return False

    def _verify_clean_worktree(self) -> None:
        result = self._run(["git", "status", "--porcelain"], cwd=self.repo_root, check=True)
        dirty_paths = []
        for raw_line in result.stdout.splitlines():
            if len(raw_line) < 4:
                continue
            raw_path = raw_line[3:]
            if " -> " in raw_path:
                raw_path = raw_path.split(" -> ", maxsplit=1)[1]
            candidate = normalize_repo_path(raw_path)
            if not candidate:
                continue
            if candidate in self.paths_to_ignore_for_clean_check:
                continue
            if any(
                candidate == ignore or candidate.startswith(f"{ignore}/")
                for ignore in self.paths_to_ignore_for_clean_check
            ):
                continue
            dirty_paths.append(candidate)

        if dirty_paths:
            raise RunnerError(
                "Worktree has uncommitted changes outside runner artifacts:\n"
                + "\n".join(sorted(set(dirty_paths)))
            )

    def _resolve_start_ref(self, agent: dict[str, Any]) -> str:
        """Determine the git ref an agent's worktree should start from.

        If the agent has dependencies, start from the first completed
        dependency's branch so the worktree includes upstream changes.
        Additional dependencies are merged in after worktree creation.
        """
        deps = agent.get("depends_on", [])
        if not deps:
            return self.manifest["base_ref"]
        # Use the first dependency's branch as the base
        first_dep = self.agents_by_name[deps[0]]
        return first_dep["branch"]

    def _prepare_agent_worktree(
        self, agent: dict[str, Any], log_handle: Any
    ) -> pathlib.Path:
        worktree_dir = self.worktree_root / agent["slug"]
        worktree_dir.parent.mkdir(parents=True, exist_ok=True)

        if worktree_dir.exists():
            self._run(
                ["git", "worktree", "remove", "--force", str(worktree_dir)],
                cwd=self.repo_root,
                check=False,
            )
            if worktree_dir.exists():
                shutil.rmtree(worktree_dir, ignore_errors=True)

        start_ref = self._resolve_start_ref(agent)
        add_cmd = [
            "git",
            "worktree",
            "add",
            "--force",
            "-B",
            agent["branch"],
            str(worktree_dir),
            start_ref,
        ]
        result = self._run(add_cmd, cwd=self.repo_root, check=False)
        log_handle.write("$ " + " ".join(add_cmd) + "\n")
        log_handle.write(result.stdout + result.stderr)
        if result.returncode != 0:
            raise RunnerError(
                f"Failed to create worktree for {agent['name']} on branch {agent['branch']}."
            )

        # If there are multiple dependencies, merge the remaining ones
        deps = agent.get("depends_on", [])
        if len(deps) > 1:
            for dep_name in deps[1:]:
                dep_agent = self.agents_by_name[dep_name]
                merge_cmd = [
                    "git", "merge", "--no-ff",
                    dep_agent["branch"],
                    "-m", f"Merge dependency {dep_name} into {agent['name']}",
                ]
                merge_result = self._run(merge_cmd, cwd=worktree_dir, check=False)
                log_handle.write("$ " + " ".join(merge_cmd) + "\n")
                log_handle.write(merge_result.stdout + merge_result.stderr)
                if merge_result.returncode != 0:
                    self._run(["git", "merge", "--abort"], cwd=worktree_dir, check=False)
                    raise RunnerError(
                        f"Failed to merge dependency {dep_name} into {agent['name']} worktree."
                    )

        return worktree_dir

    def _collect_changed_files(self, worktree_dir: pathlib.Path) -> list[str]:
        changes: set[str] = set()

        for command in (
            ["git", "diff", "--name-only"],
            ["git", "diff", "--cached", "--name-only"],
            ["git", "ls-files", "--others", "--exclude-standard"],
        ):
            result = self._run(command, cwd=worktree_dir, check=True)
            for line in result.stdout.splitlines():
                normalized = normalize_repo_path(line.strip())
                if normalized:
                    changes.add(normalized)
        return sorted(changes)

    def _record_verify_result(
        self, agent_name: str, command: str, exit_code: int
    ) -> None:
        def mutate(state: dict[str, Any]) -> None:
            agent_state = self._agent_state_locked(agent_name)
            agent_state.setdefault("verify_results", []).append(
                {"command": command, "exit_code": int(exit_code), "timestamp": now_iso()}
            )

        self._mutate_state(mutate)

    def _run_verify_commands(
        self, agent_name: str, worktree_dir: pathlib.Path, log_handle: Any
    ) -> None:
        verify_commands = self.agents_by_name[agent_name]["verify_commands"]
        for command in verify_commands:
            wrapped = shell_wrapper(command)
            log_handle.write(f"$ {command}\n")
            exit_code = self._run_stream(wrapped, cwd=worktree_dir, log_handle=log_handle)
            self._record_verify_result(agent_name, command, exit_code)
            if exit_code != 0:
                raise RunnerError(f"Verification failed for {agent_name}: {command}")

    def _claude_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        return env

    def _write_temp_prompt(self, prompt_text: str) -> pathlib.Path:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".md",
            delete=False,
        ) as handle:
            handle.write(prompt_text)
            return pathlib.Path(handle.name)

    def _build_claude_prompt(self, agent_name: str) -> str:
        agent = self.agents_by_name[agent_name]
        prompt_file = pathlib.Path(agent["prompt_file_abs"])
        base_prompt = prompt_file.read_text(encoding="utf-8").strip()
        owned_paths = ", ".join(agent["owned_paths"])

        lines = [
            "You are executing as part of a parallel agent batch.",
            "",
            "## Your Task",
            base_prompt,
            "",
            "## Constraints",
            f"- You may ONLY modify files matching these owned paths: {owned_paths}",
            "- Do NOT modify files outside your ownership manifest.",
            "- Do NOT make git commits; the runner will verify and commit changes.",
            "- Keep changes scoped to this agent task.",
        ]

        verify_commands = agent["verify_commands"]
        if verify_commands:
            lines.append(
                "- Run these verification commands before you finish if possible: "
                + "; ".join(verify_commands)
            )
        else:
            lines.append(
                "- No explicit verification commands are provided by the manifest."
            )

        return "\n".join(lines) + "\n"

    def _run_claude_via_wrapper(
        self, worktree_dir: pathlib.Path, log_handle: Any, prompt_path: pathlib.Path
    ) -> int:
        bash_bin = shutil.which("bash")
        if not bash_bin:
            raise RunnerError("bash is not available.")
        if not self.claude_wrapper.exists():
            raise RunnerError(f"Claude wrapper not found: {self.claude_wrapper}")
        command = [
            bash_bin,
            to_forward_slashes(str(self.claude_wrapper)),
            to_forward_slashes(str(prompt_path)),
            to_forward_slashes(str(worktree_dir)),
            DEFAULT_CLAUDE_ALLOWED_TOOLS,
            self.args.claude_bin,
        ]
        log_handle.write(
            "$ "
            + " ".join(command[:-1])
            + f" [claude-bin={self.args.claude_bin}]"
            + "\n"
        )
        return self._run_stream(
            command,
            cwd=worktree_dir,
            log_handle=log_handle,
            env=self._claude_env(),
        )

    def _run_claude_direct(
        self,
        worktree_dir: pathlib.Path,
        log_handle: Any,
        prompt_text: str,
    ) -> int:
        command = [
            *self.claude_cmd_base,
            "-p",
            prompt_text,
            "--allowedTools",
            DEFAULT_CLAUDE_ALLOWED_TOOLS,
            "--output-format",
            "text",
        ]
        rendered = (
            " ".join(self.claude_cmd_base)
            + " -p <inline prompt> --allowedTools "
            + DEFAULT_CLAUDE_ALLOWED_TOOLS
            + " --output-format text"
        )
        log_handle.write("$ " + rendered + "\n")
        return self._run_stream(
            command,
            cwd=worktree_dir,
            log_handle=log_handle,
            env=self._claude_env(),
        )

    def _run_codex(
        self, agent_name: str, worktree_dir: pathlib.Path, log_handle: Any
    ) -> None:
        agent = self.agents_by_name[agent_name]
        prompt_file = pathlib.Path(agent["prompt_file_abs"])
        prompt_text = prompt_file.read_text(encoding="utf-8")
        approval = self.manifest["codex_approval_mode"]
        if approval == "suggest":
            # Legacy value: map to modern --full-auto flag
            command = [*self.codex_cmd_base, "exec", "--full-auto", "-"]
        elif approval in ("full-auto",):
            command = [*self.codex_cmd_base, "exec", "--full-auto", "-"]
        else:
            command = [*self.codex_cmd_base, "exec", "-a", approval, "-"]
        log_handle.write("$ " + " ".join(command) + f" < {agent['prompt_file']}\n")
        exit_code = self._run_stream(
            command,
            cwd=worktree_dir,
            log_handle=log_handle,
            stdin_text=prompt_text,
        )
        if exit_code != 0:
            raise RunnerError(
                f"Codex failed for {agent_name} (exit code {exit_code})."
            )

    def _run_claude(
        self, agent_name: str, worktree_dir: pathlib.Path, log_handle: Any
    ) -> None:
        prompt_text = self._build_claude_prompt(agent_name)
        prompt_path = self._write_temp_prompt(prompt_text)
        try:
            if (
                os.name == "nt"
                and self.args.claude_bin == DEFAULT_CLAUDE_BIN
                and shutil.which("bash")
                and self.claude_wrapper.exists()
            ):
                exit_code = self._run_claude_via_wrapper(
                    worktree_dir,
                    log_handle,
                    prompt_path,
                )
            else:
                exit_code = self._run_claude_direct(
                    worktree_dir,
                    log_handle,
                    prompt_text,
                )
        finally:
            try:
                prompt_path.unlink()
            except OSError:
                pass

        if exit_code != 0:
            raise RunnerError(
                f"Claude failed for {agent_name} (exit code {exit_code})."
            )

    def _run_executor(
        self, agent_name: str, worktree_dir: pathlib.Path, log_handle: Any
    ) -> None:
        if self.args.executor == "claude":
            self._run_claude(agent_name, worktree_dir, log_handle)
            return
        self._run_codex(agent_name, worktree_dir, log_handle)

    def _enforce_ownership(
        self, agent_name: str, changed_files: list[str], log_handle: Any
    ) -> None:
        agent = self.agents_by_name[agent_name]
        owned_patterns = agent["owned_paths"]
        violations = [
            file_path
            for file_path in changed_files
            if not self._is_owned(file_path, owned_patterns)
        ]
        if violations:
            log_handle.write("Ownership violations:\n")
            for violation in violations:
                log_handle.write(f" - {violation}\n")
            raise RunnerError(
                f"Ownership enforcement failed for {agent_name}. "
                f"Files outside owned_paths were modified."
            )

        if not changed_files and not agent["allow_no_changes"]:
            raise RunnerError(f"Agent {agent_name} made no changes.")

    def _commit_agent_changes(
        self, agent_name: str, worktree_dir: pathlib.Path, log_handle: Any
    ) -> str:
        add_result = self._run(["git", "add", "-A"], cwd=worktree_dir, check=False)
        log_handle.write("$ git add -A\n")
        log_handle.write(add_result.stdout + add_result.stderr)
        if add_result.returncode != 0:
            raise RunnerError(f"git add failed for {agent_name}.")

        diff_result = self._run(
            ["git", "diff", "--cached", "--quiet"], cwd=worktree_dir, check=False
        )
        if diff_result.returncode == 0:
            if self.agents_by_name[agent_name]["allow_no_changes"]:
                sha_result = self._run(
                    ["git", "rev-parse", "HEAD"], cwd=worktree_dir, check=True
                )
                return sha_result.stdout.strip()
            raise RunnerError(f"No staged changes found for {agent_name}.")

        description = self.agents_by_name[agent_name]["description"]
        if description:
            message = f"Agent {agent_name}: {description}"
        else:
            message = f"Agent {agent_name}: apply prompt updates"

        commit_result = self._run(
            ["git", "commit", "-m", message],
            cwd=worktree_dir,
            check=False,
        )
        log_handle.write(f"$ git commit -m \"{message}\"\n")
        log_handle.write(commit_result.stdout + commit_result.stderr)
        if commit_result.returncode != 0:
            raise RunnerError(f"git commit failed for {agent_name}.")

        sha_result = self._run(["git", "rev-parse", "HEAD"], cwd=worktree_dir, check=True)
        return sha_result.stdout.strip()

    def _mark_agent_running(
        self, agent_name: str, worktree_rel: str | None, log_rel: str
    ) -> None:
        def mutate(state: dict[str, Any]) -> None:
            agent_state = self._agent_state_locked(agent_name)
            agent_state["status"] = "running"
            agent_state["attempts"] = int(agent_state.get("attempts", 0)) + 1
            agent_state["started_at"] = now_iso()
            agent_state["finished_at"] = None
            agent_state["worktree"] = worktree_rel
            agent_state["codex_log"] = log_rel
            agent_state["verify_results"] = []
            agent_state["error"] = None
            state["status"] = "running"
            state["last_error"] = None

        self._mutate_state(mutate)

    def _mark_agent_completed(self, agent_name: str, commit_sha: str) -> None:
        def mutate(state: dict[str, Any]) -> None:
            agent_state = self._agent_state_locked(agent_name)
            agent_state["status"] = "completed"
            agent_state["finished_at"] = now_iso()
            agent_state["commit"] = commit_sha
            agent_state["error"] = None

        self._mutate_state(mutate)

    def _mark_agent_merged(self, agent_name: str) -> None:
        def mutate(state: dict[str, Any]) -> None:
            agent_state = self._agent_state_locked(agent_name)
            agent_state["status"] = "merged"
            agent_state["finished_at"] = now_iso()

        self._mutate_state(mutate)

    def _mark_agent_failed(self, agent_name: str, message: str) -> None:
        self._append_error_log(f"agent={agent_name} message={message}")

        def mutate(state: dict[str, Any]) -> None:
            agent_state = self._agent_state_locked(agent_name)
            agent_state["status"] = "failed"
            agent_state["finished_at"] = now_iso()
            agent_state["error"] = {"message": message, "timestamp": now_iso()}
            state["status"] = "failed"
            state["last_error"] = {
                "stage": "agent",
                "agent": agent_name,
                "message": message,
                "timestamp": now_iso(),
            }

        self._mutate_state(mutate)

    def _cleanup_worktree(self, worktree_dir: pathlib.Path) -> None:
        if not worktree_dir.exists():
            return
        self._run(
            ["git", "worktree", "remove", "--force", str(worktree_dir)],
            cwd=self.repo_root,
            check=False,
        )
        # On Windows, git worktree remove may leave the directory behind
        if worktree_dir.exists():
            shutil.rmtree(worktree_dir, ignore_errors=True)

    def _execute_agent(self, agent_name: str) -> tuple[str, bool, str]:
        agent = self.agents_by_name[agent_name]
        log_name = f"{agent['slug']}-{now_iso().replace(':', '').replace('-', '')}.log"
        log_path = self.codex_log_dir / log_name
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_rel = self._repo_rel(log_path)

        worktree_dir: pathlib.Path | None = None
        worktree_rel: str | None = None

        try:
            if self.args.dry_run:
                self._mark_agent_running(agent_name, None, log_rel)
                with log_path.open("w", encoding="utf-8") as log_handle:
                    log_handle.write(
                        "[DRY RUN] No branch, executor, verify, or commit actions.\n"
                    )
                    log_handle.write(
                        f"[DRY RUN] would create branch {agent['branch']} and worktree.\n"
                    )
                self._mark_agent_completed(agent_name, "dry-run")
                return (agent_name, True, "dry-run")

            with log_path.open("w", encoding="utf-8") as log_handle:
                worktree_dir = self._prepare_agent_worktree(agent, log_handle)
                worktree_rel = self._repo_rel(worktree_dir)
                self._mark_agent_running(agent_name, worktree_rel, log_rel)

                self._run_executor(agent_name, worktree_dir, log_handle)
                self._run_verify_commands(agent_name, worktree_dir, log_handle)

                changed_files = self._collect_changed_files(worktree_dir)
                log_handle.write("Changed files:\n")
                for item in changed_files:
                    log_handle.write(f" - {item}\n")
                self._enforce_ownership(agent_name, changed_files, log_handle)

                commit_sha = self._commit_agent_changes(agent_name, worktree_dir, log_handle)

            self._mark_agent_completed(agent_name, commit_sha)
            return (agent_name, True, commit_sha)
        except Exception as exc:  # noqa: BLE001
            self._mark_agent_failed(agent_name, str(exc))
            return (agent_name, False, str(exc))
        finally:
            if worktree_dir is not None and not self.args.keep_worktrees:
                self._cleanup_worktree(worktree_dir)

    def _mark_blocked_dependents(self, failed_agents: set[str]) -> None:
        blocked = []
        for agent_name in self.agent_order:
            if agent_name in failed_agents:
                continue
            agent = self.agents_by_name[agent_name]
            if not set(agent["depends_on"]).intersection(failed_agents):
                continue
            blocked.append((agent_name, sorted(set(agent["depends_on"]).intersection(failed_agents))))

        if not blocked:
            return

        def mutate(state: dict[str, Any]) -> None:
            for agent_name, blockers in blocked:
                agent_state = self._agent_state_locked(agent_name)
                if agent_state.get("status") in {"pending", "blocked"}:
                    agent_state["status"] = "blocked"
                    agent_state["blocked_by"] = blockers
                    agent_state["finished_at"] = now_iso()
                    agent_state["error"] = {
                        "message": f"Blocked by failed dependency: {', '.join(blockers)}",
                        "timestamp": now_iso(),
                    }

        self._mutate_state(mutate)

    def _run_dependency_batches(self) -> None:
        max_workers = self.args.max_parallel
        for batch_index, batch_agents in enumerate(self.dependency_batches, start=1):
            def start_batch(state: dict[str, Any]) -> None:
                state["status"] = "running"
                state["current_batch"] = {
                    "index": batch_index,
                    "agents": batch_agents,
                    "started_at": now_iso(),
                }

            self._mutate_state(start_batch)

            worker_count = len(batch_agents)
            if max_workers > 0:
                worker_count = min(worker_count, max_workers)

            failed_in_batch: set[str] = set()
            with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as pool:
                futures = {
                    pool.submit(self._execute_agent, name): name for name in batch_agents
                }
                for future in concurrent.futures.as_completed(futures):
                    name, ok, message = future.result()
                    if not ok:
                        failed_in_batch.add(name)
                        self._append_error_log(f"batch={batch_index} agent={name} error={message}")

            if failed_in_batch:
                self._mark_blocked_dependents(failed_in_batch)
                self._set_global_failure(
                    "dependency-batch",
                    f"Batch {batch_index} failed: {', '.join(sorted(failed_in_batch))}",
                )
                raise RunnerError(
                    f"Dependency batch {batch_index} failed: {', '.join(sorted(failed_in_batch))}"
                )

            def complete_batch(state: dict[str, Any]) -> None:
                state["completed_batches"] = int(state.get("completed_batches", 0)) + 1
                state["current_batch"] = None

            self._mutate_state(complete_batch)

    def _run_merge_verify(
        self, merge_worktree: pathlib.Path, commands: list[str]
    ) -> None:
        for command in commands:
            wrapped = shell_wrapper(command)
            process = self._run(wrapped, cwd=merge_worktree, check=False)

            def mutate(state: dict[str, Any]) -> None:
                state["merge"].setdefault("verify_results", []).append(
                    {
                        "command": command,
                        "exit_code": int(process.returncode),
                        "timestamp": now_iso(),
                    }
                )

            self._mutate_state(mutate)

            if process.returncode != 0:
                raise RunnerError(f"Merge verify failed: {command}")

    def _run_cc_merge_pass(self) -> None:
        merge_cfg = self.manifest["merge"]
        if self.args.no_cc_merge or not merge_cfg.get("enabled", True):
            def mutate(state: dict[str, Any]) -> None:
                state["status"] = "awaiting-cc-merge"
                state["merge"]["status"] = "skipped"
                state["merge"]["finished_at"] = now_iso()

            self._mutate_state(mutate)
            return

        if self.args.dry_run:
            def mutate(state: dict[str, Any]) -> None:
                state["status"] = "completed"
                state["merge"]["status"] = "completed"
                state["merge"]["branch"] = "dry-run"
                state["merge"]["commit"] = "dry-run"
                state["merge"]["started_at"] = now_iso()
                state["merge"]["finished_at"] = now_iso()

            self._mutate_state(mutate)
            return

        merge_branch = merge_cfg["branch"] or (
            f"cc-merge/{slugify(self.manifest['batch_name'])}-{now_iso().replace(':', '').replace('-', '')}"
        )
        merge_worktree = self.worktree_root / "_cc_merge"
        merge_worktree.parent.mkdir(parents=True, exist_ok=True)

        self._run(
            ["git", "worktree", "remove", "--force", str(merge_worktree)],
            cwd=self.repo_root,
            check=False,
        )

        add_result = self._run(
            [
                "git",
                "worktree",
                "add",
                "--force",
                "-B",
                merge_branch,
                str(merge_worktree),
                self.manifest["target_branch"],
            ],
            cwd=self.repo_root,
            check=False,
        )
        if add_result.returncode != 0:
            raise RunnerError(
                f"Unable to create CC merge worktree for branch '{merge_branch}'."
            )

        def start_merge(state: dict[str, Any]) -> None:
            state["status"] = "merging"
            state["merge"]["status"] = "running"
            state["merge"]["branch"] = merge_branch
            state["merge"]["started_at"] = now_iso()
            state["merge"]["error"] = None
            state["merge"]["merged_agents"] = []

        self._mutate_state(start_merge)

        try:
            merge_order = self.manifest.get("cc_merge_order", [])
            if merge_order:
                order = [name for name in merge_order if name in self.agents_by_name]
            else:
                order = [name for batch in self.dependency_batches for name in batch]

            for agent_name in order:
                agent = self.agents_by_name[agent_name]
                if not agent.get("merge_enabled", True):
                    continue
                if not self._agent_state_status(agent_name) == "completed":
                    continue

                message = f"{merge_cfg['commit_prefix']}: {agent_name}"
                merge_result = self._run(
                    [
                        "git",
                        "merge",
                        "--no-ff",
                        agent["branch"],
                        "-m",
                        message,
                    ],
                    cwd=merge_worktree,
                    check=False,
                )
                if merge_result.returncode != 0:
                    conflict_result = self._run(
                        ["git", "diff", "--name-only", "--diff-filter=U"],
                        cwd=merge_worktree,
                        check=False,
                    )
                    self._run(["git", "merge", "--abort"], cwd=merge_worktree, check=False)
                    conflict_files = [
                        normalize_repo_path(item)
                        for item in conflict_result.stdout.splitlines()
                        if item.strip()
                    ]

                    def fail_merge(state: dict[str, Any]) -> None:
                        state["status"] = "failed"
                        state["merge"]["status"] = "failed"
                        state["merge"]["error"] = {
                            "agent": agent_name,
                            "message": "Merge conflict during CC merge pass.",
                            "conflicts": conflict_files,
                            "timestamp": now_iso(),
                        }
                        state["last_error"] = {
                            "stage": "merge",
                            "agent": agent_name,
                            "message": "Merge conflict during CC merge pass.",
                            "timestamp": now_iso(),
                        }

                    self._mutate_state(fail_merge)
                    raise RunnerError(
                        f"Merge conflict while merging {agent_name}: "
                        + ", ".join(conflict_files)
                    )

                def merged(state: dict[str, Any]) -> None:
                    state["merge"].setdefault("merged_agents", []).append(agent_name)

                self._mutate_state(merged)
                self._mark_agent_merged(agent_name)

            merge_verify_cmds = merge_cfg.get("verify_commands", [])
            if merge_verify_cmds:
                self._run_merge_verify(merge_worktree, merge_verify_cmds)

            merge_commit = self._run(
                ["git", "rev-parse", "HEAD"], cwd=merge_worktree, check=True
            ).stdout.strip()

            def finish(state: dict[str, Any]) -> None:
                state["status"] = "completed"
                state["merge"]["status"] = "completed"
                state["merge"]["commit"] = merge_commit
                state["merge"]["finished_at"] = now_iso()
                state["last_error"] = None

            self._mutate_state(finish)
        finally:
            if not self.args.keep_worktrees:
                self._cleanup_worktree(merge_worktree)

    def _agent_state_status(self, agent_name: str) -> str:
        with self.state_lock:
            return self._agent_state_locked(agent_name).get("status", "pending")

    def run(self) -> int:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.codex_log_dir.mkdir(parents=True, exist_ok=True)
        self.worktree_root.mkdir(parents=True, exist_ok=True)
        self.error_log.parent.mkdir(parents=True, exist_ok=True)

        self._load_manifest()
        self._init_state()

        self.paths_to_ignore_for_clean_check = {
            self._repo_rel(self.state_file),
            self._repo_rel(self.error_log),
            self._repo_rel(self.codex_log_dir),
            self._repo_rel(self.worktree_root),
        }

        if self.args.validate_only:
            def validate_done(state: dict[str, Any]) -> None:
                state["status"] = "validated"
                state["last_error"] = None

            self._mutate_state(validate_done)
            return 0

        if self.args.require_clean:
            self._verify_clean_worktree()

        try:
            self._run_dependency_batches()
            self._run_cc_merge_pass()
            return 0
        except Exception as exc:  # noqa: BLE001
            if self.state.get("status") != "failed":
                self._set_global_failure("runner", str(exc))
            return 1


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Phase 5 parallel executor runner with branch-per-agent execution."
    )
    parser.add_argument(
        "--manifest",
        default=DEFAULT_MANIFEST,
        help=f"Parallel batch manifest path (default: {DEFAULT_MANIFEST})",
    )
    parser.add_argument(
        "--state-file",
        default=DEFAULT_STATE_FILE,
        help=f"State file path (default: {DEFAULT_STATE_FILE})",
    )
    parser.add_argument(
        "--error-log",
        default=DEFAULT_ERROR_LOG,
        help=f"Error log path (default: {DEFAULT_ERROR_LOG})",
    )
    parser.add_argument(
        "--codex-log-dir",
        default=DEFAULT_LOG_DIR,
        help=f"Per-agent Codex log directory (default: {DEFAULT_LOG_DIR})",
    )
    parser.add_argument(
        "--worktree-root",
        default=DEFAULT_WORKTREE_ROOT,
        help=f"Git worktree root for agent branches (default: {DEFAULT_WORKTREE_ROOT})",
    )
    parser.add_argument(
        "--codex-bin",
        default=DEFAULT_CODEX_BIN,
        help=f"Codex binary/command (default: {DEFAULT_CODEX_BIN})",
    )
    parser.add_argument(
        "--claude-bin",
        default=DEFAULT_CLAUDE_BIN,
        help=f"Claude binary/command (default: {DEFAULT_CLAUDE_BIN})",
    )
    parser.add_argument(
        "--executor",
        choices=["codex", "claude"],
        default="codex",
        help="Which CLI to use for execution (claude avoids Windows TTY issues).",
    )
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=0,
        help="Max agents to run in parallel per dependency batch (0 = no cap).",
    )
    parser.add_argument(
        "--no-cc-merge",
        action="store_true",
        help="Skip automated CC merge pass and leave state as awaiting-cc-merge.",
    )
    parser.add_argument(
        "--keep-worktrees",
        action="store_true",
        help="Keep agent and merge worktrees after execution.",
    )
    parser.add_argument(
        "--require-clean",
        action="store_true",
        help="Require clean worktree before running (excluding runner artifacts).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Reset state file before execution.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip branch creation, executor, verify, commit, and merge actions.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate manifest/contracts/dependencies and write validated state only.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    runner = ParallelCodexRunner(args)
    return runner.run()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

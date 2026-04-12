import importlib.util
import pathlib
import stat

import pytest


MODULE_PATH = pathlib.Path(__file__).with_name("parallel-codex-runner.py")
MODULE_SPEC = importlib.util.spec_from_file_location(
    "parallel_codex_runner", MODULE_PATH
)
assert MODULE_SPEC is not None
assert MODULE_SPEC.loader is not None

runner_module = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(runner_module)

RunnerError = runner_module.RunnerError
_force_remove_dir = runner_module._force_remove_dir


def test_force_remove_dir_removes_normal_tree(tmp_path: pathlib.Path) -> None:
    target = tmp_path / "worktree" / "nested"
    target.mkdir(parents=True)
    (target / "file.txt").write_text("hello", encoding="utf-8")

    _force_remove_dir(tmp_path / "worktree")

    assert not (tmp_path / "worktree").exists()


def test_force_remove_dir_removes_tree_with_readonly_file(
    tmp_path: pathlib.Path,
) -> None:
    target = tmp_path / "worktree"
    locked_parent = target / "state" / "pytest-temp"
    locked_parent.mkdir(parents=True)
    locked_file = locked_parent / "pytest-cache-files-1.txt"
    locked_file.write_text("hello", encoding="utf-8")
    locked_file.chmod(stat.S_IREAD)

    try:
        _force_remove_dir(target)
    finally:
        if locked_file.exists():
            locked_file.chmod(stat.S_IWRITE | stat.S_IREAD)

    assert not target.exists()


def test_force_remove_dir_missing_path_is_noop(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[pathlib.Path] = []

    def fake_rmtree(path: pathlib.Path, onerror: object | None = None) -> None:
        calls.append(path)

    monkeypatch.setattr(runner_module.shutil, "rmtree", fake_rmtree)

    _force_remove_dir(tmp_path / "missing-worktree")

    assert calls == []


def test_force_remove_dir_raises_runner_error_on_persistent_failure(
    tmp_path: pathlib.Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "worktree"
    target.mkdir()
    attempts: list[pathlib.Path] = []

    def always_fail(path: pathlib.Path, onerror: object | None = None) -> None:
        attempts.append(path)
        raise PermissionError("locked")

    monkeypatch.setattr(runner_module.shutil, "rmtree", always_fail)

    with pytest.raises(RunnerError, match="Manual cleanup required") as exc_info:
        _force_remove_dir(target, max_retries=2, retry_delay=0.0)

    assert attempts == [target, target]
    assert str(target) in str(exc_info.value)
    assert "locked" in str(exc_info.value)

/**
 * codex-launcher.mjs — Reusable Codex CLI spawning helpers.
 *
 * Extracted from lesson-prep.mjs so any pipeline can launch Codex tasks
 * without duplicating the Windows cmd.exe wrapping or exec→pipe fallback.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Write a prompt string to a uniquely-named temp file in `workingDir`.
 * Returns the absolute path to the file.
 */
export function writeTempPromptFile(label, prompt, workingDir) {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const promptFile = path.join(
    workingDir,
    `.codex-prompt-${slug}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`
  );
  writeFileSync(promptFile, prompt, "utf-8");
  return promptFile;
}

/**
 * Best-effort deletion of a temp prompt file.
 */
export function cleanupTempPromptFile(promptFile) {
  if (!promptFile || !existsSync(promptFile)) {
    return;
  }

  try {
    unlinkSync(promptFile);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * Returns true when Codex output indicates the `exec` subcommand is
 * unrecognised (older CLI versions) and the caller should retry using
 * the legacy pipe mode.
 */
function shouldRetryWithLegacyCodex(output) {
  return /unknown command.*\bexec\b|invalid (sub)?command.*\bexec\b|unrecognized (sub)?command.*\bexec\b|no such command.*\bexec\b/i.test(
    output
  );
}

/**
 * Spawn a Codex CLI process for the given prompt file.
 *
 * Handles:
 *   - Windows cmd.exe wrapping (codex.cmd)
 *   - exec mode first, automatic fallback to legacy pipe mode
 *
 * Resolves with `{ label, success, error? }`.
 */
export function launchCodexTask(label, promptFile, workingDir) {
  return new Promise((resolve) => {
    console.log(`  Starting ${label}...`);

    const promptContents = readFileSync(promptFile, "utf-8");
    const isWindows = process.platform === "win32";
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTempPromptFile(promptFile);
      resolve(result);
    };

    const runAttempt = (mode) => {
      const spawnCommand = isWindows
        ? process.env.ComSpec || "cmd.exe"
        : "codex";
      const spawnArgs = isWindows
        ? [
            "/d",
            "/s",
            "/c",
            mode === "exec" ? "codex.cmd exec --full-auto -" : "codex.cmd --full-auto",
          ]
        : mode === "exec"
          ? ["exec", "--full-auto", "-"]
          : ["--full-auto"];
      const proc = spawn(spawnCommand, spawnArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: workingDir,
      });
      let output = "";

      proc.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });

      proc.stdin.write(promptContents);
      proc.stdin.end();

      proc.on("error", (err) => {
        console.error(`  ${label} failed to start: ${err.message}`);
        settle({ label, success: false, error: err.message });
      });

      proc.on("close", (code) => {
        if (code === 0) {
          console.log(
            `  ${label} completed successfully${mode === "pipe" ? " (legacy fallback)." : "."}`
          );
          settle({ label, success: true });
          return;
        }

        if (mode === "exec" && shouldRetryWithLegacyCodex(output)) {
          console.log(`  ${label}: retrying with legacy codex --full-auto fallback...`);
          writeFileSync(promptFile, promptContents, "utf-8");
          runAttempt("pipe");
          return;
        }

        console.error(`  ${label} exited with code ${code}.`);
        settle({ label, success: false, error: `exit code ${code}` });
      });
    };

    runAttempt("exec");
  });
}

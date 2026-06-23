import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runText, UserFacingCommandError } from "../dist/command.js";

const CLI = fileURLToPath(new URL("../dist/clawsweeper.js", import.meta.url));

test("runText explains missing working directories", () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-"));
  const missing = join(root, "missing");
  try {
    assert.throws(
      () => runText(process.execPath, ["--version"], { cwd: missing }),
      (error: unknown) => {
        assert.ok(error instanceof UserFacingCommandError);
        assert.match(
          error.message,
          /Working directory not found while running .*: .*missing.*Check --target-dir/,
        );
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runText explains missing executables", () => {
  assert.throws(
    () => runText("clawsweeper-missing-command-for-test", [], { env: { PATH: "" } }),
    (error: unknown) => {
      assert.ok(error instanceof UserFacingCommandError);
      assert.match(
        error.message,
        /Command not found while running clawsweeper-missing-command-for-test/,
      );
      return true;
    },
  );
});

test("review CLI suppresses stack traces for missing local target checkout", () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-"));
  const missing = join(root, "missing-target");
  const artifactDir = join(root, "artifacts");
  try {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "review",
        "--local-only",
        "--target-repo",
        "openclaw/openclaw",
        "--target-dir",
        missing,
        "--item-number",
        "357",
        "--artifact-dir",
        artifactDir,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: Working directory not found while running git:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

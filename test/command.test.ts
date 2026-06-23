import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  defaultReviewArtifactDirForTest,
  prepareManagedLocalReviewCheckoutForTest,
} from "../dist/clawsweeper.js";
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

test("local exact reviews default to item-specific artifacts", () => {
  assert.equal(defaultReviewArtifactDirForTest(true, 357, undefined), "artifacts/local-review-357");
  assert.equal(defaultReviewArtifactDirForTest(true, 357, [357]), "artifacts/reviews");
  assert.equal(defaultReviewArtifactDirForTest(false, 357, undefined), "artifacts/reviews");
});

test("managed local review checkout fetches the pull request ref", () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-"));
  const origin = join(root, "origin.git");
  const source = join(root, "source");
  const targetDir = join(root, "artifacts", "local-review-357", "target");
  try {
    execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
    execFileSync("git", ["init", source], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "clawsweeper@example.com"], { cwd: source });
    execFileSync("git", ["config", "user.name", "ClawSweeper Test"], { cwd: source });
    writeFileSync(join(source, "README.md"), "base\n");
    execFileSync("git", ["add", "README.md"], { cwd: source });
    execFileSync("git", ["commit", "-m", "base"], { cwd: source, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: source });
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: source });
    execFileSync("git", ["push", "origin", "main"], { cwd: source, stdio: "ignore" });

    writeFileSync(join(source, "feature.txt"), "from pr\n");
    execFileSync("git", ["add", "feature.txt"], { cwd: source });
    execFileSync("git", ["commit", "-m", "feature"], { cwd: source, stdio: "ignore" });
    const pullSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["push", "origin", "HEAD:refs/pull/357/head"], {
      cwd: source,
      stdio: "ignore",
    });

    prepareManagedLocalReviewCheckoutForTest({
      baseBranch: "main",
      cloneUrl: origin,
      itemNumber: 357,
      targetDir,
      targetRepo: "openclaw/openclaw",
    });

    assert.equal(
      execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: targetDir,
        encoding: "utf8",
      }).trim(),
      "clawsweeper/pr-357",
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetDir, encoding: "utf8" }).trim(),
      pullSha,
    );
    assert.ok(existsSync(join(targetDir, "feature.txt")));
    assert.equal(readFileSync(join(targetDir, "feature.txt"), "utf8"), "from pr\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

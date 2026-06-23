import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { runText } from "../dist/command.js";

test("runText explains missing working directories", () => {
  const root = mkdtempSync(join(tmpdir(), "cmd-"));
  const missing = join(root, "missing");
  try {
    assert.throws(
      () => runText(process.execPath, ["--version"], { cwd: missing }),
      /Working directory not found while running .*: .*missing.*Check --target-dir/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runText explains missing executables", () => {
  assert.throws(
    () => runText("clawsweeper-missing-command-for-test", [], { env: { PATH: "" } }),
    /Command not found while running clawsweeper-missing-command-for-test/,
  );
});

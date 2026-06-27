import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandInvocationForTest, runCommand } from "../../dist/repair/command-runner.js";

test("runCommand handles validation output larger than Node's sync spawn default", () => {
  const output = runCommand(process.execPath, [
    "-e",
    "process.stdout.write('x'.repeat(2 * 1024 * 1024))",
  ]);

  assert.equal(output.length, 2 * 1024 * 1024);
});

test("runCommand reports command timeouts with the rendered command", () => {
  assert.throws(
    () =>
      runCommand(process.execPath, ["-e", "setTimeout(() => process.stdout.write('done'), 1000)"], {
        timeoutMs: 10,
      }),
    /command timed out after 10ms: .*node.* -e/,
  );
});

test("runCommand double-escapes Windows batch launcher arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "clawsweeper-command-runner-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir);
  writeFileSync(join(binDir, "validate.CMD"), "@echo off\r\n");

  try {
    const invocation = commandInvocationForTest(
      "validate",
      ["space value", "a&b", "paren(x)", "tail\\", 'quote"x'],
      {
        cwd: root,
        env: {
          Path: binDir,
          PATHEXT: ".CMD",
          SystemRoot: String.raw`C:\Windows`,
        },
      },
      "win32",
    );

    assert.match(invocation.command, /C:\\Windows[\\/]System32[\\/]cmd\.exe/);
    assert.deepEqual(invocation.args.slice(0, 3), ["/d", "/s", "/c"]);
    const shellCommand = invocation.args[3] ?? "";
    assert.match(shellCommand, /validate\.CMD/);
    assert.match(shellCommand, /\^\^\^"space\^\^\^ value\^\^\^"/);
    assert.match(shellCommand, /\^\^\^"a\^\^\^&b\^\^\^"/);
    assert.match(shellCommand, /\^\^\^"paren\^\^\^\(x\^\^\^\)\^\^\^"/);
    assert.match(shellCommand, /\^\^\^"tail\\\\\^\^\^"/);
    assert.match(shellCommand, /\^\^\^"quote\\\^\^\^"x\^\^\^"/);
    assert.equal(invocation.windowsVerbatimArguments, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "runCommand preserves Windows batch launcher arguments at runtime",
  {
    skip:
      process.platform === "win32"
        ? false
        : "Windows batch argument parsing is only available on Windows",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "clawsweeper-command-runner-"));
    const scriptPath = join(root, "args.js");
    const launcherPath = join(root, "validate.cmd");
    writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));");
    writeFileSync(launcherPath, `@echo off\r\n"${process.execPath}" "%~dp0args.js" %*\r\n`);

    try {
      const args = [
        "space value",
        "a&b",
        "paren(x)",
        "bang!",
        "tail\\",
        "double\\\\",
        "space tail\\",
        'quote"x',
        'quote slash\\"',
      ];
      assert.deepEqual(JSON.parse(runCommand(launcherPath, args)), args);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

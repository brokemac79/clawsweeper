#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const model = argValue("--model") ?? process.env.CLAWSWEEPER_LOCAL_CODEX_MODEL ?? "gpt-5.5";
const codex = codexExecutable();

console.log(`Codex binary: ${codex.command}${codex.argsPrefix.length ? ` ${codex.argsPrefix.join(" ")}` : ""}`);

const status = runCodex(["login", "status", "-c", 'service_tier="fast"']);
if (status.status !== 0) {
  console.error("Codex login status failed.");
  printTail(status);
  printSetupHint();
  process.exit(1);
}

const smoke = runCodex(
  [
    "exec",
    "-m",
    model,
    "-c",
    'service_tier="fast"',
    "-c",
    'approval_policy="never"',
    "--sandbox",
    "read-only",
    "-",
  ],
  "Reply with exactly: ok",
);
if (smoke.status !== 0) {
  console.error("Codex exec smoke failed.");
  printTail(smoke);
  printSetupHint();
  process.exit(1);
}

console.log("Codex local preflight passed.");

function argValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function codexExecutable() {
  if (process.env.CODEX_BIN) return { command: process.env.CODEX_BIN, argsPrefix: [] };
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    const appBinary = join(localAppData, "OpenAI", "Codex", "bin", "codex.exe");
    if (existsSync(appBinary)) return { command: appBinary, argsPrefix: [] };
    const nodeShim = nodeShebangCodexOnPath();
    if (nodeShim) return { command: process.execPath, argsPrefix: [nodeShim] };
  }
  return { command: "codex", argsPrefix: [] };
}

function nodeShebangCodexOnPath() {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, "codex");
    if (!existsSync(candidate)) continue;
    try {
      const firstLine = readFileSync(candidate, "utf8").split(/\r?\n/, 1)[0] ?? "";
      if (/^#!.*\bnode\b/i.test(firstLine)) return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

function runCodex(args, input = "") {
  const result = spawnSync(codex.command, [...codex.argsPrefix, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  return {
    status: result.status,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function printTail(result) {
  if (result.error) console.error(result.error.message);
  const text = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  if (text) console.error(tail(text, 3000));
}

function tail(text, maxChars) {
  return text.length <= maxChars ? text : `...${text.slice(text.length - maxChars)}`;
}

function printSetupHint() {
  const apiKeySetup =
    process.platform === "win32"
      ? `$env:OPENAI_API_KEY = Read-Host "OpenAI API key"
  $env:OPENAI_API_KEY | codex login --with-api-key -c 'service_tier="fast"'
  Remove-Item Env:OPENAI_API_KEY`
      : `printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key -c 'service_tier="fast"'
  unset OPENAI_API_KEY`;
  console.error(`
Set up Codex CLI auth without committing secrets:

  codex login --device-auth -c 'service_tier="fast"'

Or store an API key in the Codex CLI auth store:

  ${apiKeySetup}

If your Codex binary is not on PATH, set CODEX_BIN to the full local executable path before rerunning this check.
`);
}

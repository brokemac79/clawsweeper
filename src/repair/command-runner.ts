import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, normalize, resolve } from "node:path";

const DEFAULT_COMMAND_MAX_BUFFER = 64 * 1024 * 1024;
const windowsExecutablePattern = /\.(?:com|exe)$/i;
const windowsBatchLauncherPattern = /\.(?:bat|cmd)$/i;
const windowsMetaCharacterPattern = /([()\][%!^"`<>&|;, *?])/g;

export type CommandRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  maxBuffer?: number;
  timeoutMs?: number;
};

export function runCommand(
  command: string,
  commandArgs: string[],
  options: CommandRunOptions = {},
): string {
  const invocation = commandInvocation(command, commandArgs, options);
  const child = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? DEFAULT_COMMAND_MAX_BUFFER,
    timeout: options.timeoutMs,
    windowsHide: true,
    ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  const detail = [child.stderr, child.stdout].filter(Boolean).join("\n").trim();
  if (child.error) {
    if ((child.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      const rendered = [command, ...commandArgs].join(" ");
      const message = `command timed out after ${options.timeoutMs}ms: ${rendered}`;
      throw new Error(detail ? `${message}\n${detail}` : message);
    }
    throw new Error(detail ? `${child.error.message}\n${detail}` : child.error.message);
  }
  if (child.status !== 0) {
    throw new Error(detail || `${command} exited ${child.status ?? `with signal ${child.signal}`}`);
  }
  return child.stdout ?? "";
}

function commandInvocation(
  command: string,
  args: readonly string[],
  options: CommandRunOptions,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform !== "win32") return { command, args: [...args] };
  const env = options.env ?? process.env;
  const resolvedCommand = resolveWindowsCommand(command, env, options.cwd ?? process.cwd());
  if (windowsExecutablePattern.test(resolvedCommand))
    return { command: resolvedCommand, args: [...args] };
  if (!windowsBatchLauncherPattern.test(resolvedCommand)) {
    return { command: resolvedCommand, args: [...args] };
  }

  const shellCommand = [
    escapeWindowsCommand(normalize(resolvedCommand)),
    ...args.map((arg) => escapeWindowsArgument(arg, true)),
  ].join(" ");
  return {
    command: windowsSystemExecutable("cmd.exe", env),
    args: ["/d", "/s", "/c", `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}

export function commandInvocationForTest(
  command: string,
  args: readonly string[],
  options: CommandRunOptions = {},
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  return commandInvocation(command, args, options, platform);
}

function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv, cwd: string): string {
  if (isAbsolute(command) || /[\\/]/.test(command)) return resolve(cwd, command);
  const extensions = (windowsEnvironmentValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean);
  const candidates = extensions.includes("")
    ? [command]
    : [...extensions.map((ext) => `${command}${ext}`), command];
  for (const directory of (windowsEnvironmentValue(env, "PATH") || "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const candidate of candidates) {
      const filePath = resolve(cwd, directory, candidate);
      if (existsSync(filePath)) return filePath;
    }
  }
  return command;
}

function windowsSystemExecutable(name: string, env: NodeJS.ProcessEnv): string {
  const systemRoot =
    windowsEnvironmentValue(env, "SystemRoot") || windowsEnvironmentValue(env, "windir");
  if (systemRoot) return join(systemRoot, "System32", name);
  const comSpec = windowsEnvironmentValue(env, "ComSpec");
  if (comSpec && isAbsolute(comSpec)) return join(dirname(comSpec), name);
  return name;
}

function windowsEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1]?.trim() || undefined;
}

function escapeWindowsCommand(value: string): string {
  return value.replace(windowsMetaCharacterPattern, "^$1");
}

function escapeWindowsArgument(value: string, doubleEscapeMetaCharacters: boolean): string {
  let escaped = quoteWindowsArgument(value);
  escaped = escaped.replace(windowsMetaCharacterPattern, "^$1");
  if (doubleEscapeMetaCharacters) {
    escaped = escaped.replace(windowsMetaCharacterPattern, "^$1");
  }
  return escaped;
}

function quoteWindowsArgument(value: string): string {
  let escaped = '"';
  let backslashes = 0;

  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      escaped += "\\".repeat(backslashes * 2 + 1);
      escaped += char;
      backslashes = 0;
      continue;
    }
    escaped += "\\".repeat(backslashes);
    escaped += char;
    backslashes = 0;
  }

  escaped += "\\".repeat(backslashes * 2);
  escaped += '"';
  return escaped;
}

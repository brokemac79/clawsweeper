import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export type RunTextOptions = {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  maxBuffer?: number;
  stdio?: ["ignore", "pipe", "pipe"] | ["ignore", "pipe", "ignore"];
  trim?: "both" | "end" | "none";
};

export class UserFacingCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingCommandError";
  }
}

export function isUserFacingCommandError(error: unknown): error is UserFacingCommandError {
  return error instanceof UserFacingCommandError;
}

export function runText(
  command: string,
  args: string[],
  {
    cwd,
    env,
    maxBuffer = 64 * 1024 * 1024,
    stdio = ["ignore", "pipe", "pipe"],
    trim = "end",
  }: RunTextOptions = {},
): string {
  const childEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...env };
  const resolved = resolveCommand(command, args, childEnv);
  let text: string;
  try {
    text = execFileSync(resolved.command, resolved.args, {
      cwd,
      encoding: "utf8",
      env: childEnv,
      maxBuffer,
      stdio,
    });
  } catch (error) {
    throw explainSpawnFailure(error, resolved.command, cwd);
  }
  if (trim === "both") return text.trim();
  if (trim === "end") return text.trimEnd();
  return text;
}

function explainSpawnFailure(error: unknown, command: string, cwd?: string): unknown {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    if (cwd && !existsSync(cwd)) {
      return new UserFacingCommandError(
        `Working directory not found while running ${command}: ${cwd}. Check --target-dir or create the checkout first.`,
      );
    }
    return new UserFacingCommandError(
      `Command not found while running ${command}. Ensure ${command} is installed and available on PATH, or set the appropriate *_BIN override.`,
    );
  }
  return error;
}

export function resolveCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const key = commandBinKey(command);
  const configured = env[`${key}_BIN`]?.trim();
  if (configured) {
    return {
      command: configured,
      args: [...envArgs(`${key}_BIN_ARGS`, env), ...args],
    };
  }
  return { command, args: [...args] };
}

function commandBinKey(command: string): string {
  return command.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

export function envArgs(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const value = env[name];
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error(`${name} must be a JSON string array`);
  }
  return parsed;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "./data";
import { getCodexLoginStatus } from "./codex";
import { parseCodexDeviceAuth, type CodexDeviceAuth } from "./codex-login-parser";

const execFileAsync = promisify(execFile);
const CODEX_LOGIN_SESSION = "a2w_codex_login";

export type CodexLoginPane = {
  running: boolean;
  authenticated: boolean;
  available: boolean;
  output: string;
  deviceAuth?: CodexDeviceAuth;
};

export async function getCodexLoginPane(): Promise<CodexLoginPane> {
  const running = await tmuxSessionExists(CODEX_LOGIN_SESSION);
  const output = running ? await capturePane(CODEX_LOGIN_SESSION) : "";
  const status = await getCodexLoginStatus();
  return {
    running,
    authenticated: status.authenticated,
    available: status.available,
    output: output || status.output,
    deviceAuth: parseCodexDeviceAuth(output || status.output)
  };
}

export async function startCodexLoginPane(): Promise<CodexLoginPane> {
  if (await tmuxSessionExists(CODEX_LOGIN_SESSION)) {
    const output = await capturePane(CODEX_LOGIN_SESSION);
    if (isLegacyLocalhostLogin(output)) {
      await tmux(["kill-session", "-t", CODEX_LOGIN_SESSION]);
    }
  }

  if (!(await tmuxSessionExists(CODEX_LOGIN_SESSION))) {
    await tmux([
      "new-session",
      "-d",
      "-s",
      CODEX_LOGIN_SESSION,
      "-c",
      PROJECT_ROOT,
      "codex login --device-auth; printf '\\nCodex device login command exited. You can close this session.\\n'; sleep 3600"
    ]);
    await sleep(700);
  }
  return getCodexLoginPane();
}

export async function stopCodexLoginPane(): Promise<CodexLoginPane> {
  if (await tmuxSessionExists(CODEX_LOGIN_SESSION)) {
    await tmux(["kill-session", "-t", CODEX_LOGIN_SESSION]);
  }
  return getCodexLoginPane();
}

async function tmuxSessionExists(sessionName: string) {
  try {
    await tmux(["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

async function capturePane(target: string) {
  const output = await tmux(["capture-pane", "-p", "-J", "-S", "-500", "-t", target]);
  return stripAnsi(output).trimEnd();
}

async function tmux(args: string[]) {
  const result = await execFileAsync("tmux", args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 2
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isLegacyLocalhostLogin(output: string) {
  const lower = output.toLowerCase();
  return lower.includes("localhost:") || lower.includes("redirect_uri=http%3a%2f%2flocalhost") || lower.includes("use `codex login --device-auth` instead");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

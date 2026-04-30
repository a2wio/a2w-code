import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "./data";
import { getCodexLoginStatus } from "./codex";

const execFileAsync = promisify(execFile);
const CODEX_LOGIN_SESSION = "a2w_codex_login";

export type CodexLoginPane = {
  running: boolean;
  authenticated: boolean;
  available: boolean;
  output: string;
  deviceAuth?: CodexDeviceAuth;
};

export type CodexDeviceAuth = {
  verificationUrl?: string;
  userCode?: string;
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

export function parseCodexDeviceAuth(output: string): CodexDeviceAuth | undefined {
  const cleaned = stripAnsi(output);
  const urls = cleaned.match(/https:\/\/[^\s<>"')]+/g) || [];
  const verificationUrl = urls
    .map(normalizeUrl)
    .find((url) => !url.includes("localhost") && /(?:auth\.openai\.com|chatgpt\.com|openai\.com)/i.test(url));
  const userCode = extractUserCode(cleaned);
  if (!verificationUrl && !userCode) return undefined;
  return { verificationUrl, userCode };
}

function extractUserCode(output: string) {
  const labeled = output.match(/(?:user|device|verification)?\s*code\s*(?:is|:|=)?\s*([A-Z0-9][A-Z0-9-]{4,24})/i);
  if (labeled?.[1]) return normalizeCode(labeled[1]);

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/https?:\/\//i.test(line)) continue;
    const standalone = line.match(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+\b/);
    if (standalone?.[0]) return normalizeCode(standalone[0]);
  }

  return undefined;
}

function normalizeCode(value: string) {
  return value.trim().replace(/[.,;:]+$/, "").toUpperCase();
}

function normalizeUrl(value: string) {
  return value.trim().replace(/[.,;:]+$/, "");
}

function isLegacyLocalhostLogin(output: string) {
  const lower = output.toLowerCase();
  return lower.includes("localhost:") || lower.includes("redirect_uri=http%3a%2f%2flocalhost") || lower.includes("use `codex login --device-auth` instead");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

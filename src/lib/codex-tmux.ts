import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Chat, CloudProvider, ProviderConnection, Workspace } from "./types";
import { workspaceRepoRoot } from "./data";

const execFileAsync = promisify(execFile);

export type CodexTmuxPane = {
  sessionName: string;
  target: string;
  running: boolean;
  ready: boolean;
  output: string;
};
export type CodexTmuxControlKey = "up" | "down" | "enter" | "escape";

type CodexTmuxInput = {
  workspace: Workspace;
  chat: Chat;
  provider: CloudProvider;
  providerConnection?: ProviderConnection;
  selectedRootPath?: string;
};

export async function getCodexTmuxPane(input: { workspace: Workspace; chatId: string }): Promise<CodexTmuxPane> {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chatId);
  const target = sessionName;
  const running = await tmuxSessionExists(sessionName);
  let output = running ? await capturePane(target) : "";
  let state = running ? codexPromptState(output) : { ready: false, stagedInput: "" };
  if (running && state.stagedInput && !state.ready && !codexChoicePickerActive(output)) {
    await tmux(["send-keys", "-t", target, "C-m"]);
    await sleep(250);
    output = await capturePane(target);
    state = codexPromptState(output);
  }
  return { sessionName, target, running, ready: state.ready, output };
}

export async function sendCodexTmuxMessage(input: CodexTmuxInput & { message: string }) {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chat.id);
  const target = sessionName;
  const existed = await tmuxSessionExists(sessionName);
  if (!existed) {
    await startCodexTmuxSession(input, sessionName);
    await waitForCodexPrompt(target);
  } else {
    const output = await capturePane(target);
    if (!codexPromptState(output).ready) {
      throw new Error("Codex is still responding in this chat. Wait for the live session to finish before sending another message.");
    }
  }

  await tmux(["send-keys", "-t", target, "C-u"]);
  await sleep(80);
  await sendLiteral(target, input.message);
  await sleep(120);
  await tmux(["send-keys", "-t", target, "C-m"]);
  await sleep(250);

  const pane = await getCodexTmuxPane({ workspace: input.workspace, chatId: input.chat.id });
  return { ...pane, ready: false };
}

export async function sendCodexTmuxChoice(input: { workspace: Workspace; chatId: string; activeIndex: number; index: number }) {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chatId);
  if (!(await tmuxSessionExists(sessionName))) throw new Error("Codex tmux session is not running.");

  const delta = input.index - input.activeIndex;
  const key = delta >= 0 ? "Down" : "Up";
  for (let count = 0; count < Math.abs(delta); count += 1) {
    await tmux(["send-keys", "-t", sessionName, key]);
    await sleep(40);
  }
  await tmux(["send-keys", "-t", sessionName, "C-m"]);
  await sleep(250);
  return getCodexTmuxPane({ workspace: input.workspace, chatId: input.chatId });
}

export async function sendCodexTmuxControl(input: { workspace: Workspace; chatId: string; key: CodexTmuxControlKey }) {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chatId);
  if (!(await tmuxSessionExists(sessionName))) throw new Error("Codex tmux session is not running.");

  await tmux(["send-keys", "-t", sessionName, codexTmuxControlKey(input.key)]);
  await sleep(input.key === "enter" ? 250 : 120);
  return getCodexTmuxPane({ workspace: input.workspace, chatId: input.chatId });
}

async function startCodexTmuxSession(input: CodexTmuxInput, sessionName: string) {
  const repoRoot = workspaceRepoRoot(input.workspace.id);
  const args = [
    "codex",
    "--no-alt-screen",
    "--cd",
    repoRoot,
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never"
  ];
  const model = input.workspace.codexModel || process.env.A2W_CODEX_MODEL;
  if (model) args.push("--model", model);

  await tmux(["new-session", "-d", "-s", sessionName, "-c", repoRoot, shellJoin(args)]);
}

async function sendLiteral(target: string, value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  await tmux(["send-keys", "-l", "-t", target, normalized]);
}

async function capturePane(target: string) {
  const output = await tmux(["capture-pane", "-p", "-J", "-S", "-3000", "-t", target]);
  return stripAnsi(output).trimEnd();
}

async function tmuxSessionExists(sessionName: string) {
  try {
    await tmux(["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

async function tmux(args: string[]) {
  const result = await execFileAsync("tmux", args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function codexTmuxSessionName(workspaceId: string, chatId: string) {
  const hash = createHash("sha256").update(`${workspaceId}:${chatId}`).digest("hex").slice(0, 16);
  return `a2w_codex_${hash}`;
}

function codexTmuxControlKey(key: CodexTmuxControlKey) {
  if (key === "up") return "Up";
  if (key === "down") return "Down";
  if (key === "escape") return "Escape";
  return "C-m";
}

async function waitForCodexPrompt(target: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12_000) {
    const output = await capturePane(target).catch(() => "");
    if (codexPromptState(output).ready) return;
    await sleep(250);
  }
  throw new Error("Codex started, but the interactive prompt did not become ready in time.");
}

function codexPromptState(output: string) {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const prompt = lines.slice(-16).reverse().find((line) => line.startsWith("›"));
  if (!prompt) return { ready: false, stagedInput: "" };
  const stagedInput = prompt.replace(/^›\s*/, "").trim();
  return {
    ready: !stagedInput || isCodexPlaceholder(stagedInput),
    stagedInput
  };
}

function codexChoicePickerActive(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .some((line) => /^›?\s*\d+\.\s+/.test(line));
}

function isCodexPlaceholder(value: string) {
  return /^(find and fix|write tests|explain|review|ask|message|type)/i.test(value) || value.includes("@filename");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellJoin(args: string[]) {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

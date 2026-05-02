import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Chat, CloudProvider, ProviderConnection, Workspace } from "./types";
import { workspaceRepoRoot } from "./data";
import { chatMode, workspaceModeLabel } from "./workspace-mode";
import { codexPlanSuggestionActive, codexPromptState, isCodexPlaceholder } from "./codex-prompt-state";

const execFileAsync = promisify(execFile);

export type CodexTmuxPane = {
  sessionName: string;
  target: string;
  running: boolean;
  ready: boolean;
  viewingTranscript?: boolean;
  stagedInput?: string;
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
  return { sessionName, target, running, ready: state.ready, viewingTranscript: state.viewingTranscript || undefined, stagedInput: state.stagedInput || undefined, output };
}

export async function ensureCodexTmuxSession(input: CodexTmuxInput) {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chat.id);
  const target = sessionName;
  if (!(await tmuxSessionExists(sessionName))) {
    await startCodexTmuxSession(input, sessionName);
  }
  const output = await capturePane(target).catch(() => "");
  if (!codexPromptState(output).ready) {
    await waitForCodexPrompt(target);
  }
  return getCodexTmuxPane({ workspace: input.workspace, chatId: input.chat.id });
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
    const state = codexPromptState(output);
    if (!state.ready && state.viewingTranscript) {
      await tmux(["send-keys", "-t", target, "q"]);
      await waitForCodexPrompt(target);
    } else if (!state.ready && state.stagedInput) {
      await clearCodexInput(target);
    } else if (!state.ready && codexSessionIsBooting(output)) {
      await waitForCodexPrompt(target);
    } else if (!state.ready) {
      throw new Error("Codex is still responding in this chat. Wait for the live session to finish before sending another message.");
    }
  }

  await clearCodexPromptBeforeSend(target);
  await sendLiteral(target, codexTmuxOperatorPrompt(input));
  await sleep(220);
  await tmux(["send-keys", "-t", target, "Enter"]);
  await sleep(500);

  const pane = await getCodexTmuxPane({ workspace: input.workspace, chatId: input.chat.id });
  return pane;
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
  await tmux(["send-keys", "-t", sessionName, "Enter"]);
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

export async function stopCodexTmuxSession(input: { workspace: Workspace; chatId: string }) {
  const sessionName = codexTmuxSessionName(input.workspace.id, input.chatId);
  if (!(await tmuxSessionExists(sessionName))) return;
  await tmux(["kill-session", "-t", sessionName]);
}

async function startCodexTmuxSession(input: CodexTmuxInput, sessionName: string) {
  const repoRoot = workspaceRepoRoot(input.workspace.id, chatMode(input.chat));
  const args = [
    "codex",
    "--no-alt-screen",
    "--cd",
    repoRoot
  ];
  if (codexBypassSandbox()) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", process.env.A2W_CODEX_SANDBOX || "workspace-write", "--ask-for-approval", "never");
  }
  const model = input.workspace.codexModel || process.env.A2W_CODEX_MODEL;
  if (model) args.push("--model", model);

  const command = [
    shellJoin(args),
    "status=$?",
    "printf '\\nCodex exited with code %s. Review the output above, then close this session.\\n' \"$status\"",
    "sleep 3600"
  ].join("; ");
  await tmux(["new-session", "-d", "-s", sessionName, "-c", repoRoot, command]);
}

async function sendLiteral(target: string, value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  await tmux(["send-keys", "-l", "-t", target, normalized]);
}

async function clearCodexInput(target: string) {
  await tmux(["send-keys", "-t", target, "C-u"]);
  await sleep(100);
}

async function clearCodexPromptBeforeSend(target: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dismissCodexPlanSuggestion(target);
    await clearCodexInput(target);
    const output = await capturePane(target).catch(() => "");
    const state = codexPromptState(output);
    if (!state.stagedInput || isCodexPlaceholder(state.stagedInput)) return;
  }
}

async function dismissCodexPlanSuggestion(target: string) {
  const output = await capturePane(target).catch(() => "");
  if (!codexPlanSuggestionActive(output.split("\n").map((line) => line.trim()).filter(Boolean))) return;
  await tmux(["send-keys", "-t", target, "Escape"]);
  await sleep(160);
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
  return "Enter";
}

function codexBypassSandbox() {
  return process.env.A2W_CODEX_BYPASS_SANDBOX === "true";
}

function codexTmuxOperatorPrompt(input: CodexTmuxInput & { message: string }) {
  const mode = chatMode(input.chat);
  const profileRules = mode === "web"
    ? [
        "Workspace profile: Web / Next.js.",
        "- Treat this repository as an application codebase, not an infrastructure-only repo.",
        "- Prefer existing package scripts and project conventions before introducing new tooling.",
        "- Do not run long-lived dev servers unless the operator explicitly asks.",
        "- After code changes, recommend NPM lint, test, or build actions from the UI."
      ]
    : [
        "Workspace profile: Infrastructure / Terraform.",
        "- Follow the DStack Terraform layout exactly:",
        "  - Reusable resource logic goes in infrastructure/terraform/modules/<provider>/<module>.",
        "  - Deployable call directories go in infrastructure/terraform/providers/<provider>/<region>/<stack>.",
        "  - Provider call directories call modules and own Terraform state.",
        "  - Do not put cloud resource blocks directly in provider call directories.",
        "- Do not run terraform apply, terraform destroy, or cloud-mutating CLI commands.",
        "- After Terraform changes, recommend Terraform fmt, plan, review, approval, then apply."
      ];

  if (input.message.trim().startsWith("/")) return input.message;
  return [
    `A2W-Code mode: ${workspaceModeLabel(mode)}.`,
    ...profileRules,
    "",
    "Operator request:",
    input.message,
    "",
    "A2W focus-summary skill:",
    "- After your normal final response, append one final protocol line exactly like this:",
    "  A2W_FOCUS_SUMMARY: one direct first-person or second-person sentence under 160 characters for the person who sent the request.",
    "- Write it like you are speaking to that person, for example: \"I'm ready. What would you like to change?\"",
    "- Do not write third-person meta narration such as \"Greeted the user\" or \"Explained that...\".",
    "- Do not mention this protocol in the human response.",
    "A2W_END_OPERATOR_CONTEXT"
  ].join("\n");
}

async function waitForCodexPrompt(target: string) {
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.A2W_CODEX_READY_TIMEOUT_MS || 45_000);
  let lastOutput = "";
  while (Date.now() - startedAt < timeoutMs) {
    const output = await capturePane(target).catch(() => "");
    if (output) lastOutput = output;
    if (codexPromptState(output).ready) return;
    await sleep(250);
  }

  const tail = lastOutput.split("\n").slice(-40).join("\n").trim();
  throw new Error([
    "Codex started, but the interactive prompt did not become ready in time.",
    "This usually means Codex is waiting on login, stuck booting MCP/config, blocked by its internal sandbox, or the CLI prompt output changed.",
    tail ? `\nLast Codex pane output:\n${tail}` : ""
  ].filter(Boolean).join("\n"));
}

function codexSessionIsBooting(output: string) {
  const clean = output.trim();
  if (!clean) return true;
  if (/Operator request:|A2W_END_OPERATOR_CONTEXT|Codex exited with code/i.test(clean)) return false;
  return !clean.split("\n").some((line) => line.trim().startsWith("›"));
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

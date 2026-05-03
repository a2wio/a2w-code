import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Chat, CloudProvider, ProviderConnection, Workspace } from "./types";
import { updateData, workspaceRepoRoot } from "./data";
import { chatMode, workspaceModeLabel } from "./workspace-mode";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };
type JsonObject = { [key: string]: JsonValue | undefined };

type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: { code?: number; message?: string; data?: JsonValue };
};

type PendingRequest = {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export type CodexAppAction = {
  kind: "search" | "command" | "file" | "thinking" | "generic";
  label: string;
  detail?: string;
};

export type CodexAppTurn = {
  id: string;
  prompt: string;
  response: string;
  focusSummary?: string;
  actions: CodexAppAction[];
  status?: string;
};

export type CodexAppSession = {
  threadId?: string;
  activeTurnId?: string;
  running: boolean;
  ready: boolean;
  output: string;
  turns: CodexAppTurn[];
};

export type CodexAppLoginPane = {
  running: boolean;
  authenticated: boolean;
  available: boolean;
  output: string;
  deviceAuth?: {
    verificationUrl?: string;
    userCode?: string;
  };
};

type CodexAppInput = {
  workspace: Workspace;
  chat: Chat;
  provider: CloudProvider;
  providerConnection?: ProviderConnection;
  selectedRootPath?: string;
};

type CodexAppSessionState = CodexAppSession & {
  workspaceId: string;
  chatId: string;
  lastError?: string;
};

type CodexAppLoginState = {
  loginId?: string;
  running: boolean;
  authenticated: boolean;
  available: boolean;
  output: string;
  deviceAuth?: {
    verificationUrl?: string;
    userCode?: string;
  };
};

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private initialized: Promise<void> | null = null;
  private pending = new Map<string | number, PendingRequest>();
  private sessionsByThread = new Map<string, CodexAppSessionState>();
  private sessionsByChat = new Map<string, CodexAppSessionState>();
  private login: CodexAppLoginState = {
    running: false,
    authenticated: false,
    available: true,
    output: ""
  };

  async getLoginPane(): Promise<CodexAppLoginPane> {
    await this.ensureInitialized();
    await this.refreshAuthStatus().catch(() => undefined);
    return { ...this.login };
  }

  async startLogin(): Promise<CodexAppLoginPane> {
    await this.ensureInitialized();
    const result = asObject(await this.request("account/login/start", { type: "chatgptDeviceCode" }, 30_000));
    if (result.type === "chatgptDeviceCode") {
      this.login = {
        available: true,
        authenticated: false,
        running: true,
        loginId: stringValue(result.loginId),
        deviceAuth: {
          verificationUrl: stringValue(result.verificationUrl),
          userCode: stringValue(result.userCode)
        },
        output: [
          "Codex App Server device login started.",
          stringValue(result.verificationUrl) ? `Verification URL: ${stringValue(result.verificationUrl)}` : "",
          stringValue(result.userCode) ? `User code: ${stringValue(result.userCode)}` : ""
        ].filter(Boolean).join("\n")
      };
    } else {
      this.login.output = "Codex App Server started login.";
      this.login.running = true;
    }
    return { ...this.login };
  }

  async stopLogin(): Promise<CodexAppLoginPane> {
    await this.ensureInitialized();
    if (this.login.loginId) {
      await this.request("account/login/cancel", { loginId: this.login.loginId }, 10_000).catch(() => undefined);
    }
    this.login.running = false;
    this.login.output = this.login.output || "Codex App Server login stopped.";
    return { ...this.login };
  }

  async getSession(input: { workspace: Workspace; chat: Chat }): Promise<CodexAppSession> {
    await this.ensureInitialized();
    const key = chatKey(input.workspace.id, input.chat.id);
    const cached = this.sessionsByChat.get(key);
    if (cached) return publicSession(cached);

    if (!input.chat.codexThreadId) {
      return {
        running: false,
        ready: false,
        output: "",
        turns: []
      };
    }

    const state = await this.resumeThread(input.workspace, input.chat);
    return publicSession(state);
  }

  async ensureSession(input: CodexAppInput): Promise<CodexAppSession> {
    await this.ensureInitialized();
    const state = await this.ensureThread(input);
    return publicSession(state);
  }

  async sendMessage(input: CodexAppInput & { message: string }): Promise<CodexAppSession> {
    await this.ensureInitialized();
    const state = await this.ensureThread(input);
    if (state.running && state.activeTurnId) {
      await this.request("turn/steer", {
        threadId: state.threadId,
        expectedTurnId: state.activeTurnId,
        input: [textInput(turnInputText(input))]
      }, 30_000);
      state.turns.at(-1)?.actions.push({ kind: "generic", label: "Added context", detail: input.message });
      return publicSession(state);
    }

    const localTurn: CodexAppTurn = {
      id: `pending-${Date.now()}`,
      prompt: input.message,
      response: "",
      actions: [],
      status: "running"
    };
    state.turns.push(localTurn);
    state.running = true;
    state.ready = false;

    const result = asObject(await this.request("turn/start", {
      threadId: state.threadId,
      input: [textInput(turnInputText(input))],
      cwd: workspaceRepoRoot(input.workspace.id, chatMode(input.chat)),
      model: input.workspace.codexModel || process.env.A2W_CODEX_MODEL || null,
      approvalPolicy: "never",
      sandboxPolicy: codexAppSandboxPolicy(),
      summary: codexReasoningSummary()
    }, Number(process.env.A2W_CODEX_TURN_START_TIMEOUT_MS || 60_000)));

    const turn = asObject(result.turn);
    const turnId = stringValue(turn.id);
    if (turnId) {
      localTurn.id = turnId;
      state.activeTurnId = turnId;
    }
    return publicSession(state);
  }

  async interrupt(input: { workspace: Workspace; chat: Chat }): Promise<CodexAppSession> {
    await this.ensureInitialized();
    const state = await this.getExistingOrResume(input.workspace, input.chat);
    if (state?.threadId && state.activeTurnId) {
      await this.request("turn/interrupt", { threadId: state.threadId, turnId: state.activeTurnId }, 15_000).catch(() => undefined);
      state.turns.at(-1)?.actions.push({ kind: "generic", label: "Interrupted" });
      state.running = false;
      state.ready = true;
      state.activeTurnId = undefined;
    }
    return publicSession(state || emptyState(input.workspace.id, input.chat.id));
  }

  async stopSession(input: { workspace: Workspace; chatId: string }) {
    const key = chatKey(input.workspace.id, input.chatId);
    const state = this.sessionsByChat.get(key);
    if (!state) return;
    if (state.threadId) {
      if (state.activeTurnId) {
        await this.request("turn/interrupt", { threadId: state.threadId, turnId: state.activeTurnId }, 10_000).catch(() => undefined);
      }
      await this.request("thread/unsubscribe", { threadId: state.threadId }, 10_000).catch(() => undefined);
      this.sessionsByThread.delete(state.threadId);
    }
    this.sessionsByChat.delete(key);
  }

  private async ensureThread(input: CodexAppInput): Promise<CodexAppSessionState> {
    const existing = await this.getExistingOrResume(input.workspace, input.chat);
    if (existing) return existing;

    const repoRoot = workspaceRepoRoot(input.workspace.id, chatMode(input.chat));
    const result = asObject(await this.request("thread/start", {
      model: input.workspace.codexModel || process.env.A2W_CODEX_MODEL || null,
      cwd: repoRoot,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: codexAppSandbox(),
      developerInstructions: codexDeveloperInstructions(input),
      personality: "pragmatic",
      ephemeral: false,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    }, 60_000));
    const thread = asObject(result.thread);
    const threadId = stringValue(thread.id);
    if (!threadId) throw new Error("Codex App Server did not return a thread id.");

    const state = emptyState(input.workspace.id, input.chat.id);
    state.threadId = threadId;
    state.ready = true;
    this.bindState(state);

    await updateData((data) => {
      const chat = data.chats.find((item) => item.id === input.chat.id && item.workspaceId === input.workspace.id);
      if (chat) {
        chat.codexThreadId = threadId;
        chat.updatedAt = new Date().toISOString();
      }
    });
    input.chat.codexThreadId = threadId;

    return state;
  }

  private async getExistingOrResume(workspace: Workspace, chat: Chat) {
    const key = chatKey(workspace.id, chat.id);
    const cached = this.sessionsByChat.get(key);
    if (cached) return cached;
    if (!chat.codexThreadId) return null;
    return this.resumeThread(workspace, chat);
  }

  private async resumeThread(workspace: Workspace, chat: Chat): Promise<CodexAppSessionState> {
    if (!chat.codexThreadId) throw new Error("Chat has no Codex thread id.");
    const repoRoot = workspaceRepoRoot(workspace.id, chatMode(chat));
    const result = asObject(await this.request("thread/resume", {
      threadId: chat.codexThreadId,
      cwd: repoRoot,
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: codexAppSandbox(),
      developerInstructions: codexDeveloperInstructions({ workspace, chat }),
      excludeTurns: false,
      persistExtendedHistory: true
    }, 60_000));
    const thread = asObject(result.thread);
    const state = emptyState(workspace.id, chat.id);
    state.threadId = stringValue(thread.id) || chat.codexThreadId;
    state.ready = true;
    state.turns = turnsFromThread(thread);
    const status = statusValue(thread.status);
    if (status && status !== "idle" && status !== "completed") {
      state.running = /running|in_progress|busy/i.test(status);
      state.ready = !state.running;
    }
    this.bindState(state);
    return state;
  }

  private bindState(state: CodexAppSessionState) {
    this.sessionsByChat.set(chatKey(state.workspaceId, state.chatId), state);
    if (state.threadId) this.sessionsByThread.set(state.threadId, state);
  }

  private async refreshAuthStatus() {
    const result = asObject(await this.request("account/read", { refreshToken: false }, 15_000));
    const account = result.account === null ? null : asObject(result.account);
    this.login.available = true;
    this.login.authenticated = Boolean(account?.type);
    if (this.login.authenticated) {
      this.login.running = false;
      this.login.output = account?.type === "chatgpt" && stringValue(account.email)
        ? `Logged in as ${stringValue(account.email)}.`
        : "Codex is logged in.";
    } else if (!this.login.running) {
      this.login.output = "Codex is not logged in.";
    }
  }

  private async ensureInitialized() {
    if (this.initialized) return this.initialized;
    this.initialized = this.start();
    return this.initialized;
  }

  private async start() {
    this.child = spawn("codex", ["app-server"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      const line = chunk.trim();
      if (line) {
        this.login.output = [this.login.output, line].filter(Boolean).join("\n");
      }
    });
    this.child.on("error", (error) => {
      this.login.available = false;
      this.rejectAll(new Error(`Could not start Codex App Server. Verify the Codex CLI is on PATH. ${error.message}`));
    });
    this.child.on("close", (code) => {
      const error = new Error(`Codex App Server exited with code ${code ?? "unknown"}.`);
      for (const state of this.sessionsByChat.values()) {
        state.running = false;
        state.ready = false;
        state.lastError = error.message;
        state.turns.at(-1)?.actions.push({ kind: "generic", label: "App Server stopped", detail: error.message });
      }
      this.child = null;
      this.initialized = null;
      this.rejectAll(error);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "a2w-codex-bridge",
        title: "A2W Codex Bridge",
        version: "0.0.1"
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: []
      }
    }, 30_000);
    this.notify("initialized");
  }

  private request(method: string, params?: JsonValue, timeoutMs = 30_000): Promise<JsonValue> {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error("Codex App Server is not running."));
    const id = this.nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
    });
  }

  private notify(method: string, params?: JsonValue) {
    const child = this.child;
    if (!child?.stdin.writable) return;
    const payload = params === undefined ? { method } : { method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
  }

  private respond(id: string | number, result: JsonValue) {
    const child = this.child;
    if (!child?.stdin.writable) return;
    child.stdin.write(`${JSON.stringify({ id, result })}\n`, "utf8");
  }

  private onStdout(chunk: string) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.onMessage(JSON.parse(line) as RpcMessage);
      } catch {
        this.login.output = [this.login.output, line].filter(Boolean).join("\n");
      }
    }
  }

  private onMessage(message: RpcMessage) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || "Codex App Server request failed."));
      } else {
        pending.resolve(message.result ?? null);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.onServerRequest(message.id, message.method, message.params);
      return;
    }

    if (message.method) this.onNotification(message.method, message.params);
  }

  private onServerRequest(id: string | number, method: string, params: JsonValue | undefined) {
    const request = asObject(params);
    const state = this.stateForParams(request);
    if (state) {
      state.running = true;
      state.ready = false;
      currentTurn(state)?.actions.push({ kind: "generic", label: "Approval requested", detail: requestSummary(method, request) });
    }

    if (method === "item/commandExecution/requestApproval") {
      this.respond(id, { decision: "decline" });
      return;
    }
    if (method === "item/fileChange/requestApproval") {
      this.respond(id, { decision: "decline" });
      return;
    }
    if (method === "item/permissions/requestApproval") {
      this.respond(id, { permissions: {}, scope: "turn" });
      return;
    }
    if (method === "item/tool/requestUserInput") {
      this.respond(id, { answers: {} });
      return;
    }
    this.respond(id, null);
  }

  private onNotification(method: string, params: JsonValue | undefined) {
    const payload = asObject(params);
    if (method === "account/login/completed") {
      const success = Boolean(payload.success);
      this.login.running = false;
      this.login.authenticated = success;
      this.login.output = success
        ? "Codex login completed."
        : `Codex login failed${stringValue(payload.error) ? `: ${stringValue(payload.error)}` : "."}`;
      return;
    }

    const state = this.stateForParams(payload);
    if (!state) return;

    if (method === "thread/status/changed") {
      const status = statusValue(payload.status);
      state.running = status === "active" || /running|busy|in_progress/i.test(status);
      state.ready = !state.running;
      return;
    }

    if (method === "turn/started") {
      const turn = asObject(payload.turn);
      const turnId = stringValue(turn.id);
      if (turnId) {
        state.activeTurnId = turnId;
        const pendingTurn = state.turns.find((item) => item.id.startsWith("pending-") && item.status === "running");
        if (pendingTurn) pendingTurn.id = turnId;
      }
      state.running = true;
      state.ready = false;
      return;
    }

    if (method === "turn/plan/updated") {
      const turn = currentTurn(state);
      const steps = Array.isArray(payload.plan) ? payload.plan.map(asObject) : [];
      for (const step of steps.slice(-3)) {
        const label = stringValue(step.step);
        if (label) upsertAction(turn, { kind: "thinking", label: "Planning", detail: `${stringValue(step.status) || "pending"}: ${label}` });
      }
      return;
    }

    if (method === "item/started") {
      this.mergeItem(state, asObject(payload.item), "started");
      return;
    }

    if (method === "item/agentMessage/delta") {
      const turn = currentTurn(state);
      if (turn) {
        turn.response = `${turn.response}${stringValue(payload.delta)}`;
        turn.focusSummary = extractFocusSummary(turn.response) || turn.focusSummary;
      }
      return;
    }

    if (method === "item/reasoning/summaryPartAdded") {
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      appendReasoningSummary(currentTurn(state), stringValue(payload.delta));
      return;
    }

    if (method === "item/reasoning/textDelta") {
      return;
    }

    if (method === "item/commandExecution/outputDelta") {
      const turn = currentTurn(state);
      const delta = stringValue(payload.delta).trim();
      if (delta) upsertAction(turn, { kind: "command", label: "Output", detail: truncate(delta, 140) });
      return;
    }

    if (method === "item/fileChange/patchUpdated") {
      const turn = currentTurn(state);
      const changes = Array.isArray(payload.changes) ? payload.changes.length : 0;
      upsertAction(turn, { kind: "file", label: "Editing files", detail: changes ? `${changes} change${changes === 1 ? "" : "s"}` : undefined });
      return;
    }

    if (method === "item/completed") {
      this.mergeItem(state, asObject(payload.item), "completed");
      return;
    }

    if (method === "turn/completed") {
      const turn = currentTurn(state);
      const completed = asObject(payload.turn);
      if (turn) {
        turn.status = stringValue(completed.status) || "completed";
        if (turn.status === "failed") {
          const error = asObject(completed.error);
          upsertAction(turn, { kind: "generic", label: "Turn failed", detail: stringValue(error.message) || "Codex reported a failed turn." });
        }
      }
      state.running = false;
      state.ready = true;
      state.activeTurnId = undefined;
    }
  }

  private stateForParams(params: JsonObject) {
    const threadId = stringValue(params.threadId);
    return threadId ? this.sessionsByThread.get(threadId) || null : null;
  }

  private mergeItem(state: CodexAppSessionState, item: JsonObject, phase: "started" | "completed") {
    const type = stringValue(item.type);
    let turn = currentTurn(state);
    if (type === "userMessage") {
      const prompt = userInputText(item.content);
      if (!turn || (turn.response && phase === "completed")) {
        turn = { id: stringValue(item.id) || `turn-${state.turns.length + 1}`, prompt, response: "", actions: [] };
        state.turns.push(turn);
      } else if (!turn.prompt && prompt) {
        turn.prompt = prompt;
      }
      return;
    }
    if (!turn) return;

    if (type === "agentMessage") {
      const text = stringValue(item.text);
      if (text && text.length >= turn.response.length) {
        turn.response = text;
        turn.focusSummary = extractFocusSummary(text) || turn.focusSummary;
      }
      return;
    }
    if (type === "reasoning") {
      const summary = summaryText(item);
      if (summary) {
        upsertAction(turn, { kind: "thinking", label: "Reasoning", detail: truncate(summary, 260) });
      }
      return;
    }
    if (type === "plan") {
      upsertAction(turn, { kind: "thinking", label: "Plan", detail: truncate(stringValue(item.text), 140) });
      return;
    }
    if (type === "commandExecution") {
      const command = stringValue(item.command);
      const status = stringValue(item.status);
      upsertAction(turn, {
        kind: "command",
        label: phase === "started" || /running|in_progress/i.test(status) ? "Running" : "Ran",
        detail: command
      });
      return;
    }
    if (type === "fileChange") {
      const changes = Array.isArray(item.changes) ? item.changes.length : 0;
      upsertAction(turn, { kind: "file", label: phase === "started" ? "Editing" : "Edited", detail: changes ? `${changes} file change${changes === 1 ? "" : "s"}` : undefined });
      return;
    }
    if (type === "webSearch") {
      upsertAction(turn, { kind: "search", label: phase === "started" ? "Searching" : "Searched", detail: stringValue(item.query) });
      return;
    }
    if (type === "mcpToolCall" || type === "dynamicToolCall") {
      upsertAction(turn, { kind: "generic", label: phase === "started" ? "Using tool" : "Used tool", detail: stringValue(item.tool) });
    }
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
}

function getClient() {
  const globalState = globalThis as typeof globalThis & { __a2wCodexAppServer?: CodexAppServerClient };
  if (!globalState.__a2wCodexAppServer) globalState.__a2wCodexAppServer = new CodexAppServerClient();
  return globalState.__a2wCodexAppServer;
}

export async function getCodexAppLoginPane() {
  return getClient().getLoginPane();
}

export async function startCodexAppLogin() {
  return getClient().startLogin();
}

export async function stopCodexAppLogin() {
  return getClient().stopLogin();
}

export async function getCodexAppSession(input: { workspace: Workspace; chat: Chat }) {
  return getClient().getSession(input);
}

export async function ensureCodexAppSession(input: CodexAppInput) {
  return getClient().ensureSession(input);
}

export async function sendCodexAppMessage(input: CodexAppInput & { message: string }) {
  return getClient().sendMessage(input);
}

export async function interruptCodexAppSession(input: { workspace: Workspace; chat: Chat }) {
  return getClient().interrupt(input);
}

export async function stopCodexAppSession(input: { workspace: Workspace; chatId: string }) {
  return getClient().stopSession(input);
}

export async function getCodexAppLoginStatus() {
  try {
    const pane = await getClient().getLoginPane();
    return {
      available: pane.available,
      authenticated: pane.authenticated,
      output: pane.output
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      output: error instanceof Error ? error.message : String(error)
    };
  }
}

function textInput(text: string): JsonObject {
  return { type: "text", text };
}

function emptyState(workspaceId: string, chatId: string): CodexAppSessionState {
  return {
    workspaceId,
    chatId,
    running: false,
    ready: false,
    output: "",
    turns: []
  };
}

function publicSession(state: CodexAppSessionState): CodexAppSession {
  return {
    threadId: state.threadId,
    activeTurnId: state.activeTurnId,
    running: state.running,
    ready: state.ready,
    output: renderOutput(state),
    turns: state.turns.map(publicTurn)
  };
}

function publicTurn(turn: CodexAppTurn): CodexAppTurn {
  return {
    ...turn,
    actions: sanitizeActions(turn.actions)
  };
}

function renderOutput(state: CodexAppSessionState) {
  const lines: string[] = [];
  for (const turn of state.turns) {
    lines.push("Operator request:", turn.prompt, "A2W_END_OPERATOR_CONTEXT");
    for (const action of sanitizeActions(turn.actions)) {
      lines.push(action.detail ? `${action.label} ${action.detail}` : action.label);
    }
    if (turn.response) lines.push(turn.response);
  }
  if (state.lastError) lines.push(state.lastError);
  return lines.join("\n").trim();
}

function turnsFromThread(thread: JsonObject): CodexAppTurn[] {
  const turns = Array.isArray(thread.turns) ? thread.turns.map(asObject) : [];
  return turns.map((turn, index) => {
    const result: CodexAppTurn = {
      id: stringValue(turn.id) || `turn-${index + 1}`,
      prompt: "",
      response: "",
      actions: [],
      status: stringValue(turn.status)
    };
    const items = Array.isArray(turn.items) ? turn.items.map(asObject) : [];
    for (const item of items) mergeHistoricalItem(result, item);
    result.focusSummary = extractFocusSummary(result.response) || undefined;
    return result;
  }).filter((turn) => turn.prompt || turn.response || turn.actions.length);
}

function mergeHistoricalItem(turn: CodexAppTurn, item: JsonObject) {
  const type = stringValue(item.type);
  if (type === "userMessage") {
    turn.prompt = userInputText(item.content) || turn.prompt;
    return;
  }
  if (type === "agentMessage") {
    const text = stringValue(item.text);
    if (text) turn.response = `${turn.response}${turn.response ? "\n" : ""}${text}`;
    return;
  }
  if (type === "commandExecution") {
    turn.actions.push({ kind: "command", label: "Ran", detail: stringValue(item.command) });
    return;
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    turn.actions.push({ kind: "file", label: "Edited", detail: changes ? `${changes} file change${changes === 1 ? "" : "s"}` : undefined });
    return;
  }
  if (type === "webSearch") {
    turn.actions.push({ kind: "search", label: "Searched", detail: stringValue(item.query) });
    return;
  }
  if (type === "reasoning") {
    const summary = summaryText(item);
    if (summary) turn.actions.push({ kind: "thinking", label: "Reasoning", detail: truncate(summary, 260) });
  }
}

function currentTurn(state: CodexAppSessionState) {
  if (state.activeTurnId) {
    const active = state.turns.find((turn) => turn.id === state.activeTurnId);
    if (active) return active;
  }
  return state.turns.at(-1) || null;
}

function upsertAction(turn: CodexAppTurn | null, action: CodexAppAction) {
  if (!turn) return;
  if (isPlaceholderReasoningAction(action)) return;
  const last = turn.actions.at(-1);
  if (last && last.kind === action.kind && last.label === action.label && last.detail === action.detail) return;
  turn.actions.push(action);
}

function appendReasoningSummary(turn: CodexAppTurn | null, delta: string) {
  if (!turn || !delta) return;
  const existing = [...turn.actions].reverse().find((action) => action.kind === "thinking" && (action.label === "Thinking" || action.label === "Reasoning"));
  const cleanDelta = delta.replace(/\s+/g, " ");
  if (existing) {
    existing.label = "Reasoning";
    existing.detail = truncate(`${existing.detail || ""}${cleanDelta}`.replace(/\s+/g, " ").trim(), 260);
    return;
  }
  turn.actions.push({ kind: "thinking", label: "Reasoning", detail: truncate(cleanDelta.trim(), 260) });
}

function summaryText(item: JsonObject) {
  const summary = Array.isArray(item.summary)
    ? item.summary.filter((value): value is string => typeof value === "string")
    : [];
  return summary.join(" ").replace(/\s+/g, " ").trim();
}

function sanitizeActions(actions: CodexAppAction[]) {
  const result: CodexAppAction[] = [];
  for (const action of actions) {
    if (isObsoleteAction(action)) continue;
    const last = result.at(-1);
    if (last && last.kind === action.kind && last.label === action.label && last.detail === action.detail) continue;
    result.push({ ...action });
  }
  return result;
}

function isObsoleteAction(action: CodexAppAction) {
  if (action.label === "Starting turn") return true;
  if (action.kind === "thinking" && (action.label === "Thinking" || action.label === "Reasoned") && !action.detail) return true;
  return false;
}

function isPlaceholderReasoningAction(action: CodexAppAction) {
  return action.kind === "thinking" && (action.label === "Thinking" || action.label === "Reasoned") && !action.detail;
}

function userInputText(value: JsonValue | undefined) {
  const items = Array.isArray(value) ? value.map(asObject) : [];
  return items
    .map((item) => stringValue(item.text))
    .filter(Boolean)
    .map(cleanPromptText)
    .join("\n")
    .trim();
}

function cleanPromptText(text: string) {
  const match = text.match(/Operator request:\n([\s\S]*?)(?:\n\nA2W focus-summary skill:|\nA2W_END_OPERATOR_CONTEXT|$)/);
  return (match?.[1] || text).trim();
}

function turnInputText(input: CodexAppInput & { message: string }) {
  if (input.message.trim().startsWith("/")) return input.message;
  const rootContext = input.selectedRootPath ? `Active Terraform root: ${input.selectedRootPath}\n` : "";
  return [
    `A2W-Code mode: ${workspaceModeLabel(chatMode(input.chat))}.`,
    rootContext.trim(),
    input.providerConnection ? `Cloud context: ${input.provider} ${input.providerConnection.region}.` : `Cloud context: ${input.provider}.`,
    "",
    "Operator request:",
    input.message,
    "",
    "A2W_END_OPERATOR_CONTEXT"
  ].filter((line) => line !== "").join("\n");
}

function codexDeveloperInstructions(input: { workspace: Workspace; chat: Chat }) {
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

  return [
    "You are the local code-writing agent inside A2W-Code, a self-hosted Codex workspace.",
    ...profileRules,
    "",
    "A2W focus-summary protocol:",
    "- After your normal final response, append one final protocol line exactly like this:",
    "  A2W_FOCUS_SUMMARY: one direct first-person or second-person sentence under 160 characters for the person who sent the request.",
    "- Write it like you are speaking to that person, for example: \"I'm ready. What would you like to change?\"",
    "- Do not write third-person meta narration such as \"Greeted the user\" or \"Explained that...\".",
    "- Do not mention this protocol in the human response."
  ].join("\n");
}

function extractFocusSummary(text: string) {
  for (const line of text.split("\n")) {
    const match = line.match(/^A2W_FOCUS_SUMMARY:\s*(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function requestSummary(method: string, request: JsonObject) {
  if (method.includes("commandExecution")) return stringValue(request.command) || stringValue(request.reason) || "Command approval";
  if (method.includes("fileChange")) return stringValue(request.reason) || stringValue(request.grantRoot) || "File change approval";
  if (method.includes("permissions")) return stringValue(request.reason) || "Permission approval";
  return method;
}

function asObject(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value: JsonValue | undefined) {
  return typeof value === "string" ? value : "";
}

function statusValue(value: JsonValue | undefined) {
  if (typeof value === "string") return value;
  return stringValue(asObject(value).type);
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function chatKey(workspaceId: string, chatId: string) {
  return `${workspaceId}:${chatId}`;
}

function codexAppSandbox() {
  return "danger-full-access";
}

function codexAppSandboxPolicy(): JsonObject {
  return { type: "dangerFullAccess" };
}

function codexReasoningSummary() {
  const value = process.env.A2W_CODEX_REASONING_SUMMARY;
  if (value === "auto" || value === "concise" || value === "detailed" || value === "none") return value;
  return "detailed";
}

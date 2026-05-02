"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Chat, CloudProvider, GitAuthMethod, GitCommit, GitProvider, GitRepositoryMode, GitStashEntry, GitWorkspaceStatus, InfraPlan, Message, MessageAction, ProviderConnection, SandboxRun, TerraformRoot, TerraformVariableDefinition, WorkspaceMode } from "@/lib/types";
import { FilesBrowser } from "./FilesBrowser";
import { Icon } from "./Icon";
import { MarkdownMessage } from "./MarkdownMessage";
import { Modal } from "./Modal";
import { Toast } from "./Toast";
import { CodexFocusSphere, type CodexFocusAction, type CodexFocusStatus } from "./CodexFocusSphere";

const slashCommands = [
  {
    command: "/model",
    insert: "/model",
    group: "Codex",
    description: "Show or change the Codex model for this workspace.",
    kind: "codex"
  },
  {
    command: "/fast",
    insert: "/fast",
    group: "Codex",
    description: "Toggle Fast mode for faster inference with increased plan usage.",
    kind: "codex"
  },
  {
    command: "/permissions",
    insert: "/permissions",
    group: "Codex",
    description: "Choose what Codex is allowed to do.",
    kind: "codex"
  },
  {
    command: "/experimental",
    insert: "/experimental",
    group: "Codex",
    description: "Toggle experimental Codex features.",
    kind: "codex"
  },
  {
    command: "/memories",
    insert: "/memories",
    group: "Codex",
    description: "Configure memory use and generation.",
    kind: "codex"
  },
  {
    command: "/skills",
    insert: "/skills",
    group: "Codex",
    description: "Use skills to improve specific tasks.",
    kind: "codex"
  },
  {
    command: "/review",
    insert: "/review",
    group: "Codex",
    description: "Review current changes and find issues.",
    kind: "codex"
  },
  {
    command: "/rename",
    insert: "/rename ",
    group: "Codex",
    description: "Rename the current Codex thread.",
    kind: "codex"
  },
  {
    command: "/terraform-view-plan",
    insert: "/terraform-view-plan",
    group: "Terraform",
    description: "Open the current generated plan.",
    kind: "terraform",
    action: "view-plan"
  },
  {
    command: "/terraform-runs",
    insert: "/terraform-runs",
    group: "Terraform",
    description: "Open sandbox run history for the active root.",
    kind: "terraform",
    action: "runs"
  },
  {
    command: "/terraform-inputs",
    insert: "/terraform-inputs",
    group: "Terraform",
    description: "Open required variables for the active root.",
    kind: "terraform",
    action: "inputs"
  },
  {
    command: "/terraform-fmt",
    insert: "/terraform-fmt",
    group: "Terraform",
    description: "Run terraform fmt for the active root.",
    kind: "terraform",
    action: "fmt"
  },
  {
    command: "/terraform-plan",
    insert: "/terraform-plan",
    group: "Terraform",
    description: "Run terraform plan for the active root.",
    kind: "terraform",
    action: "plan"
  },
  {
    command: "/terraform-approve",
    insert: "/terraform-approve",
    group: "Terraform",
    description: "Record approval for the active plan.",
    kind: "terraform",
    action: "approve"
  },
  {
    command: "/terraform-apply",
    insert: "/terraform-apply",
    group: "Terraform",
    description: "Open the Terraform apply confirmation.",
    kind: "terraform",
    action: "apply"
  },
  {
    command: "/terraform-destroy",
    insert: "/terraform-destroy",
    group: "Terraform",
    description: "Open the Terraform destroy confirmation.",
    kind: "terraform",
    action: "destroy"
  },
  {
    command: "/npm-install",
    insert: "/npm-install",
    group: "NPM",
    description: "Install dependencies for the active web workspace.",
    kind: "npm",
    action: "install"
  },
  {
    command: "/npm-lint",
    insert: "/npm-lint",
    group: "NPM",
    description: "Run the lint script for the active web workspace.",
    kind: "npm",
    action: "lint"
  },
  {
    command: "/npm-audit",
    insert: "/npm-audit",
    group: "NPM",
    description: "Audit dependencies for known vulnerabilities.",
    kind: "npm",
    action: "audit"
  },
  {
    command: "/npm-test",
    insert: "/npm-test",
    group: "NPM",
    description: "Run the test script for the active web workspace.",
    kind: "npm",
    action: "test"
  },
  {
    command: "/npm-build",
    insert: "/npm-build",
    group: "NPM",
    description: "Run the build script for the active web workspace.",
    kind: "npm",
    action: "build"
  }
] as const;
type SlashCommand = (typeof slashCommands)[number];
type TerraformSlashAction = Extract<SlashCommand, { kind: "terraform" }>["action"];
type NpmSlashAction = Extract<SlashCommand, { kind: "npm" }>["action"];

type SandboxMode = SandboxRun["mode"];
type FileEntry = {
  path: string;
  size: number;
  updatedAt: string;
};
type ChatThread = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  icon: string;
};
type CodexTmuxPane = {
  sessionName: string;
  target: string;
  running: boolean;
  ready: boolean;
  viewingTranscript?: boolean;
  stagedInput?: string;
  output: string;
};
type CodexControlKey = "up" | "down" | "enter" | "escape";
type ChatDisplayMode = "transcript" | "focus";
const EDITOR_TREE_EXPANDED_STORAGE_KEY = "a2w.editor.fileTree.expanded.v1";
const CHAT_DISPLAY_MODE_STORAGE_KEY = "a2w.chat.displayMode.v1";
const WORKSPACE_RETURN_MODE_STORAGE_KEY = "a2w.workspace.returnMode";
const WORKSPACE_TREE_POLL_INTERVAL_MS = 5000;
const CHAT_UPSERT_EVENT = "a2w:chat-upsert";
const CHAT_DELETE_EVENT = "a2w:chat-delete";
const CHAT_BOTTOM_THRESHOLD_PX = 140;

function scrollChatToBottom(element: HTMLDivElement | null) {
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}

function isNearScrollBottom(element: HTMLDivElement | null) {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight < CHAT_BOTTOM_THRESHOLD_PX;
}

function readChatDisplayMode(): ChatDisplayMode {
  if (typeof window === "undefined") return "focus";
  try {
    return window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY) === "transcript" ? "transcript" : "focus";
  } catch {
    return "focus";
  }
}

function normalizeWorkspaceModeFromStorage(): WorkspaceMode | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(WORKSPACE_RETURN_MODE_STORAGE_KEY);
  return value === "infra" || value === "web" ? value : null;
}

function alternateWorkspaceMode(mode: WorkspaceMode): WorkspaceMode {
  return mode === "web" ? "infra" : "web";
}

function isUntitledChatTitle(title: string) {
  return title.trim().toLowerCase() === "new chat";
}

function persistChatDisplayMode(mode: ChatDisplayMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // Display mode is preference-only; the chat remains usable without persistence.
  }
}

export function AgentChat({
  chats,
  messages,
  plans,
  sandboxRuns,
  terraformRoots,
  gitStatus,
  workspaceMode,
  provider,
  providerConnection,
  selectedTerraformRoot,
  initialPrompt,
  initialChatId,
  applyDisabled,
  applyRuntimeEnabled
}: {
  chats: Chat[];
  messages: Message[];
  plans: InfraPlan[];
  sandboxRuns: SandboxRun[];
  terraformRoots: TerraformRoot[];
  gitStatus: GitWorkspaceStatus;
  workspaceMode: WorkspaceMode;
  provider: CloudProvider;
  providerConnection?: Omit<ProviderConnection, "secrets">;
  selectedTerraformRoot?: string;
  initialPrompt?: string;
  initialChatId?: string;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialPrompt || "");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const initialPlan = initialChatId ? plans.filter((plan) => plan.chatId === initialChatId).at(-1) : null;
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initialPlan?.id || plans.at(-1)?.id || null);
  const initialRootPath = selectedTerraformRoot || (initialPlan ? terraformCallDirs(initialPlan)[0] : "") || terraformRoots.at(-1)?.path || "";
  const [selectedRootPath, setSelectedRootPath] = useState(initialRootPath);
  const [roots, setRoots] = useState(terraformRoots);
  const [git, setGit] = useState(gitStatus);
  const [chatList, setChatList] = useState(chats);
  const [gitHistory, setGitHistory] = useState<GitCommit[]>([]);
  const [gitStashes, setGitStashes] = useState<GitStashEntry[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(initialChatId || "new");
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [commitPushOpen, setCommitPushOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);
  const [profileSetupOpen, setProfileSetupOpen] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [savingVariables, setSavingVariables] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("Update Terraform workspace");
  const [stashMessage, setStashMessage] = useState("A2W workspace checkpoint");
  const [sandboxPlan, setSandboxPlan] = useState<InfraPlan | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [modalFiles, setModalFiles] = useState<FileEntry[]>([]);
  const [editorFiles, setEditorFiles] = useState<FileEntry[]>([]);
  const [editorFilesLoading, setEditorFilesLoading] = useState(false);
  const [filePanelOpen, setFilePanelOpen] = useState(false);
  const [filePanelPath, setFilePanelPath] = useState<string | null>(null);
  const [codexPane, setCodexPane] = useState<CodexTmuxPane | null>(null);
  const [activeProviderConnection, setActiveProviderConnection] = useState(providerConnection);
  const [slashIndex, setSlashIndex] = useState(0);
  const [displayMode, setDisplayMode] = useState<ChatDisplayMode>("focus");
  const [engagedChatIds, setEngagedChatIds] = useState<Set<string>>(() => new Set());
  const [codexCancelFlash, setCodexCancelFlash] = useState(false);
  const [sandboxFailureFlash, setSandboxFailureFlash] = useState(false);
  const [displayModeReady, setDisplayModeReady] = useState(false);
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [mode, setMode] = useState<SandboxMode>("terraform-fmt");
  const [applyConfirm, setApplyConfirm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const codexPickerKeyRequest = useRef(0);
  const focusSummaryPostKeyRef = useRef("");
  const submitAbortRef = useRef<AbortController | null>(null);
  const cancelFlashTimeoutRef = useRef<number | null>(null);
  const sandboxFailureFlashTimeoutRef = useRef<number | null>(null);
  const sandboxFailureSeenRunIdRef = useRef<string | null | undefined>(undefined);
  const newChatMode = activeChatId === "new";
  const editorMode = !newChatMode;
  const profileNeedsSetup = !git.initialized;
  const codexBusy = editorMode && Boolean(codexPane?.running && !codexPane.ready && !codexPane.viewingTranscript && !codexPane.stagedInput);
  const codexStagedInput = codexBusy ? codexPane?.stagedInput : "";
  const slashQuery = slashCommandQuery(value);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    return slashCommands.filter((item) => item.command.startsWith(slashQuery) && slashCommandAllowedForMode(item, workspaceMode));
  }, [slashQuery, workspaceMode]);
  const slashOpen = slashMatches.length > 0;
  const slashMode = slashQuery !== null;
  const slashPaletteOpen = slashOpen && !mobileActionsOpen;
  const selectedSlashCommand = slashMatches[slashIndex] || null;
  const exactSlashCommand = slashMatches.find((item) => item.command === slashQuery) || null;
  const codexPicker = useMemo(() => editorMode ? parseCodexChoicePicker(codexPane?.output || "") : null, [editorMode, codexPane?.output]);
  const codexCancellable = editorMode && activeChatId !== "new" && !profileNeedsSetup && Boolean(loading || pendingStatus || codexBusy || codexPicker || (codexPane?.running && !codexPane.ready));
  const codexTurns = useMemo(() => parseCodexPaneTurns(codexPane?.output || ""), [codexPane?.output]);

  const chatThreads = useMemo(() => buildChatThreads(chatList, messages, plans), [chatList, messages, plans]);
  const activeChat = useMemo(() => chatList.find((chat) => chat.id === activeChatId) || null, [activeChatId, chatList]);
  const visibleMessages = useMemo(() => {
    if (activeChatId === "new") return [];
    return messages.filter((message) => message.chatId === activeChatId);
  }, [activeChatId, messages]);
  const freshChatMode = editorMode && Boolean(activeChat && isUntitledChatTitle(activeChat.title) && visibleMessages.length === 0 && !engagedChatIds.has(activeChatId));

  const selectedRoot = useMemo(() => {
    return roots.find((root) => root.path === selectedRootPath) || roots.find((root) => selectedPlanId && root.planId === selectedPlanId) || roots.at(-1) || null;
  }, [roots, selectedPlanId, selectedRootPath]);

  const selectedPlan = useMemo(() => {
    if (activeChatId === "new") return null;
    const rootPlan = selectedRoot?.planId ? plans.find((plan) => plan.id === selectedRoot.planId) : null;
    if (rootPlan) return rootPlan;
    const activeChatPlan = activeChatId === "new" ? null : plans.filter((plan) => plan.chatId === activeChatId).at(-1) || null;
    const selected = plans.find((plan) => plan.id === selectedPlanId && plan.chatId === activeChatId);
    return selected || activeChatPlan || null;
  }, [activeChatId, plans, selectedPlanId, selectedRoot?.planId]);

  const selectedRuns = useMemo(() => {
    if (!selectedPlan) return null;
    return sandboxRuns.filter((run) => run.planId === selectedPlan.id);
  }, [sandboxRuns, selectedPlan]);
  const selectedRun = selectedRuns?.at(-1) || null;
  const activeSandboxRuns = useMemo(() => {
    if (activeChatId === "new") return [];
    return sandboxRuns.filter((run) => sandboxRunBelongsToChat(run, activeChatId, plans));
  }, [activeChatId, plans, sandboxRuns]);
  const latestFailedSandboxRun = useMemo(() => activeSandboxRuns.filter((run) => run.status === "failed").at(-1) || null, [activeSandboxRuns]);
  const missingRequiredVariables = useMemo(() => {
    return (selectedRoot?.variables || []).filter((variable) => variable.required && !variable.value);
  }, [selectedRoot?.variables]);

  const approvalStatusPlan = useMemo(() => {
    return plans
      .filter((plan) => plan.status.includes("approved"))
      .filter((plan) => !messages.some((message) => message.planId === plan.id && message.content.startsWith(`Approval recorded for ${plan.title}.`)))
      .at(-1) || null;
  }, [messages, plans]);
  const activeApprovalStatusPlan = approvalStatusPlan?.chatId === activeChatId ? approvalStatusPlan : null;
  const focusModeActive = editorMode && !freshChatMode && displayMode === "focus";
  const minimalChatMode = newChatMode || freshChatMode;
  const immersiveMode = focusModeActive || minimalChatMode;
  const focusState = useMemo(() => buildCodexFocusState({
    pane: codexPane,
    turns: codexTurns,
    loading,
    pendingStatus,
    missingVariables: missingRequiredVariables.length,
    git,
    root: selectedRoot,
    selectedRun,
    sandboxRuns: activeSandboxRuns,
    chatSummary: activeChat?.focusSummary
  }), [activeChat?.focusSummary, activeSandboxRuns, codexPane, codexTurns, git, loading, missingRequiredVariables.length, pendingStatus, selectedRoot, selectedRun]);
  const visualFocusStatus = codexCancelFlash ? "cancelled" : sandboxFailureFlash ? "error" : focusState.status;
  const visualFocusLabel = codexCancelFlash ? "Stopped" : sandboxFailureFlash ? "Action failed" : focusState.statusLabel;
  const visualFocusDetail = codexCancelFlash
    ? "Codex was interrupted."
    : sandboxFailureFlash
      ? latestFailedSandboxRun ? `${modeLabel(latestFailedSandboxRun.mode)} needs review.` : "The latest sandbox action failed."
      : focusState.detail;

  function cancelActiveCodex() {
    if (!codexCancellable) return;
    submitAbortRef.current?.abort();
    submitAbortRef.current = null;
    setLoading(false);
    setPendingStatus(null);
    if (cancelFlashTimeoutRef.current) window.clearTimeout(cancelFlashTimeoutRef.current);
    setCodexCancelFlash(true);
    cancelFlashTimeoutRef.current = window.setTimeout(() => {
      setCodexCancelFlash(false);
      cancelFlashTimeoutRef.current = null;
    }, 1500);
    void sendCodexControlKey("escape", { flashCancel: true });
  }

  useEffect(() => {
    setChatList(chats);
  }, [chats]);

  useEffect(() => {
    return () => {
      if (cancelFlashTimeoutRef.current) window.clearTimeout(cancelFlashTimeoutRef.current);
      if (sandboxFailureFlashTimeoutRef.current) window.clearTimeout(sandboxFailureFlashTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (sandboxFailureSeenRunIdRef.current === undefined) {
      sandboxFailureSeenRunIdRef.current = latestFailedSandboxRun?.id || null;
      return;
    }
    if (!latestFailedSandboxRun || sandboxFailureSeenRunIdRef.current === latestFailedSandboxRun.id) return;

    sandboxFailureSeenRunIdRef.current = latestFailedSandboxRun.id;
    if (sandboxFailureFlashTimeoutRef.current) window.clearTimeout(sandboxFailureFlashTimeoutRef.current);
    setSandboxFailureFlash(true);
    sandboxFailureFlashTimeoutRef.current = window.setTimeout(() => {
      setSandboxFailureFlash(false);
      sandboxFailureFlashTimeoutRef.current = null;
    }, 1800);
  }, [latestFailedSandboxRun?.id]);

  useEffect(() => {
    if (activeChatId === "new" || !codexPane?.ready || !focusState.responseSummary) return;
    if (activeChat?.focusSummary === focusState.responseSummary) return;

    const postKey = `${activeChatId}:${focusState.responseSummary}`;
    if (focusSummaryPostKeyRef.current === postKey) return;
    focusSummaryPostKeyRef.current = postKey;

    fetch(`/api/chats/${encodeURIComponent(activeChatId)}/focus-summary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: focusState.responseSummary })
    })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.chat) return;
        setChatList((current) => current.map((chat) => chat.id === data.chat.id ? data.chat : chat));
      })
      .catch(() => {
        focusSummaryPostKeyRef.current = "";
      });
  }, [activeChat?.focusSummary, activeChatId, codexPane?.ready, focusState.responseSummary]);

  useEffect(() => {
    if (profileNeedsSetup) setProfileSetupOpen(true);
  }, [profileNeedsSetup, workspaceMode]);

  useEffect(() => {
    setDisplayMode(readChatDisplayMode());
    setDisplayModeReady(true);
  }, []);

  useEffect(() => {
    if (!displayModeReady) return undefined;
    persistChatDisplayMode(displayMode);
    if (displayMode === "transcript") {
      shouldAutoScrollRef.current = true;
      const frame = window.requestAnimationFrame(() => scrollChatToBottom(scrollRef.current));
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [displayMode, displayModeReady]);

  useEffect(() => {
    function handleChatUpsert(event: Event) {
      const chat = (event as CustomEvent<Chat>).detail;
      if (!chat?.id) return;
      setChatList((current) => current.some((item) => item.id === chat.id)
        ? current.map((item) => item.id === chat.id ? chat : item)
        : [chat, ...current]);
    }

    function handleChatDelete(event: Event) {
      const chatId = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!chatId) return;
      setChatList((current) => current.filter((chat) => chat.id !== chatId));
    }

    window.addEventListener(CHAT_UPSERT_EVENT, handleChatUpsert);
    window.addEventListener(CHAT_DELETE_EVENT, handleChatDelete);
    return () => {
      window.removeEventListener(CHAT_UPSERT_EVENT, handleChatUpsert);
      window.removeEventListener(CHAT_DELETE_EVENT, handleChatDelete);
    };
  }, []);

  useEffect(() => {
    setActiveProviderConnection(providerConnection);
  }, [providerConnection]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    const frame = window.requestAnimationFrame(() => scrollChatToBottom(scrollRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [activeChatId]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    const frame = window.requestAnimationFrame(() => scrollChatToBottom(scrollRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [visibleMessages.length, pendingStatus, activeApprovalStatusPlan?.id, codexPane?.output]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!mobileActionsOpen) return;
    if (value.trim() === "/") setValue("");
  }, [mobileActionsOpen, value]);

  useEffect(() => {
    if (!editorMode || activeChatId === "new") return;
    let cancelled = false;

    async function refreshWorkspaceState() {
      try {
        const filesResponse = await fetch("/api/files");
        const filesData = await filesResponse.json();
        if (!cancelled) setEditorFiles(filesData.files || []);
      } catch {
        // Keep background refresh quiet; explicit file actions still show errors.
      }
      try {
        if (!cancelled) await refreshGit();
      } catch {
        // Git may be uninitialized while onboarding or first edits are in progress.
      }
    }

    void refreshWorkspaceState();
    const timer = window.setInterval(refreshWorkspaceState, WORKSPACE_TREE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [editorMode, activeChatId]);

  useEffect(() => {
    if (!editorMode || activeChatId === "new") {
      setCodexPane(null);
      return;
    }

    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/codex/tmux?chatId=${encodeURIComponent(activeChatId)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setCodexPane(data.pane || null);
      } catch {
        // The pane is best-effort UI state; send failures still surface through submit.
      }
    }

    void poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [editorMode, activeChatId]);

  useEffect(() => {
    if (!editorMode || activeChatId === "new") return;

    function cancelCodexOnEscape(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== "Escape" || event.repeat) return;
      if (!codexCancellable) return;
      event.preventDefault();
      cancelActiveCodex();
    }

    window.addEventListener("keydown", cancelCodexOnEscape);
    return () => window.removeEventListener("keydown", cancelCodexOnEscape);
  }, [activeChatId, codexBusy, codexCancellable, codexPane?.ready, codexPane?.running, codexPicker, editorMode, loading, pendingStatus, profileNeedsSetup]);

  useEffect(() => {
    if (!pendingStatus || (!pendingStatus.startsWith("Opening Codex") && !pendingStatus.startsWith("Running /"))) return;
    if (codexPicker || codexPane?.ready) setPendingStatus(null);
  }, [codexPane?.ready, codexPicker, pendingStatus]);

  useEffect(() => {
    setRoots(terraformRoots);
    setGit(gitStatus);
    const nextRoot = selectedTerraformRoot || selectedRootPath || terraformRoots.at(-1)?.path || "";
    if (nextRoot && terraformRoots.some((root) => root.path === nextRoot)) setSelectedRootPath(nextRoot);
  }, [gitStatus, selectedTerraformRoot, selectedRootPath, terraformRoots]);

  useEffect(() => {
    if (activeChatId === "new") {
      setSelectedPlanId(null);
      return;
    }
    const activePlan = plans.filter((plan) => plan.chatId === activeChatId).at(-1) || null;
    if (!selectedPlanId || !plans.some((plan) => plan.id === selectedPlanId && plan.chatId === activeChatId)) {
      setSelectedPlanId(activePlan?.id || null);
    }
  }, [activeChatId, plans, selectedPlanId]);

  useEffect(() => {
    if (activeChatId !== "new" && !chatList.some((chat) => chat.id === activeChatId)) {
      setActiveChatId("new");
    }
  }, [activeChatId, chatList]);

  useEffect(() => {
    const nextChatId = initialChatId || "new";
    setActiveChatId(nextChatId);
    if (nextChatId === "new") {
      setSelectedPlanId(null);
      setValue(initialPrompt || "");
      setPlanModalOpen(false);
      setSandboxPlan(null);
      setFilePanelOpen(false);
    }
  }, [initialChatId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (slashMode) return;
    if (profileNeedsSetup) {
      setProfileSetupOpen(true);
      return;
    }
    const message = value.trim();
    if (!message) return;
    const startingNewChat = activeChatId === "new";
    const submitController = new AbortController();
    submitAbortRef.current?.abort();
    submitAbortRef.current = submitController;
    setLoading(true);

    try {
      let targetChatId = activeChatId;
      if (startingNewChat) {
        setPendingStatus("Starting Codex chat...");
        const chatResponse = await fetch("/api/chats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: workspaceMode }),
          signal: submitController.signal
        });
        const chatData = await chatResponse.json();
        if (!chatResponse.ok || !chatData.chat?.id) throw new Error(chatData.error || "Could not create chat.");
        targetChatId = chatData.chat.id;
        setChatList((current) => current.some((item) => item.id === chatData.chat.id)
          ? current.map((item) => item.id === chatData.chat.id ? chatData.chat : item)
          : [chatData.chat, ...current]);
        window.dispatchEvent(new CustomEvent(CHAT_UPSERT_EVENT, { detail: chatData.chat }));
        setActiveChatId(chatData.chat.id);
        router.replace(`/dashboard/agent?chat=${encodeURIComponent(chatData.chat.id)}`);
        setPendingStatus("Submitting to Codex...");
      }
      if (targetChatId !== "new") {
        setEngagedChatIds((current) => new Set(current).add(targetChatId));
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, mode: workspaceMode, provider, chatId: targetChatId === "new" ? undefined : targetChatId, rootPath: selectedRoot?.path }),
        signal: submitController.signal
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate plan.");
      setValue("");
      if (data.chat?.id) {
        setChatList((current) => current.some((item) => item.id === data.chat.id)
          ? current.map((item) => item.id === data.chat.id ? data.chat : item)
          : [data.chat, ...current]);
        window.dispatchEvent(new CustomEvent(CHAT_UPSERT_EVENT, { detail: data.chat }));
        setActiveChatId(data.chat.id);
      }
      if (data.plan?.id) setSelectedPlanId(data.plan.id);
      if (data.pane) setCodexPane(data.pane);
      flash(data.pane ? "Sent to Codex tmux pane" : data.plan ? "Plan generated and files written" : "Message sent");
      void refreshEditorFiles();
      void refreshGit();
      if (data.chat?.id) router.replace(`/dashboard/agent?chat=${encodeURIComponent(data.chat.id)}`);
      else router.refresh();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      if (submitAbortRef.current === submitController) submitAbortRef.current = null;
      if (!submitController.signal.aborted) {
        setLoading(false);
        setPendingStatus(null);
      }
    }
  }

  function completeSlashCommand(command = slashMatches[slashIndex]) {
    if (!command) return;
    setValue(command.insert);
  }

  async function executeSlashCommand(command = exactSlashCommand || selectedSlashCommand) {
    if (!command || loading) return;
    if (command.kind === "terraform") {
      executeTerraformSlashCommand(command.action);
      return;
    }
    if (command.kind === "npm") {
      executeNpmSlashCommand(command.action);
      return;
    }
    if (codexBusy) return;
    setPendingStatus(command.command === "/model" ? "Opening Codex model picker..." : `Running ${command.command} in Codex...`);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: command.command, mode: workspaceMode, provider, chatId: activeChatId === "new" ? undefined : activeChatId, rootPath: selectedRoot?.path })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not execute Codex command.");
      setValue("");
      if (data.chat?.id) {
        setChatList((current) => current.some((item) => item.id === data.chat.id)
          ? current.map((item) => item.id === data.chat.id ? data.chat : item)
          : [data.chat, ...current]);
        window.dispatchEvent(new CustomEvent(CHAT_UPSERT_EVENT, { detail: data.chat }));
        setActiveChatId(data.chat.id);
      }
      if (data.pane) setCodexPane(data.pane);
      if (data.chat?.id) router.replace(`/dashboard/agent?chat=${encodeURIComponent(data.chat.id)}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
      setPendingStatus(null);
    } finally {
      setLoading(false);
    }
  }

  function executeTerraformSlashCommand(action: TerraformSlashAction) {
    setValue("");

    if (action === "inputs") {
      if (!selectedRoot) {
        flash("No active Terraform root selected");
        return;
      }
      openVariables();
      return;
    }

    if (action === "runs") {
      if (!selectedRoot) {
        flash("No active Terraform root selected");
        return;
      }
      setRunsOpen(true);
      return;
    }

    if (!selectedPlan) {
      flash("No active Terraform plan selected");
      return;
    }

    if (action === "view-plan") {
      setPlanModalOpen(true);
      return;
    }
    if (action === "fmt") {
      openSandbox(selectedPlan, "terraform-fmt");
      return;
    }
    if (action === "plan") {
      openSandbox(selectedPlan, "terraform-plan");
      return;
    }
    if (action === "approve") {
      void approve(selectedPlan);
      return;
    }
    if (action === "apply") {
      openSandbox(selectedPlan, "terraform-apply");
      return;
    }
    if (action === "destroy") {
      openSandbox(selectedPlan, "terraform-destroy");
    }
  }

  function executeNpmSlashCommand(action: NpmSlashAction) {
    setValue("");
    const nextMode = npmActionMode(action);
    void runWorkspaceSandbox(nextMode, action === "install" || action === "audit");
  }

  async function sendCodexControlKey(key: CodexControlKey, options: { requirePicker?: boolean; flashCancel?: boolean } = {}) {
    if (activeChatId === "new" || (options.requirePicker && !codexPicker)) return;
    const requestId = codexPickerKeyRequest.current + 1;
    codexPickerKeyRequest.current = requestId;
    try {
      const response = await fetch("/api/codex/tmux", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: activeChatId, action: "key", key })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not control Codex.");
      if (data.pane && requestId === codexPickerKeyRequest.current) setCodexPane(data.pane);
      if (options.flashCancel) flash("Cancel sent to Codex");
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  function handleCodexPickerKeyDown(event: { key: string; shiftKey: boolean; preventDefault: () => void }) {
    const key = codexPickerControlKey(event.key);
    if (!codexPicker || !key || event.shiftKey) return false;
    event.preventDefault();
    void sendCodexControlKey(key, { requirePicker: true });
    return true;
  }

  async function approve(plan: InfraPlan) {
    setPendingStatus(`Recording approval for ${plan.title}...`);
    setLoading(true);
    try {
      const response = await fetch(`/api/plans/${plan.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: activeChatId === "new" ? undefined : activeChatId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not approve plan.");
      setSelectedPlanId(plan.id);
      flash("Plan approved");
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      window.setTimeout(() => setPendingStatus(null), 900);
    }
  }

  async function runSandbox(nextPlan = sandboxPlan, nextMode = mode, nextAllowNetwork = allowNetwork, nextConfirm = applyConfirm) {
    if (isTerraformSandboxMode(nextMode) && !nextPlan) return;
    const plan = nextPlan;
    const currentMode = nextMode;
    const label = modeLabel(currentMode, true);
    setSandboxPlan(null);
    setPendingStatus(`${label} for ${plan?.title || "workspace"}...`);
    setLoading(true);

    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan?.id,
          rootPath: selectedRoot?.path,
          mode: currentMode,
          allowNetwork: nextAllowNetwork,
          confirm: nextConfirm,
          chatId: activeChatId === "new" ? undefined : activeChatId
        })
      });
      const data = await response.json();
      if (!response.ok && !data.run) throw new Error(data.error || "Sandbox run failed.");
      setApplyConfirm("");
      if (plan?.id) setSelectedPlanId(plan.id);
      flash(data.run?.status === "succeeded" ? `${label} succeeded` : `${label} failed`);
      void refreshEditorFiles();
      void refreshGit();
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      window.setTimeout(() => setPendingStatus(null), 900);
    }
  }

  async function openFiles() {
    setFilesOpen(true);
    setFilesLoading(true);
    try {
      const response = await fetch("/api/files");
      const data = await response.json();
      setModalFiles(data.files || []);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setFilesLoading(false);
    }
  }

  function openFilePanel(path: string) {
    setFilePanelPath(path);
    setFilePanelOpen(true);
  }

  async function refreshEditorFiles() {
    setEditorFilesLoading(true);
    try {
      const response = await fetch("/api/files");
      const data = await response.json();
      setEditorFiles(data.files || []);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setEditorFilesLoading(false);
    }
  }

  function flash(message: string, timeout = 2000) {
    setToast(message);
    window.setTimeout(() => setToast(null), timeout);
  }

  function openPlan(plan: InfraPlan) {
    setSelectedPlanId(plan.id);
    if (plan.chatId) setActiveChatId(plan.chatId);
    setPlanModalOpen(true);
  }

  function openSandbox(plan: InfraPlan, nextMode: SandboxMode = "terraform-fmt") {
    setMode(nextMode);
    const nextAllowNetwork = nextMode === "terraform-plan" || nextMode === "terraform-apply" || nextMode === "terraform-destroy";
    setAllowNetwork(nextAllowNetwork);
    setApplyConfirm("");
    if (nextMode === "terraform-apply" || nextMode === "terraform-destroy") {
      setSandboxPlan(plan);
      return;
    }
    void runSandbox(plan, nextMode, nextAllowNetwork, "");
  }

  function runWorkspaceSandbox(nextMode: SandboxMode, nextAllowNetwork = false) {
    setMode(nextMode);
    setAllowNetwork(nextAllowNetwork);
    setApplyConfirm("");
    void runSandbox(null, nextMode, nextAllowNetwork, "");
  }

  function openVariables() {
    if (!selectedRoot) return;
    setVariableValues(Object.fromEntries(selectedRoot.variables.map((variable) => [variable.name, variable.sensitive ? "" : variable.value || ""])));
    setVariablesOpen(true);
  }

  async function saveVariables() {
    if (!selectedRoot) return;
    setSavingVariables(true);
    try {
      const response = await fetch("/api/terraform/variables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: selectedRoot.path, values: variableValues })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save Terraform variables.");
      flash("Terraform inputs saved");
      setVariablesOpen(false);
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingVariables(false);
    }
  }

  async function selectRoot(path: string) {
    setSelectedRootPath(path);
    const root = roots.find((item) => item.path === path);
    if (root?.planId) setSelectedPlanId(root.planId);
    try {
      const response = await fetch("/api/terraform/roots", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: path })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not select Terraform root.");
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshGit(details = false) {
    const response = await fetch(`/api/git${details ? "?details=1" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load Git status.");
    setGit(data.git);
    if (data.history) setGitHistory(data.history);
    if (data.stashes) setGitStashes(data.stashes);
    return data.git as GitWorkspaceStatus;
  }

  async function openDiff() {
    setDiffOpen(true);
    try {
      await refreshGit();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function openGit() {
    setGitOpen(true);
    try {
      await refreshGit(true);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function openCommitPush() {
    setCommitPushOpen(true);
    try {
      await refreshGit(true);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function openMerge() {
    setMergeOpen(true);
    try {
      await refreshGit(true);
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    }
  }

  async function gitAction(action: string, body: Record<string, unknown> = {}, success = "Git action completed") {
    setGitLoading(true);
    try {
      const response = await fetch("/api/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...body })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Git action failed.");
      setGit(data.git);
      setGitHistory(data.history || []);
      setGitStashes(data.stashes || []);
      flash(success);
      router.refresh();
      return true;
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setGitLoading(false);
    }
  }

  async function commitAllAndPush() {
    setGitLoading(true);
    try {
      const commitResponse = await fetch("/api/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "commit", message: commitMessage, mode: "all" })
      });
      const commitData = await commitResponse.json();
      if (!commitResponse.ok) throw new Error(commitData.error || "Git commit failed.");
      setGit(commitData.git);
      setGitHistory(commitData.history || []);
      setGitStashes(commitData.stashes || []);

      const pushResponse = await fetch("/api/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "push" })
      });
      const pushData = await pushResponse.json();
      if (!pushResponse.ok) throw new Error(pushData.error || "Git push failed.");
      setGit(pushData.git);
      setGitHistory(pushData.history || []);
      setGitStashes(pushData.stashes || []);
      flash("Committed and pushed");
      setCommitPushOpen(false);
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setGitLoading(false);
    }
  }

  async function completeProfileSetup(input: {
    cloudProvider?: CloudProvider;
    cloudDetails?: Record<string, string>;
    gitProvider: GitProvider;
    repositoryMode: GitRepositoryMode;
    repositoryUrl: string;
    repositoryName: string;
    repositoryOwner: string;
    repositoryBranch: string;
    gitAuthMethod: GitAuthMethod;
    gitUsername: string;
    gitToken: string;
    gitSshPrivateKey: string;
    nextjsAppName: string;
    nextjsHeroText: string;
  }) {
    setLoading(true);
    setPendingStatus(workspaceMode === "infra" ? "Setting up infra cloud credentials..." : "Setting up web repository...");
    try {
      if (workspaceMode === "infra" && input.cloudProvider && input.cloudDetails) {
        const providerResponse = await fetch("/api/provider-connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: input.cloudProvider,
            ...input.cloudDetails
          })
        });
        const providerData = await providerResponse.json();
        if (!providerResponse.ok) throw new Error(providerData.error || providerData.errors?.join(" ") || "Could not configure cloud credentials.");
        if (providerData.connection) setActiveProviderConnection(providerData.connection);
      }

      setPendingStatus(`Setting up ${workspaceMode === "web" ? "web" : "infra"} repository...`);
      const gitResponse = await fetch("/api/onboarding/git/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: workspaceMode,
          gitProvider: input.gitProvider,
          repositoryMode: input.repositoryMode,
          repositoryUrl: input.repositoryUrl,
          repositoryName: input.repositoryName,
          repositoryOwner: input.repositoryOwner,
          repositoryBranch: input.repositoryBranch,
          gitAuthMethod: input.gitAuthMethod,
          gitUsername: input.gitUsername,
          gitToken: input.gitToken,
          gitSshPrivateKey: input.gitSshPrivateKey,
          nextjsAppName: input.nextjsAppName,
          nextjsHeroText: input.nextjsHeroText
        })
      });
      const gitData = await gitResponse.json();
      if (!gitResponse.ok) throw new Error(gitData.error || "Could not configure repository.");
      if (gitData.git) setGit(gitData.git);

      const chatResponse = await fetch("/api/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: workspaceMode })
      });
      const chatData = await chatResponse.json();
      if (!chatResponse.ok || !chatData.chat?.id) throw new Error(chatData.error || "Could not create workspace chat.");
      setChatList((current) => current.some((item) => item.id === chatData.chat.id)
        ? current.map((item) => item.id === chatData.chat.id ? chatData.chat : item)
        : [chatData.chat, ...current]);
      window.dispatchEvent(new CustomEvent(CHAT_UPSERT_EVENT, { detail: chatData.chat }));
      setActiveChatId(chatData.chat.id);
      setProfileSetupOpen(false);
      window.sessionStorage.removeItem(WORKSPACE_RETURN_MODE_STORAGE_KEY);
      router.replace(`/dashboard/agent?chat=${encodeURIComponent(chatData.chat.id)}`);
      void fetch("/api/codex/tmux", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: chatData.chat.id, action: "start" })
      }).catch(() => undefined);
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3500);
      throw error;
    } finally {
      setLoading(false);
      setPendingStatus(null);
    }
  }

  async function cancelProfileSetup() {
    const returnMode = normalizeWorkspaceModeFromStorage() || alternateWorkspaceMode(workspaceMode);
    setProfileSetupOpen(false);
    if (profileNeedsSetup && returnMode !== workspaceMode) {
      setLoading(true);
      try {
        const response = await fetch("/api/workspace", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: returnMode })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not return to previous workspace.");
        window.sessionStorage.removeItem(WORKSPACE_RETURN_MODE_STORAGE_KEY);
        router.replace("/dashboard/agent");
        router.refresh();
      } catch (error) {
        flash(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
      return;
    }
    window.sessionStorage.removeItem(WORKSPACE_RETURN_MODE_STORAGE_KEY);
  }

  function handleMessageAction(action: MessageAction) {
    const actionRoot = action.rootPath ? roots.find((item) => item.path === action.rootPath) : selectedRoot;
    if (actionRoot) {
      setSelectedRootPath(actionRoot.path);
      if (actionRoot.planId) setSelectedPlanId(actionRoot.planId);
    }

    if (action.kind === "open_inputs") {
      const root = actionRoot || selectedRoot;
      if (root) {
        setVariableValues(Object.fromEntries(root.variables.map((variable) => [variable.name, variable.sensitive ? "" : variable.value || ""])));
      }
      setVariablesOpen(true);
      return;
    }
    if (action.kind === "open_runs") {
      setRunsOpen(true);
      return;
    }
    if (action.kind === "open_files") {
      void openFiles();
      return;
    }
    if (action.kind === "open_checks") {
      setChecksOpen(true);
      return;
    }
    if (action.kind === "open_plan") {
      setPlanModalOpen(true);
    }
  }

  function handleChatScroll() {
    shouldAutoScrollRef.current = isNearScrollBottom(scrollRef.current);
  }

  return (
    <>
      <section className="motion-enter relative flex h-full w-full overflow-hidden bg-white">
        {editorMode && !freshChatMode ? (
          <EditorFileRail
            files={editorFiles}
            git={git}
            loading={editorFilesLoading}
            onOpenFile={openFilePanel}
          />
        ) : null}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {immersiveMode ? null : (
            <div className="relative hidden h-[65px] items-center justify-between gap-4 border-b border-gray-100 px-5 sm:flex sm:px-6">
              <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
                {activeChatId !== "new" && selectedRoot ? (
                  <TerraformCurrentMeta root={selectedRoot} roots={roots} onSelectRoot={selectRoot} />
                ) : (
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">New chat</p>
                    <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">Message A2W-Code</h1>
                  </div>
                )}
              </div>
              {editorMode ? (
                <div className="absolute left-1/2 -translate-x-1/2">
                  <ChatDisplayModeToggle mode={displayMode} onChange={setDisplayMode} />
                </div>
              ) : null}
            </div>
          )}

          {editorMode && !freshChatMode ? (
            <MobileWorkspaceLauncher
              workspaceMode={workspaceMode}
              plan={selectedPlan}
              root={selectedRoot}
              loading={loading}
              applyDisabled={applyDisabled}
              applyRuntimeEnabled={applyRuntimeEnabled}
              open={mobileActionsOpen}
              displayMode={displayMode}
              missingVariables={missingRequiredVariables.length}
              canMergeBranch={git.initialized && !isDetachedGit(git) && Boolean(git.branch)}
              onOpenChange={setMobileActionsOpen}
              onFiles={() => setMobileFilesOpen(true)}
              onDisplayMode={() => setDisplayMode(displayMode === "focus" ? "transcript" : "focus")}
              onViewPlan={() => selectedPlan && setPlanModalOpen(true)}
              onRuns={() => setRunsOpen(true)}
              onVariables={openVariables}
              onDiff={openDiff}
              onGit={openGit}
              onCommitPush={openCommitPush}
              onMerge={openMerge}
              onApprove={() => selectedPlan && void approve(selectedPlan)}
              onTerraformSandbox={(nextMode) => selectedPlan && openSandbox(selectedPlan, nextMode)}
              onWorkspaceSandbox={runWorkspaceSandbox}
            />
          ) : null}

          {editorMode && !freshChatMode && !focusModeActive ? (
            <button
              type="button"
              onClick={() => setDisplayMode("focus")}
              className="absolute left-1/2 top-3 z-50 inline-flex h-10 -translate-x-1/2 items-center gap-2 rounded-2xl border border-gray-200 bg-white/90 px-3 text-xs font-semibold text-gray-700 shadow-xl shadow-black/10 backdrop-blur transition hover:border-gray-300 hover:bg-white hover:text-black lg:hidden"
              aria-label="Focus mode"
            >
              <Icon name="fa-circle-nodes" />
              <span>Focus mode</span>
            </button>
          ) : null}

          {minimalChatMode ? (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <CodexFocusSphere
                status="idle"
                statusLabel={profileNeedsSetup ? `"Set up your ${workspaceMode === "web" ? "web" : "infra"} repository"` : '"What do you want me to do?"'}
                detail={profileNeedsSetup ? "Connect or reuse a Git repository before starting chats in this workspace mode." : ""}
                rootName={workspaceMode === "web" ? "web workspace" : "infra workspace"}
                changedFiles={0}
                additions={0}
                deletions={0}
                actions={[]}
                sandboxActions={[]}
                presentation="new-chat"
              />
            </div>
          ) : focusModeActive ? (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <CodexFocusSphere
                status={visualFocusStatus}
                statusLabel={visualFocusLabel}
                detail={visualFocusDetail}
                rootName={focusState.rootName}
                changedFiles={focusState.changedFiles}
                additions={focusState.additions}
                deletions={focusState.deletions}
                actions={focusState.actions}
                sandboxActions={focusState.sandboxActions}
                responseSummary={focusState.responseSummary}
                onShowTranscript={() => setDisplayMode("transcript")}
              />
              <div className="absolute left-2 top-2 z-40 hidden lg:block">
                <WorkspaceActionBar
                  workspaceMode={workspaceMode}
                  plan={selectedPlan}
                  root={selectedRoot}
                  loading={loading}
                  applyDisabled={applyDisabled}
                  applyRuntimeEnabled={applyRuntimeEnabled}
                  onViewPlan={() => selectedPlan && setPlanModalOpen(true)}
                  onRuns={() => setRunsOpen(true)}
                  onVariables={openVariables}
                  onDiff={openDiff}
                  onGit={openGit}
                  onCommitPush={openCommitPush}
                  onMerge={openMerge}
                  onApprove={() => selectedPlan && void approve(selectedPlan)}
                  onTerraformSandbox={(nextMode) => selectedPlan && openSandbox(selectedPlan, nextMode)}
                  onWorkspaceSandbox={runWorkspaceSandbox}
                  missingVariables={missingRequiredVariables.length}
                  canMergeBranch={git.initialized && !isDetachedGit(git) && Boolean(git.branch)}
                  placement="focus"
                />
              </div>
            </div>
          ) : (
            <div ref={scrollRef} onScroll={handleChatScroll} className="thin-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-4 py-7 sm:px-8">
              <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-7">
                <CodexTmuxHistory pane={codexPane} fallbackMessages={visibleMessages} onMessageAction={handleMessageAction} />
                {activeApprovalStatusPlan ? <ApprovalStatusBubble plan={activeApprovalStatusPlan} /> : null}
                {pendingStatus ? <PendingBubble message={pendingStatus} /> : null}
                {loading && !pendingStatus ? <ThinkingBubble /> : null}
              </div>
            </div>
          )}

          <form
            onSubmit={submit}
            className={
              minimalChatMode
                ? "absolute inset-x-0 top-[calc(67%+2.25rem)] z-30 px-3 py-0 sm:px-5"
                : `shrink-0 px-3 pb-3 pt-1.5 sm:px-5 sm:py-2 ${immersiveMode ? "h-[132px] border-t-0 bg-[#fbfbf9] sm:h-[144px]" : "h-[124px] border-t border-gray-100 bg-white sm:h-[168px]"}`
            }
          >
            {!focusModeActive && editorMode && !freshChatMode ? (
              <div className="mx-auto hidden max-w-3xl lg:block">
                <WorkspaceActionBar
                  workspaceMode={workspaceMode}
                  plan={selectedPlan}
                  root={selectedRoot}
                  loading={loading}
                  applyDisabled={applyDisabled}
                  applyRuntimeEnabled={applyRuntimeEnabled}
                  onViewPlan={() => selectedPlan && setPlanModalOpen(true)}
                  onRuns={() => setRunsOpen(true)}
                  onVariables={openVariables}
                  onDiff={openDiff}
                  onGit={openGit}
                  onCommitPush={openCommitPush}
                  onMerge={openMerge}
                  onApprove={() => selectedPlan && void approve(selectedPlan)}
                  onTerraformSandbox={(nextMode) => selectedPlan && openSandbox(selectedPlan, nextMode)}
                  onWorkspaceSandbox={runWorkspaceSandbox}
                  missingVariables={missingRequiredVariables.length}
                  canMergeBranch={git.initialized && !isDetachedGit(git) && Boolean(git.branch)}
                />
              </div>
            ) : null}

            <div className={`relative mx-auto max-w-3xl rounded-[1.75rem] border border-gray-200 bg-[#fbfbf9] p-2.5 shadow-2xl shadow-black/5 ${immersiveMode ? "mt-0" : "mt-2"}`}>
              {codexPicker ? (
                <CodexChoicePicker picker={codexPicker} chatId={activeChatId} onPane={setCodexPane} onKey={(key) => sendCodexControlKey(key, { requirePicker: true })} />
              ) : slashPaletteOpen ? (
                <SlashCommandPalette
                  commands={slashMatches}
                  activeIndex={slashIndex}
                  onHover={setSlashIndex}
                  onPick={completeSlashCommand}
                />
              ) : null}
              <div className="flex items-end gap-3">
                <textarea
                  rows={1}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (handleCodexPickerKeyDown(event)) return;
                    if (slashPaletteOpen && event.key === "ArrowDown") {
                      event.preventDefault();
                      setSlashIndex((current) => (current + 1) % slashMatches.length);
                      return;
                    }
                    if (slashPaletteOpen && event.key === "ArrowUp") {
                      event.preventDefault();
                      setSlashIndex((current) => (current - 1 + slashMatches.length) % slashMatches.length);
                      return;
                    }
                    if (slashPaletteOpen && event.key === "Tab") {
                      event.preventDefault();
                      completeSlashCommand();
                      return;
                    }
                    if (slashMode && event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (exactSlashCommand) {
                        void executeSlashCommand(exactSlashCommand);
                        return;
                      }
                      if (slashPaletteOpen && slashQuery !== selectedSlashCommand?.command) {
                        completeSlashCommand();
                        return;
                      }
                      void executeSlashCommand(selectedSlashCommand);
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-6 text-black outline-none"
                  placeholder={profileNeedsSetup ? "Set up this workspace mode before chatting..." : codexStagedInput ? "Submitting queued Codex input..." : codexBusy ? "Codex is working..." : "Message A2W-Code..."}
                  disabled={loading || codexBusy || profileNeedsSetup}
                />
                <button
                  disabled={codexCancellable ? false : loading || codexBusy || slashMode || profileNeedsSetup || !value.trim()}
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition disabled:cursor-not-allowed disabled:bg-gray-300 ${
                    codexCancellable ? "bg-red-600 hover:bg-red-700" : "bg-black hover:bg-gray-800"
                  }`}
                  type={codexCancellable ? "button" : "submit"}
                  onClick={codexCancellable ? cancelActiveCodex : undefined}
                  aria-label={codexCancellable ? "Stop Codex" : slashMode ? "Slash commands run from keyboard" : "Send message"}
                >
                  <Icon name={codexCancellable ? "fa-xmark" : "fa-arrow-up"} />
                </button>
              </div>
              {minimalChatMode ? null : (
                <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1 pt-2">
                  <p className="text-xs text-gray-500">Chat is for prompts, replies, and sandbox output.</p>
                  {missingRequiredVariables.length ? (
                    <button type="button" onClick={openVariables} className="text-xs font-semibold text-amber-700 transition hover:text-amber-900">
                      {missingRequiredVariables.length} input{missingRequiredVariables.length === 1 ? "" : "s"} needed
                    </button>
                  ) : selectedPlan ? (
                    <button type="button" onClick={() => setPlanModalOpen(true)} className="text-xs font-medium text-gray-500 transition hover:text-black">
                      Current plan: {selectedPlan.title}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </form>
          {editorMode && !freshChatMode ? <ChatStatusBar provider={provider} providerConnection={activeProviderConnection} git={git} onCredentialsClick={() => setCredentialsOpen(true)} /> : null}
        </div>

        {mobileFilesOpen && editorMode && !freshChatMode ? (
          <div className="absolute inset-0 z-[60] lg:hidden">
            <button type="button" className="absolute inset-0 cursor-default bg-black/10 backdrop-blur-[1px]" aria-label="Close file browser" onClick={() => setMobileFilesOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[min(88vw,340px)]">
              <EditorFileRail
                files={editorFiles}
                git={git}
                loading={editorFilesLoading}
                onOpenFile={(path) => {
                  setMobileFilesOpen(false);
                  openFilePanel(path);
                }}
                mobile
                onClose={() => setMobileFilesOpen(false)}
              />
            </div>
          </div>
        ) : null}

        {filePanelOpen ? (
          <FileSidePanel
            files={editorFiles}
            path={filePanelPath}
            changedFiles={git.files}
            onClose={() => setFilePanelOpen(false)}
          />
        ) : null}

      </section>

      {planModalOpen ? (
        <PlanModal
          plans={plans}
          selectedPlan={selectedPlan}
          selectedRun={selectedRun}
          onClose={() => setPlanModalOpen(false)}
          onSelect={openPlan}
        />
      ) : null}

      {checksOpen ? (
        <ChecksModal root={selectedRoot} onClose={() => setChecksOpen(false)} />
      ) : null}

      {runsOpen ? (
        <RunsModal root={selectedRoot} runs={sandboxRuns} onClose={() => setRunsOpen(false)} />
      ) : null}

      {variablesOpen ? (
        <VariablesModal
          root={selectedRoot}
          values={variableValues}
          saving={savingVariables}
          onChange={(name, value) => setVariableValues((current) => ({ ...current, [name]: value }))}
          onClose={() => setVariablesOpen(false)}
          onSave={saveVariables}
        />
      ) : null}

      {profileSetupOpen ? (
        <WorkspaceProfileSetupModal
          workspaceMode={workspaceMode}
          provider={provider}
          providerConnection={activeProviderConnection}
          git={git}
          loading={loading}
          onClose={cancelProfileSetup}
          onComplete={completeProfileSetup}
        />
      ) : null}

      {diffOpen ? (
        <DiffModal git={git} loading={gitLoading} onClose={() => setDiffOpen(false)} onRefresh={openDiff} />
      ) : null}

      {commitPushOpen ? (
        <CommitPushModal
          git={git}
          loading={gitLoading}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onClose={() => setCommitPushOpen(false)}
          onInit={() => gitAction("init", {}, "Git initialized")}
          onCommit={(mode) => gitAction("commit", { message: commitMessage, mode }, "Workspace changes committed")}
          onSync={() => gitAction("sync", {}, "Repository synced")}
          onPush={() => gitAction("push", {}, "Branch pushed")}
          onCommitAndPush={commitAllAndPush}
          onCreateBranch={(branch) => gitAction("branch-current", { branch }, "Branch created from current HEAD")}
        />
      ) : null}

      {mergeOpen ? (
        <MergeBranchModal
          git={git}
          loading={gitLoading}
          onClose={() => setMergeOpen(false)}
          onMerge={async (targetBranch, push) => {
            if (await gitAction("merge-current", { targetBranch, push }, "Branch merged")) setMergeOpen(false);
          }}
        />
      ) : null}

      {gitOpen ? (
        <GitModal
          git={git}
          history={gitHistory}
          stashes={gitStashes}
          loading={gitLoading}
          commitMessage={commitMessage}
          stashMessage={stashMessage}
          onCommitMessageChange={setCommitMessage}
          onStashMessageChange={setStashMessage}
          onClose={() => setGitOpen(false)}
          onInit={() => gitAction("init", {}, "Git initialized")}
          onStage={(paths) => gitAction("stage", { paths }, paths.length ? "File staged" : "All changes staged")}
          onUnstage={(paths) => gitAction("unstage", { paths }, paths.length ? "File unstaged" : "All changes unstaged")}
          onCommit={(mode) => gitAction("commit", { message: commitMessage, mode }, "Workspace changes committed")}
          onSync={() => gitAction("sync", {}, "Repository synced")}
          onPush={() => gitAction("push", {}, "Branch pushed")}
          onCreateBranch={(branch) => gitAction("branch-current", { branch }, "Branch created from current HEAD")}
          onStash={(includeUntracked) => gitAction("stash", { message: stashMessage, includeUntracked }, "Changes stashed")}
          onStashApply={(index, mode) => gitAction(mode === "pop" ? "stash-pop" : "stash-apply", { index }, mode === "pop" ? "Stash popped" : "Stash applied")}
          onStashDrop={(index) => gitAction("stash-drop", { index, confirm: "DROP" }, "Stash dropped")}
          onCheckout={(ref, options) => gitAction("checkout", { ref, ...options }, options?.createBranch ? "Branch created" : "Checked out ref")}
          onRevert={(ref, options) => gitAction("revert", { ref, ...options }, "Commit reverted")}
          onReset={(ref, options) => gitAction("reset", { ref, ...options }, "Repository reset")}
          onResetAll={() => gitAction("reset-all", { confirm: "RESET" }, "All workspace changes reset")}
          onDiscardFile={(path) => gitAction("discard-file", { path, confirm: "DISCARD" }, "File discarded")}
          onRefresh={openGit}
        />
      ) : null}

      {credentialsOpen ? (
        <CredentialsModal
          provider={provider}
          connection={activeProviderConnection}
          onSaved={(connection) => {
            setActiveProviderConnection(connection);
            router.refresh();
          }}
          onClose={() => setCredentialsOpen(false)}
        />
      ) : null}

      {sandboxPlan ? (
        <SandboxModal
          plan={sandboxPlan}
          mode={mode}
          loading={loading}
          applyConfirm={applyConfirm}
          applyDisabled={applyDisabled}
          applyRuntimeEnabled={applyRuntimeEnabled}
          onApplyConfirmChange={setApplyConfirm}
          onClose={() => setSandboxPlan(null)}
          onRun={runSandbox}
        />
      ) : null}

      {filesOpen ? (
        <Modal title="Project files" description="Browse the generated repository without leaving chat." icon="fa-folder-tree" size="xl" onClose={() => setFilesOpen(false)}>
          <div className="mt-5">
            {filesLoading ? (
              <div className="rounded-[1.5rem] bg-gray-50 p-6 text-sm font-medium text-gray-600">
                <Icon name="fa-circle-notch fa-spin" /> Loading files...
              </div>
            ) : (
              <FilesBrowser initialFiles={modalFiles} embedded />
            )}
          </div>
        </Modal>
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function ChatDisplayModeToggle({ mode, onChange }: { mode: ChatDisplayMode; onChange: (mode: ChatDisplayMode) => void }) {
  const focus = mode === "focus";
  return (
    <button
      type="button"
      onClick={() => onChange(focus ? "transcript" : "focus")}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition ${
        focus
          ? "border-black bg-black text-white hover:bg-gray-800"
          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-black"
      }`}
      aria-label={focus ? "Inspect mode" : "Focus mode"}
      aria-pressed={focus}
      title={focus ? "Inspect mode" : "Focus mode"}
    >
      <Icon name={focus ? "fa-message" : "fa-circle-nodes"} />
      <span className="hidden sm:inline">{focus ? "Inspect mode" : "Focus mode"}</span>
    </button>
  );
}

function buildChatThreads(chats: Chat[], messages: Message[], plans: InfraPlan[]): ChatThread[] {
  return chats
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((chat) => {
      const relatedMessages = messages.filter((message) => message.chatId === chat.id);
      const relatedPlan = plans.filter((plan) => plan.chatId === chat.id).at(-1);
      return {
        id: chat.id,
        title: chat.title,
        subtitle: relatedMessages.at(-1)?.content.split("\n")[0] || "New conversation",
        meta: relatedPlan?.status.includes("approved") ? "ok" : chat.codexThreadId ? "codex" : "chat",
        icon: relatedPlan?.status.includes("approved") ? "fa-circle-check" : chat.codexThreadId ? "fa-wand-magic-sparkles" : "fa-message"
      };
    });
}

function sandboxRunBelongsToChat(run: SandboxRun, activeChatId: string, plans: InfraPlan[]) {
  if (run.chatId) return run.chatId === activeChatId;
  if (!run.planId) return false;
  return plans.some((plan) => plan.id === run.planId && plan.chatId === activeChatId);
}

function EditorFileRail({
  files,
  git,
  loading,
  onOpenFile,
  mobile = false,
  onClose
}: {
  files: FileEntry[];
  git: GitWorkspaceStatus;
  loading: boolean;
  onOpenFile: (path: string) => void;
  mobile?: boolean;
  onClose?: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialEditorExpanded(files));
  const [diffOnly, setDiffOnly] = useState(false);
  const changedFiles = useMemo(() => git.files.map((file) => file.path), [git.files]);
  const changedSet = useMemo(() => new Set(changedFiles), [changedFiles]);
  const diffFiles = useMemo(() => files.filter((file) => changedSet.has(file.path)), [changedSet, files]);
  const visibleFiles = diffOnly ? diffFiles : files;
  const tree = useMemo(() => buildEditorTree(visibleFiles), [visibleFiles]);
  const diffStats = useMemo(() => summarizeDiffStats(git.files), [git.files]);
  const repository = git.repositoryName || "repository";
  const branch = git.initialized ? isDetachedGit(git) ? "Detached HEAD" : git.branch || "unknown" : "not initialized";
  const repositoryBranch = `${repository}/${branch}`;
  const clean = git.initialized && git.clean;

  useEffect(() => {
    setExpanded((current) => mergeExpandedWithCurrentFiles(current, files));
  }, [files]);

  useEffect(() => {
    if (!diffOnly) return;
    setExpanded((current) => new Set([...current, ...defaultEditorExpanded(diffFiles)]));
  }, [diffFiles, diffOnly]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistEditorExpanded(next);
      return next;
    });
  }

  return (
    <aside className={`${mobile ? "flex h-full w-full shadow-2xl shadow-black/15" : "hidden h-full w-[286px] shrink-0 lg:flex"} flex-col border-r border-gray-200 bg-[#fbfbf9]`}>
      <div className="flex h-[65px] items-center justify-between gap-2 border-b border-gray-200 px-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon name="fa-brands fa-git-alt" className="shrink-0 text-[15px] text-[#F05032]" />
            <span className="truncate font-mono text-xs font-semibold text-gray-800" title={repositoryBranch}>{repositoryBranch}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
            <span>{git.files.length ? `${git.files.length} changed` : clean ? "clean" : "not checked"}</span>
            {git.files.length ? (
              <>
                <span className="text-emerald-600">+{diffStats.additions}</span>
                <span className="text-red-600">-{diffStats.deletions}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setDiffOnly((current) => !current)}
            disabled={!git.files.length}
            className={`grid h-8 w-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:text-gray-300 ${
              diffOnly ? "bg-gray-900 text-white" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            }`}
            aria-label={diffOnly ? "Show all files" : "Show changed files only"}
            title={diffOnly ? "Show all files" : "Show changed files only"}
            aria-pressed={diffOnly}
          >
            <Icon name="fa-code-compare" />
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close file browser"
              title="Close"
            >
              <Icon name="fa-xmark" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebar-scrollbar min-h-0 flex-1 overflow-auto px-2 py-3">
        {visibleFiles.length ? (
          <EditorTreeList nodes={[...tree.children.values()]} expanded={expanded} changedFiles={changedSet} onToggle={toggle} onOpenFile={onOpenFile} depth={0} />
        ) : (
          <div className="px-2 py-3 text-xs leading-6 text-gray-400">
            {loading ? "Loading workspace files..." : diffOnly ? "No changed files." : "No files yet. Ask Codex to create or edit Terraform."}
          </div>
        )}
      </div>
    </aside>
  );
}

type EditorTreeNode = {
  name: string;
  path: string;
  type: "directory" | "file";
  children: Map<string, EditorTreeNode>;
};

function EditorTreeList({
  nodes,
  expanded,
  changedFiles,
  onToggle,
  onOpenFile,
  depth
}: {
  nodes: EditorTreeNode[];
  expanded: Set<string>;
  changedFiles: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  depth: number;
}) {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="grid gap-0.5">
      {sorted.map((node) =>
        node.type === "directory" ? (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium transition hover:bg-gray-100 hover:text-gray-800 ${
                directoryHasChanges(node, changedFiles) ? "text-gray-800" : "text-gray-500"
              }`}
              style={{ paddingLeft: 8 + depth * 13 }}
            >
              <Icon name={expanded.has(node.path) ? "fa-chevron-down" : "fa-chevron-right"} className="w-2.5 text-[9px] text-gray-400" />
              <span className="truncate">{node.name}</span>
              {directoryHasChanges(node, changedFiles) ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gray-400 shadow-[0_0_10px_rgba(156,163,175,0.55)]" /> : null}
            </button>
            {expanded.has(node.path) ? (
              <EditorTreeList nodes={[...node.children.values()]} expanded={expanded} changedFiles={changedFiles} onToggle={onToggle} onOpenFile={onOpenFile} depth={depth + 1} />
            ) : null}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            onClick={() => onOpenFile(node.path)}
            className={`flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs transition hover:bg-gray-100 hover:text-gray-700 ${
              changedFiles.has(node.path)
                ? "bg-gray-100 text-gray-800"
                : "text-gray-400"
            }`}
            style={{ paddingLeft: 24 + depth * 13 }}
            title={node.path}
          >
            <span className="truncate">{node.name}</span>
            {changedFiles.has(node.path) ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-gray-400 shadow-[0_0_10px_rgba(156,163,175,0.55)]" /> : null}
          </button>
        )
      )}
    </div>
  );
}

function directoryHasChanges(node: EditorTreeNode, changedFiles: Set<string>): boolean {
  for (const file of changedFiles) {
    if (file.startsWith(`${node.path}/`)) return true;
  }
  return false;
}

function summarizeDiffStats(files: GitWorkspaceStatus["files"]) {
  return files.reduce(
    (stats, file) => {
      const lines = file.diff.split("\n");
      for (const line of lines) {
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) stats.additions += 1;
        if (line.startsWith("-")) stats.deletions += 1;
      }
      return stats;
    },
    { additions: 0, deletions: 0 }
  );
}

function ChatStatusBar({
  provider,
  providerConnection,
  git,
  onCredentialsClick
}: {
  provider: CloudProvider;
  providerConnection?: Omit<ProviderConnection, "secrets">;
  git: GitWorkspaceStatus;
  onCredentialsClick: () => void;
}) {
  const repository = git.repositoryName || "repository";
  const branch = git.initialized ? isDetachedGit(git) ? "Detached HEAD" : git.branch || "unknown" : "not initialized";
  const credentialsConfigured = Boolean(providerConnection);

  return (
    <footer className="hidden h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-gray-100 bg-[#fbfbf9] px-4 text-[11px] text-gray-500 sm:flex sm:px-6" aria-label="Workspace status">
      <StatusItem label="Git" value={`${repository} / ${branch}`} monospace />
      <span className="flex shrink-0 items-center gap-3">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="text-gray-400">Cloud Provider set:</span>
          <CloudProviderLogo provider={provider} />
        </span>
        <StatusSeparator />
        <button
          type="button"
          onClick={onCredentialsClick}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-gray-100 hover:text-black"
        >
          <span className="text-gray-400">Credentials configured:</span>
          <span className={credentialsConfigured ? "font-medium text-emerald-600" : "font-medium text-gray-500"}>
            {credentialsConfigured ? "Yes" : "No"}
          </span>
        </button>
      </span>
    </footer>
  );
}

function CloudProviderLogo({ provider }: { provider: CloudProvider }) {
  return (
    <span className="grid h-4 w-5 place-items-center" title={cloudProviderLabel(provider)} aria-label={cloudProviderLabel(provider)}>
      {provider === "aws" ? <AwsLogo /> : provider === "azure" ? <AzureLogo /> : <GcpLogo />}
    </span>
  );
}

function StatusItem({
  label,
  value,
  tone,
  monospace
}: {
  label: string;
  value: string;
  tone?: "ok" | "muted";
  monospace?: boolean;
}) {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5">
      <span className="text-gray-400">{label}:</span>
      <span className={`${tone === "ok" ? "text-emerald-600" : tone === "muted" ? "text-gray-500" : "text-gray-700"} ${monospace ? "font-mono" : "font-medium"}`}>
        {value}
      </span>
    </span>
  );
}

function StatusSeparator() {
  return <span className="h-3 w-px shrink-0 bg-gray-200" />;
}

function cloudProviderLabel(provider: CloudProvider) {
  if (provider === "aws") return "AWS";
  if (provider === "azure") return "Azure";
  return "GCP";
}

function AwsLogo() {
  return <Icon name="fa-brands fa-aws" className="text-[15px] text-[#232F3E]" />;
}

function AzureLogo() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-[18px]" viewBox="0 0 48 42" fill="none">
      <path d="M17.6 0h13.7L17.1 42H3.4L17.6 0Z" fill="#0078D4" />
      <path d="M33.1 0 48 42H34.6l-2.8-8.1H15.9L33.1 0Z" fill="#50A8F2" />
      <path d="M18.2 25.4h14.2l-7.3 6.1-11.9 10.4 5-16.5Z" fill="#005BA1" />
    </svg>
  );
}

function GcpLogo() {
  return <Icon name="fa-brands fa-google" className="text-[14px] text-[#4285F4]" />;
}

function FileSidePanel({
  files,
  path,
  changedFiles,
  onClose
}: {
  files: FileEntry[];
  path: string | null;
  changedFiles: GitWorkspaceStatus["files"];
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const changedSet = useMemo(() => new Set(changedFiles.map((file) => file.path)), [changedFiles]);
  const selectedFile = files.find((file) => file.path === path);
  const selectedDiff = changedFiles.find((file) => file.path === path)?.diff || "";

  useEffect(() => {
    if (!path) {
      setContent("");
      return;
    }
    setLoading(true);
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then((response) => response.json())
      .then((data) => setContent(data.content || ""))
      .finally(() => setLoading(false));
  }, [path]);

  return (
    <div className="absolute inset-y-0 left-0 right-0 z-40 lg:left-[286px]">
      <button type="button" className="absolute inset-0 cursor-default bg-white/10 backdrop-blur-[1px]" aria-label="Close file preview" onClick={onClose} />
      <aside className="absolute left-0 top-0 flex h-full w-[min(92vw,1120px)] min-w-0 max-w-[calc(100%-18px)] overflow-hidden border-r border-gray-200 bg-white shadow-2xl shadow-black/12 sm:min-w-[640px] lg:w-[min(72%,1120px)] lg:max-w-[calc(100%-32px)]">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[65px] shrink-0 items-center justify-between gap-4 border-b border-gray-200 px-5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{selectedDiff ? "Inline diff" : changedSet.has(path || "") ? "Changed file" : "File preview"}</p>
              <h2 className="truncate font-mono text-xs font-medium text-gray-700" title={path || ""}>{path || "No file selected"}</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {selectedFile ? (
                <span className="rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
                  {formatBytes(selectedFile.size)}
                </span>
              ) : null}
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" aria-label="Close file preview">
                <Icon name="fa-xmark" />
              </button>
            </div>
          </header>

          <div className="thin-scrollbar min-h-0 flex-1 overflow-auto bg-[#111]">
            {loading ? (
              <div className="p-5 text-sm text-gray-300">Loading...</div>
            ) : selectedDiff ? (
              <InlineDiffCodeView content={content} diff={selectedDiff} />
            ) : content ? (
              <CodeView content={content} />
            ) : (
              <div className="p-5 text-sm text-gray-300">Select a file.</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function CodeView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="grid grid-cols-[auto_1fr] font-mono text-sm leading-6">
      {lines.map((line, index) => (
        <div key={`${index}-${line}`} className="contents">
          <span className="select-none border-r border-white/10 px-4 text-right text-gray-500">{index + 1}</span>
          <pre className="overflow-x-auto px-4 text-gray-100">{line || " "}</pre>
        </div>
      ))}
    </div>
  );
}

function InlineDiffCodeView({ content, diff }: { content: string; diff: string }) {
  const rows = inlineDiffRows(content, diff);
  return (
    <div className="font-mono text-sm leading-6">
      {rows.map((row, index) => {
        return (
          <div
            key={`${index}-${row.line}`}
            className={`grid grid-cols-[auto_auto_1fr] ${
              row.tone === "add"
                ? "bg-emerald-500/10 text-emerald-100"
                : row.tone === "remove"
                  ? "bg-red-500/10 text-red-100"
                  : "text-gray-100"
            }`}
          >
            <span className="select-none border-r border-white/10 px-4 text-right text-gray-500">{row.number || " "}</span>
            <span className={`select-none px-3 ${
              row.tone === "add" ? "text-emerald-300" : row.tone === "remove" ? "text-red-300" : "text-gray-500"
            }`}>
              {row.tone === "add" ? "+" : row.tone === "remove" ? "-" : " "}
            </span>
            <pre className="overflow-x-auto pr-4">{row.line || " "}</pre>
          </div>
        );
      })}
    </div>
  );
}

type InlineDiffRow = {
  number: number | null;
  line: string;
  tone: "context" | "add" | "remove";
};

function inlineDiffRows(content: string, diff: string): InlineDiffRow[] {
  const contentLines = content.split("\n");
  const diffLines = diff.split("\n");
  const rows: InlineDiffRow[] = [];
  let contentCursor = 1;
  let index = 0;

  while (index < diffLines.length) {
    const header = diffLines[index].match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!header) {
      index += 1;
      continue;
    }

    const newStart = Number(header[1]);
    while (contentCursor < newStart && contentCursor <= contentLines.length) {
      rows.push({ number: contentCursor, line: contentLines[contentCursor - 1], tone: "context" });
      contentCursor += 1;
    }

    index += 1;
    while (index < diffLines.length && !diffLines[index].startsWith("@@ ")) {
      const line = diffLines[index];
      if (line.startsWith("\\ No newline")) {
        index += 1;
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        rows.push({ number: contentCursor, line: line.slice(1), tone: "add" });
        contentCursor += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        rows.push({ number: null, line: line.slice(1), tone: "remove" });
      } else if (line.startsWith(" ")) {
        rows.push({ number: contentCursor, line: line.slice(1), tone: "context" });
        contentCursor += 1;
      }
      index += 1;
    }
  }

  while (contentCursor <= contentLines.length) {
    rows.push({ number: contentCursor, line: contentLines[contentCursor - 1], tone: "context" });
    contentCursor += 1;
  }

  return rows.length ? rows : contentLines.map((line, lineIndex) => ({ number: lineIndex + 1, line, tone: "context" }));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function buildEditorTree(files: FileEntry[]) {
  const root: EditorTreeNode = { name: "root", path: "", type: "directory", children: new Map() };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const isFile = index === parts.length - 1;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path,
          type: isFile ? "file" : "directory",
          children: new Map()
        });
      }
      const node = current.children.get(part)!;
      if (isFile) node.type = "file";
      current = node;
    });
  }

  return root;
}

function defaultEditorExpanded(files: FileEntry[]) {
  const next = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      next.add(parts.slice(0, index).join("/"));
    }
  }
  return next;
}

function initialEditorExpanded(files: FileEntry[]) {
  const saved = readEditorExpanded();
  return saved || defaultEditorExpanded(files);
}

function mergeExpandedWithCurrentFiles(current: Set<string>, files: FileEntry[]) {
  const valid = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      valid.add(parts.slice(0, index).join("/"));
    }
  }

  if (!valid.size) return current;
  const next = new Set([...current].filter((path) => valid.has(path)));
  for (const path of readEditorExpanded() || []) {
    if (valid.has(path)) next.add(path);
  }
  return next.size ? next : defaultEditorExpanded(files);
}

function readEditorExpanded() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(EDITOR_TREE_EXPANDED_STORAGE_KEY);
    if (!raw) return null;
    const paths = JSON.parse(raw);
    if (!Array.isArray(paths)) return null;
    return new Set(paths.filter((path): path is string => typeof path === "string"));
  } catch {
    return null;
  }
}

function persistEditorExpanded(paths: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EDITOR_TREE_EXPANDED_STORAGE_KEY, JSON.stringify([...paths].sort()));
  } catch {
    // Ignore localStorage failures; the file tree should still work normally.
  }
}

function MobileWorkspaceLauncher({
  workspaceMode,
  plan,
  root,
  loading,
  applyDisabled,
  applyRuntimeEnabled,
  open,
  displayMode,
  missingVariables,
  canMergeBranch,
  onOpenChange,
  onFiles,
  onDisplayMode,
  onViewPlan,
  onRuns,
  onVariables,
  onDiff,
  onGit,
  onCommitPush,
  onMerge,
  onApprove,
  onTerraformSandbox,
  onWorkspaceSandbox
}: {
  workspaceMode: WorkspaceMode;
  plan: InfraPlan | null;
  root: TerraformRoot | null;
  loading: boolean;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
  open: boolean;
  displayMode: ChatDisplayMode;
  missingVariables: number;
  canMergeBranch: boolean;
  onOpenChange: (open: boolean) => void;
  onFiles: () => void;
  onDisplayMode: () => void;
  onViewPlan: () => void;
  onRuns: () => void;
  onVariables: () => void;
  onDiff: () => void;
  onGit: () => void;
  onCommitPush: () => void;
  onMerge: () => void;
  onApprove: () => void;
  onTerraformSandbox: (mode: SandboxMode) => void;
  onWorkspaceSandbox: (mode: SandboxMode, allowNetwork?: boolean) => void;
}) {
  const approved = Boolean(plan?.status.includes("approved"));
  const canMutate = approved && !applyDisabled && applyRuntimeEnabled;
  const terraformDisabled = loading || !plan;
  const npmDisabled = loading;

  function run(action: () => void) {
    onOpenChange(false);
    action();
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-50 flex justify-end lg:hidden">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`pointer-events-auto grid h-10 w-10 place-items-center rounded-2xl border shadow-xl shadow-black/10 backdrop-blur transition ${
          open ? "border-black bg-black text-white" : "border-gray-200 bg-white/90 text-gray-800"
        }`}
        aria-label={open ? "Close workspace actions" : "Open workspace actions"}
        aria-expanded={open}
      >
        <Icon name={open ? "fa-xmark" : "fa-sliders"} />
      </button>

      {open ? (
        <div className="pointer-events-auto sidebar-scrollbar absolute right-0 top-12 max-h-[calc(100vh-7rem)] w-full max-w-[22rem] overflow-auto rounded-[1.5rem] border border-gray-200 bg-white/95 p-2 shadow-2xl shadow-black/15 backdrop-blur">
          <div className="grid gap-1">
            <ActionMenuButton icon="fa-folder-tree" label="Files" disabled={loading} onClick={() => run(onFiles)} />
            <ActionMenuButton icon={displayMode === "focus" ? "fa-message" : "fa-circle-nodes"} label={displayMode === "focus" ? "Inspect mode" : "Focus mode"} disabled={loading} onClick={() => run(onDisplayMode)} />
          </div>

          <MenuDivider label={workspaceMode === "web" ? "NPM" : "Terraform"} />
          {workspaceMode === "web" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-download" label="NPM install" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-install", true))} />
              <ActionMenuButton icon="fa-shield-halved" label="NPM audit" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-audit", true))} />
              <ActionMenuButton icon="fa-list-check" label="NPM lint" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-lint"))} />
              <ActionMenuButton icon="fa-vial" label="NPM test" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-test"))} />
              <ActionMenuButton icon="fa-box" label="NPM build" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-build"))} />
            </div>
          ) : (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-code-branch" label="View plan" disabled={terraformDisabled} onClick={() => run(onViewPlan)} />
              <ActionMenuButton icon="fa-clock-rotate-left" label="Run history" disabled={loading || !root} onClick={() => run(onRuns)} />
              <ActionMenuButton icon="fa-keyboard" label={missingVariables ? `Inputs (${missingVariables})` : "Inputs"} disabled={loading || !root} onClick={() => run(onVariables)} />
              <ActionMenuButton icon="fa-code" label="Terraform fmt" disabled={terraformDisabled} onClick={() => run(() => onTerraformSandbox("terraform-fmt"))} />
              <ActionMenuButton icon="fa-terminal" label="Terraform plan" disabled={terraformDisabled} onClick={() => run(() => onTerraformSandbox("terraform-plan"))} />
              {approved ? (
                <>
                  <ActionMenuButton icon="fa-rocket" label="Apply" danger disabled={loading || !canMutate} onClick={() => run(() => onTerraformSandbox("terraform-apply"))} />
                  <ActionMenuButton icon="fa-trash" label="Destroy" subtleDanger disabled={loading || !canMutate} onClick={() => run(() => onTerraformSandbox("terraform-destroy"))} />
                </>
              ) : (
                <ActionMenuButton icon="fa-check" label="Approve" primary disabled={terraformDisabled || Boolean(plan?.blocked)} onClick={() => run(onApprove)} />
              )}
            </div>
          )}

          <MenuDivider label="Git" />
          <div className="grid gap-1">
            <ActionMenuButton icon="fa-code-branch" label="View diff" disabled={loading} onClick={() => run(onDiff)} />
            <ActionMenuButton icon="fa-cloud-arrow-up" label="Commit & push" disabled={loading} onClick={() => run(onCommitPush)} />
            <ActionMenuButton icon="fa-code-merge" label="Merge" disabled={loading || !canMergeBranch} onClick={() => run(onMerge)} />
            <ActionMenuButton icon="fa-code-commit" label="Git workspace" disabled={loading} onClick={() => run(onGit)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-2 px-2">
      <span className="h-px flex-1 bg-gray-100" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      <span className="h-px flex-1 bg-gray-100" />
    </div>
  );
}

function WorkspaceActionBar({
  workspaceMode,
  plan,
  root,
  loading,
  applyDisabled,
  applyRuntimeEnabled,
  onViewPlan,
  onRuns,
  onVariables,
  onDiff,
  onGit,
  onCommitPush,
  onMerge,
  onApprove,
  onTerraformSandbox,
  onWorkspaceSandbox,
  missingVariables,
  canMergeBranch,
  placement = "input"
}: {
  workspaceMode: WorkspaceMode;
  plan: InfraPlan | null;
  root: TerraformRoot | null;
  loading: boolean;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
  onViewPlan: () => void;
  onRuns: () => void;
  onVariables: () => void;
  onDiff: () => void;
  onGit: () => void;
  onCommitPush: () => void;
  onMerge: () => void;
  onApprove: () => void;
  onTerraformSandbox: (mode: SandboxMode) => void;
  onWorkspaceSandbox: (mode: SandboxMode, allowNetwork?: boolean) => void;
  missingVariables: number;
  canMergeBranch: boolean;
  placement?: "input" | "focus";
}) {
  const actionGroup = workspaceMode === "web" ? "npm" : "terraform";
  const [openGroup, setOpenGroup] = useState<"terraform" | "npm" | "git" | null>(null);
  const approved = Boolean(plan?.status.includes("approved"));
  const canMutate = approved && !applyDisabled && applyRuntimeEnabled;
  const disabled = loading || !plan;
  const npmDisabled = loading;
  const focusPlacement = placement === "focus";

  function run(action: () => void) {
    setOpenGroup(null);
    action();
  }

  return (
    <div className={`relative flex min-h-10 items-start ${focusPlacement ? "flex-col gap-2" : "justify-between gap-4"}`}>
      {openGroup ? (
        <div
          className={`absolute z-20 w-64 rounded-[1.25rem] border border-gray-200 bg-white p-2 shadow-2xl shadow-black/10 ${
            focusPlacement
              ? "left-full top-0 ml-2"
              : `bottom-full mb-2 ${openGroup === actionGroup ? "left-0" : "right-0"}`
          }`}
        >
          {openGroup === "terraform" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-code-branch" label="View plan" disabled={disabled} onClick={() => run(onViewPlan)} />
              <ActionMenuButton icon="fa-clock-rotate-left" label="Run history" disabled={loading || !root} onClick={() => run(onRuns)} />
              <ActionMenuButton icon="fa-keyboard" label={missingVariables ? `Inputs (${missingVariables})` : "Inputs"} disabled={loading || !root} onClick={() => run(onVariables)} />
              <ActionMenuButton icon="fa-code" label="Terraform fmt" disabled={disabled} onClick={() => run(() => onTerraformSandbox("terraform-fmt"))} />
              <ActionMenuButton icon="fa-terminal" label="Terraform plan" disabled={disabled} onClick={() => run(() => onTerraformSandbox("terraform-plan"))} />
              {approved ? (
                <>
                  <ActionMenuButton icon="fa-rocket" label="Apply" danger disabled={loading || !canMutate} onClick={() => run(() => onTerraformSandbox("terraform-apply"))} />
                  <ActionMenuButton icon="fa-trash" label="Destroy" subtleDanger disabled={loading || !canMutate} onClick={() => run(() => onTerraformSandbox("terraform-destroy"))} />
                </>
              ) : (
                <ActionMenuButton icon="fa-check" label="Approve" primary disabled={disabled || Boolean(plan?.blocked)} onClick={() => run(onApprove)} />
              )}
            </div>
          ) : null}

          {openGroup === "npm" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-download" label="NPM install" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-install", true))} />
              <ActionMenuButton icon="fa-shield-halved" label="NPM audit" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-audit", true))} />
              <ActionMenuButton icon="fa-list-check" label="NPM lint" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-lint"))} />
              <ActionMenuButton icon="fa-vial" label="NPM test" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-test"))} />
              <ActionMenuButton icon="fa-box" label="NPM build" disabled={npmDisabled} onClick={() => run(() => onWorkspaceSandbox("npm-build"))} />
            </div>
          ) : null}

          {openGroup === "git" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-code-branch" label="View diff" disabled={loading} onClick={() => run(onDiff)} />
              <ActionMenuButton icon="fa-cloud-arrow-up" label="Commit & push" disabled={loading} onClick={() => run(onCommitPush)} />
              <ActionMenuButton icon="fa-code-merge" label="Merge" disabled={loading || !canMergeBranch} onClick={() => run(onMerge)} />
              <ActionMenuButton icon="fa-code-commit" label="Git workspace" disabled={loading} onClick={() => run(onGit)} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`flex items-center gap-1.5 rounded-full border p-1 ${focusPlacement ? "border-gray-200 bg-white/80 shadow-sm shadow-black/[0.03] backdrop-blur" : "border-gray-200 bg-[#fbfbf9]"}`}>
        {workspaceMode === "web" ? (
          <GroupTrigger icon={<Icon name="fa-brands fa-npm" className="text-[15px] text-[#cb3837]" />} label="NPM" active={openGroup === "npm"} onClick={() => setOpenGroup(openGroup === "npm" ? null : "npm")} />
        ) : (
          <GroupTrigger icon={<TerraformMark />} label="Terraform" active={openGroup === "terraform"} onClick={() => setOpenGroup(openGroup === "terraform" ? null : "terraform")} />
        )}
      </div>
      <div className={`flex items-center justify-end gap-1.5 rounded-full border p-1 ${focusPlacement ? "border-gray-200 bg-white/80 shadow-sm shadow-black/[0.03] backdrop-blur" : "border-gray-200 bg-[#fbfbf9]"}`}>
        <GroupTrigger icon={<Icon name="fa-brands fa-git-alt" className="text-[13px] text-[#F05032]" />} label="Git" active={openGroup === "git"} onClick={() => setOpenGroup(openGroup === "git" ? null : "git")} />
      </div>
    </div>
  );
}

function GroupTrigger({
  icon,
  label,
  active,
  onClick
}: {
  icon?: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition ${
        active ? "bg-black text-white" : "text-gray-600 hover:bg-white hover:text-black"
      }`}
    >
      {icon ? <span className="grid h-4 w-4 place-items-center">{icon}</span> : null}
      {label}
    </button>
  );
}

function TerraformMark() {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="h-4 w-4"
      src="https://cdn.simpleicons.org/terraform/5C4EE5"
    />
  );
}

function ActionMenuButton({
  icon,
  label,
  primary,
  danger,
  subtleDanger,
  disabled,
  onClick
}: {
  icon: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
  subtleDanger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tone = primary
    ? "border-black bg-black text-white hover:bg-gray-800"
    : danger
      ? "border-red-700 bg-red-700 text-white hover:bg-red-800"
      : subtleDanger
        ? "border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
        : "border-transparent bg-white text-gray-700 hover:bg-gray-50 hover:text-black";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-3 rounded-[0.9rem] border px-3 text-left text-xs font-semibold transition disabled:cursor-not-allowed disabled:border-transparent disabled:bg-gray-50 disabled:text-gray-400 ${tone}`}
    >
      <span className="grid w-4 place-items-center">
        <Icon name={icon} />
      </span>
      {label}
    </button>
  );
}

function TerraformCurrentMeta({
  root,
  roots,
  onSelectRoot
}: {
  root: TerraformRoot;
  roots: TerraformRoot[];
  onSelectRoot: (path: string) => void;
}) {
  return (
    <>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Active directory</p>
        {roots.length > 1 ? (
          <select
            value={root.path}
            onChange={(event) => onSelectRoot(event.target.value)}
            className="max-w-[52vw] truncate bg-transparent font-mono text-xs font-medium text-gray-700 outline-none"
            title={root.path}
          >
            {roots.map((item) => (
              <option key={item.path} value={item.path}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="truncate font-mono text-xs font-medium text-gray-700" title={root.path}>{root.name}</h1>
        )}
      </div>
      <div className="shrink-0 text-right text-xs leading-5">
        <p className="font-semibold uppercase tracking-[0.18em] text-gray-500">{root.lock ? "Running" : "Applied"}</p>
        <p className={root.lock ? "font-medium text-amber-600" : root.applied ? "font-medium text-emerald-600" : "text-gray-500"}>
          {root.lock ? root.lock.mode.replace("terraform-", "") : root.applied ? "yes" : "no"}
        </p>
      </div>
    </>
  );
}

function terraformCallDirs(plan: InfraPlan) {
  const files = plan.materializedFiles?.length ? plan.materializedFiles : plan.plannedFiles;
  const prefix = "infrastructure/terraform/providers/";
  const dirs = new Set<string>();

  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const parts = file.split("/");
    if (parts.length > 1) dirs.add(parts.slice(0, -1).join("/"));
  }

  return [...dirs].sort();
}

function SlashCommandPalette({
  commands,
  activeIndex,
  onHover,
  onPick
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onPick: (command: SlashCommand) => void;
}) {
  const groups = commands.reduce<Record<string, SlashCommand[]>>((current, command) => {
    current[command.group] ||= [];
    current[command.group].push(command);
    return current;
  }, {});
  let index = -1;

  return (
    <div className="sidebar-scrollbar absolute bottom-[calc(100%+10px)] left-0 z-30 max-h-[420px] w-full overflow-auto rounded-[1.25rem] border border-gray-200 bg-white p-2 shadow-2xl shadow-black/10">
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="grid gap-1">
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">{group}</p>
          {items.map((command) => {
            index += 1;
            const commandIndex = index;
            const active = commandIndex === activeIndex;
            return (
              <button
                key={command.command}
                type="button"
                onMouseEnter={() => onHover(commandIndex)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(command)}
                className={`grid w-full grid-cols-[minmax(130px,auto)_1fr] gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  active ? "bg-gray-100 text-black" : "text-gray-600 hover:bg-gray-50 hover:text-black"
                }`}
              >
                <span className="font-mono text-xs font-semibold">{command.command}</span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs">{command.description}</span>
                  {command.group === "Terraform" ? (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gray-100" title="Terraform">
                      <TerraformMark />
                    </span>
                  ) : command.group === "NPM" ? (
                    <Icon name="fa-brands fa-npm" className="text-[#cb3837]" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t border-gray-100 px-2 pt-2 text-[11px] text-gray-400">
        <span>Arrow keys to move</span>
        <span>Tab to complete</span>
      </div>
    </div>
  );
}

function slashCommandQuery(input: string) {
  const value = input.trimStart();
  if (!value.startsWith("/") || value.includes("\n")) return null;
  if (/\s$/.test(value)) return null;
  return value;
}

function slashCommandAllowedForMode(command: SlashCommand, mode: WorkspaceMode) {
  if (command.kind === "terraform") return mode === "infra";
  if (command.kind === "npm") return mode === "web";
  return true;
}

function CodexTmuxHistory({
  pane,
  fallbackMessages,
  onMessageAction
}: {
  pane: CodexTmuxPane | null;
  fallbackMessages: Message[];
  onMessageAction: (action: MessageAction) => void;
}) {
  const parsedTurns = parseCodexPaneTurns(pane?.output || "");
  const turns = pane?.ready && parsedTurns.at(-1) && !parsedTurns.at(-1)?.response
    ? parsedTurns.slice(0, -1)
    : parsedTurns;

  if (!turns.length) {
    if (fallbackMessages.length) {
      return (
        <>
          {fallbackMessages.map((message) => (
            <MessageBubble key={message.id} message={message} onAction={onMessageAction} />
          ))}
          <CodexStatusLine pane={pane} />
        </>
      );
    }
    if (pane?.running && !pane.ready) {
      return (
        <>
          <article className="flex gap-4">
            <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">C</span>
            <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              {pane.viewingTranscript ? "Codex transcript is open." : pane.stagedInput ? "Submitting to Codex..." : "Codex is working..."}
            </div>
          </article>
          <CodexStatusLine pane={pane} />
        </>
      );
    }
    return (
      <div className="mx-auto flex min-h-[46vh] max-w-xl flex-col items-center justify-center text-center">
        <span className="grid h-12 w-12 place-items-center rounded-[1rem] bg-black text-sm font-semibold text-white">C</span>
        <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">Codex is ready.</h2>
        <p className="mt-3 text-sm leading-7 text-gray-500">Send a message to start the tmux-backed Codex session.</p>
      </div>
    );
  }

  const usedTurnIndexes = new Set<number>();
  const rendered: ReactNode[] = [];
  fallbackMessages.forEach((message) => {
    if (message.role === "user") {
      const turnIndex = findUnusedCodexTurn(turns, usedTurnIndexes, message.content);
      if (turnIndex >= 0) {
        usedTurnIndexes.add(turnIndex);
        rendered.push(
          <CodexTurnBlock
            key={`turn-${message.id}-${turnIndex}`}
            turn={turns[turnIndex]}
            pane={pane}
          />
        );
      } else {
        rendered.push(<MessageBubble key={message.id} message={message} onAction={onMessageAction} />);
      }
      return;
    }
    rendered.push(<MessageBubble key={message.id} message={message} onAction={onMessageAction} />);
  });

  turns.forEach((turn, index) => {
    if (usedTurnIndexes.has(index)) return;
    rendered.push(<CodexTurnBlock key={`unmatched-turn-${index}-${turn.prompt}`} turn={turn} pane={pane} />);
  });

  return (
    <>
      {rendered}
      <CodexStatusLine pane={pane} />
    </>
  );
}

function findUnusedCodexTurn(turns: CodexPaneTurn[], used: Set<number>, prompt: string) {
  const normalizedPrompt = normalizeCodexPrompt(prompt);
  return turns.findIndex((turn, index) => !used.has(index) && normalizeCodexPrompt(turn.prompt) === normalizedPrompt);
}

function normalizeCodexPrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim();
}

function CodexTurnBlock({ turn, pane }: { turn: CodexPaneTurn; pane: CodexTmuxPane | null }) {
  return (
    <div className="grid min-w-0 gap-5">
      <article className="flex min-w-0 justify-end">
        <div className="min-w-0 max-w-[86%] rounded-[1.5rem] bg-gray-100 px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-7 text-gray-900 [overflow-wrap:anywhere]">{turn.prompt}</p>
        </div>
      </article>
      {turn.response ? (
        <article className="flex min-w-0 gap-4">
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">C</span>
          <div className="grid min-w-0 max-w-full flex-1 gap-3 overflow-hidden py-1">
            {turn.actions.length ? <CodexActionTimeline actions={turn.actions} /> : null}
            {turn.response ? <MarkdownMessage content={turn.response} /> : null}
          </div>
        </article>
      ) : (
        <article className="flex min-w-0 gap-4">
          <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">C</span>
          <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            {pane?.viewingTranscript ? "Codex transcript is open." : pane?.stagedInput ? "Submitting to Codex..." : "Codex is working..."}
          </div>
        </article>
      )}
    </div>
  );
}

function CodexChoicePicker({
  picker,
  chatId,
  onPane,
  onKey
}: {
  picker: CodexPaneChoicePicker;
  chatId: string;
  onPane: (pane: CodexTmuxPane) => void;
  onKey: (key: CodexControlKey) => void;
}) {
  const [choosing, setChoosing] = useState<number | null>(null);

  async function choose(index: number) {
    setChoosing(index);
    try {
      const response = await fetch("/api/codex/tmux", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, action: "choose", index, activeIndex: picker.activeIndex })
      });
      const data = await response.json();
      if (data.pane) onPane(data.pane);
    } finally {
      setChoosing(null);
    }
  }

  return (
    <div
      className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-full overflow-hidden rounded-[1.25rem] border border-gray-200 bg-white p-2 shadow-2xl shadow-black/10"
      onKeyDown={(event) => {
        const key = codexPickerControlKey(event.key);
        if (!key || event.shiftKey) return;
        event.preventDefault();
        onKey(key);
      }}
    >
      <div className="px-3 py-2">
        <p className="text-sm font-semibold text-gray-900">{picker.title}</p>
        {picker.description ? <p className="mt-1 text-xs text-gray-500">{picker.description}</p> : null}
      </div>
      <div className="thin-scrollbar grid max-h-[360px] gap-1 overflow-auto">
        {picker.choices.map((choice, index) => {
          const active = index === picker.activeIndex;
          return (
            <button
              key={`${choice.number}-${choice.label}`}
              type="button"
              disabled={choosing !== null}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={`grid grid-cols-[auto_1fr] gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${
                active ? "border-black bg-gray-100 text-black" : "border-transparent text-gray-600 hover:border-gray-200 hover:bg-gray-50 hover:text-black"
              }`}
            >
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${active ? "bg-black text-white" : "bg-gray-100 text-gray-500"}`}>
                {choosing === index ? <Icon name="fa-circle-notch fa-spin" /> : choice.number}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{choice.label}</span>
                {choice.description ? <span className="block truncate text-xs text-gray-500">{choice.description}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
        {picker.hint || "Use arrow keys, Enter, or Escape."}
      </p>
    </div>
  );
}

function codexPickerControlKey(key: string): CodexControlKey | null {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "Enter") return "enter";
  if (key === "Escape") return "escape";
  return null;
}

function CodexStatusLine({ pane }: { pane: CodexTmuxPane | null }) {
  const label = pane?.ready
    ? "Codex ready"
    : pane?.viewingTranscript
      ? "Codex transcript open"
      : pane?.stagedInput
        ? "Submitting to Codex"
        : pane?.running
          ? "Codex working"
          : "Codex session not started";
  const dot = pane?.ready ? "bg-emerald-500" : pane?.viewingTranscript ? "bg-blue-400" : pane?.running ? "bg-amber-500" : "bg-gray-300";

  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-2 rounded-full bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
    </div>
  );
}

type CodexPaneTurn = {
  prompt: string;
  response: string;
  focusSummary?: string;
  actions: CodexPaneAction[];
};

type CodexPaneAction = {
  kind: "search" | "command" | "file" | "thinking" | "generic";
  label: string;
  detail?: string;
};

type CodexPaneChoicePicker = {
  title: string;
  description?: string;
  hint?: string;
  activeIndex: number;
  choices: Array<{
    number: string;
    label: string;
    description?: string;
  }>;
};

function buildCodexFocusState({
  pane,
  turns,
  loading,
  pendingStatus,
  missingVariables,
  git,
  root,
  selectedRun,
  sandboxRuns,
  chatSummary
}: {
  pane: CodexTmuxPane | null;
  turns: CodexPaneTurn[];
  loading: boolean;
  pendingStatus: string | null;
  missingVariables: number;
  git: GitWorkspaceStatus;
  root: TerraformRoot | null;
  selectedRun?: SandboxRun | null;
  sandboxRuns: SandboxRun[];
  chatSummary?: string;
}): {
  status: CodexFocusStatus;
  statusLabel: string;
  detail: string;
  rootName: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  actions: CodexFocusAction[];
  sandboxActions: CodexFocusAction[];
  responseSummary?: string;
} {
  const latestTurn = turns.at(-1);
  const latestActions = latestTurn?.actions || [];
  const recentActions = latestActions.slice(-18);
  const diffStats = summarizeDiffStats(git.files);
  const activeAction = recentActions.at(-1);
  const running = Boolean(loading || pendingStatus || (pane?.running && !pane.ready && !pane.viewingTranscript));
  const rootName = root?.name || root?.path.split("/").filter(Boolean).at(-1) || "workspace";
  let status: CodexFocusStatus = "idle";

  if (/failed|error/i.test(pendingStatus || "")) status = "error";
  else if (missingVariables > 0) status = "blocked";
  else if (running && activeAction && activeAction.kind !== "thinking") status = "tool_running";
  else if (running) status = "thinking";
  else if (git.files.length > 0) status = "files_changed";
  else if (pane?.ready || latestTurn?.response) status = "complete";

  const statusLabel = focusStatusLabel(status, pendingStatus, activeAction, missingVariables);
  const detail = focusStatusDetail(status, git.files.length, rootName, activeAction, selectedRun);
  const savedSummary = chatSummary ? cleanFocusSummary(chatSummary) : "";
  const responseSummary = running ? "" : latestTurn?.focusSummary || savedSummary || (pane?.ready && latestTurn?.response ? summarizeFocusResponse(latestTurn.response) : "");
  const actionFeed = recentActions.map((action) => ({
    kind: action.kind,
    label: action.label,
    detail: action.detail
  }));
  const sandboxActions = buildSandboxFocusActions({ sandboxRuns, pendingStatus, rootName });

  return {
    status,
    statusLabel,
    detail,
    rootName,
    changedFiles: git.files.length,
    additions: diffStats.additions,
    deletions: diffStats.deletions,
    actions: actionFeed.slice(-18),
    sandboxActions,
    responseSummary
  };
}

function buildSandboxFocusActions({
  sandboxRuns,
  pendingStatus,
  rootName
}: {
  sandboxRuns: SandboxRun[];
  pendingStatus: string | null;
  rootName: string;
}): CodexFocusAction[] {
  const actions: CodexFocusAction[] = sandboxRuns.slice(-10).map((run) => {
    const suffix = run.status === "succeeded"
      ? "succeeded"
      : run.status === "failed"
        ? "failed"
        : run.status === "running"
          ? "running"
          : run.status;
    const root = run.rootPath?.split("/").filter(Boolean).at(-1);
    const detail = [
      root || undefined,
      run.exitCode !== null && run.exitCode !== undefined ? `exit ${run.exitCode}` : undefined
    ].filter(Boolean).join(" · ");

    return {
      kind: "command" as const,
      label: `${modeLabel(run.mode)} ${suffix}`,
      detail,
      output: run.output
    };
  });

  if (pendingStatus && isSandboxPendingStatus(pendingStatus)) {
    actions.push({
      kind: "command",
      label: pendingStatus.replace(/\.\.\.$/, ""),
      detail: rootName
    });
  }

  return actions.slice(-1);
}

function isSandboxPendingStatus(status: string) {
  return /^(Formatting Terraform|Running Terraform plan|Applying Terraform|Destroying Terraform resources|Installing dependencies|Auditing dependencies|Running lint|Running tests|Building web app|Running validation)\b/.test(status);
}

function focusStatusLabel(status: CodexFocusStatus, pendingStatus: string | null, activeAction: CodexPaneAction | undefined, missingVariables: number) {
  if (status === "blocked") return `${missingVariables} input${missingVariables === 1 ? "" : "s"} needed`;
  if (status === "error") return "Attention needed";
  if (pendingStatus) return pendingStatus.replace(/\.\.\.$/, "");
  if (status === "tool_running") return activeAction?.kind === "search" ? "Searching" : "Running tools";
  if (status === "files_changed") return "Workspace changed";
  if (status === "thinking") return "Codex is thinking";
  if (status === "complete") return "Codex is ready";
  return "Codex focus";
}

function focusStatusDetail(
  status: CodexFocusStatus,
  changedFiles: number,
  rootName: string,
  activeAction: CodexPaneAction | undefined,
  selectedRun?: SandboxRun | null
) {
  if (status === "blocked") return `Provide the missing Terraform inputs for ${rootName}, then rerun the plan.`;
  if (status === "error") return selectedRun?.mode ? `${selectedRun.mode} needs review before continuing.` : "Open the transcript to inspect the failure.";
  if (status === "files_changed") return changedFiles ? `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed in the repository.` : "Codex is updating the workspace.";
  if (activeAction?.detail) return activeAction.detail;
  if (status === "tool_running") return "Codex is using commands, search, or file tools. The transcript is still being captured.";
  if (status === "thinking") return "The tmux-backed Codex session is active. Watch the file rail for repository changes.";
  if (status === "complete") return "Switch back to the response when you want the final explanation.";
  return "Use this mode when you care more about repository movement than every terminal line.";
}

function parseFocusSummaryLine(line: string): string | null {
  const match = line.match(/^(?:•\s*)?A2W_FOCUS_SUMMARY:\s*(.+)$/i);
  if (!match) return null;
  return cleanFocusSummary(match[1]);
}

function summarizeFocusResponse(response: string) {
  const clean = response
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line && !/^A2W_FOCUS_SUMMARY:/i.test(line) && !/^\/\s*T R A N S C R I P T/i.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";

  const usefulSentence = clean.match(/(?:I|Codex|Terraform|Git|The workspace|Workspace|Done|Created|Updated|Removed|Renamed|Added|Fixed)\b[^.!?]*(?:[.!?]|$)/i)?.[0] || clean;
  return cleanFocusSummary(usefulSentence);
}

function cleanFocusSummary(value: string) {
  const summary = value
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
    .slice(0, 220);
  if (!summary) return "";
  if (/^Greeted the (?:user|operator) and asked what (?:they|the user|the operator) want(?:s)? to work on\.?$/i.test(summary)) {
    return "I'm ready. What would you like to work on?";
  }
  if (isThirdPersonFocusSummary(summary)) return "";
  return summary.replace(/[.。!?]*$/, ".");
}

function isThirdPersonFocusSummary(summary: string) {
  return /^(?:I\s+)?(?:greeted|asked|told|explained|summarized|informed|confirmed|mentioned|noted|answered|responded to|described|outlined|reported)\s+(?:the\s+)?(?:user|operator)\b/i.test(summary);
}

function parseCodexPaneTurns(output: string): CodexPaneTurn[] {
  const turns: CodexPaneTurn[] = [];
  let current: CodexPaneTurn | null = null;
  let skippingPrimer = false;
  let collectingWrappedPrompt = false;
  let skippingFocusSummarySkill = false;
  let wrappedPromptLines: string[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    const plain = line.trim().replace(/^│\s?/, "").replace(/\s?│$/, "").trim();

    if (shouldSkipCodexPaneLine(plain)) continue;
    if (collectingWrappedPrompt) {
      if (plain.startsWith("A2W focus-summary skill:")) {
        skippingFocusSummarySkill = true;
        continue;
      }
      if (plain.startsWith("A2W_END_OPERATOR_CONTEXT")) {
        const prompt = wrappedPromptLines.join("\n").trim();
        if (prompt) {
          current = { prompt, response: "", actions: [] };
          turns.push(current);
        }
        collectingWrappedPrompt = false;
        skippingFocusSummarySkill = false;
        wrappedPromptLines = [];
        continue;
      }
      if (skippingFocusSummarySkill) continue;
      if (plain) wrappedPromptLines.push(plain);
      continue;
    }
    if (plain.startsWith("You are Codex inside ")) {
      skippingPrimer = true;
      continue;
    }
    if (skippingPrimer) {
      if (plain.startsWith("Operator request:")) skippingPrimer = false;
      continue;
    }
    if (plain.startsWith("Operator request:")) {
      collectingWrappedPrompt = true;
      skippingFocusSummarySkill = false;
      wrappedPromptLines = [];
      continue;
    }

    if (plain.startsWith("›")) {
      const prompt = plain.replace(/^›\s*/, "").trim();
      if (prompt.startsWith("Operator request:")) {
        collectingWrappedPrompt = true;
        skippingFocusSummarySkill = false;
        wrappedPromptLines = [];
        continue;
      }
      current = null;
      continue;
    }

    if (!current) continue;
    if (!plain && !current.response) continue;
    const focusSummary = parseFocusSummaryLine(plain);
    if (focusSummary !== null) {
      if (focusSummary) current.focusSummary = focusSummary;
      continue;
    }
    const action = parseCodexActionLine(plain);
    if (action) {
      current.actions.push(action);
      continue;
    }
    const responseLine = plain.startsWith("•") ? plain.replace(/^•\s*/, "") : plain;
    current.response = `${current.response}${current.response ? "\n" : ""}${responseLine}`;
  }

  return turns.map((turn) => ({ ...turn, response: turn.response.trim() }));
}

function parseCodexChoicePicker(output: string): CodexPaneChoicePicker | null {
  const lines = output.split("\n").map((line) => line.trim().replace(/^│\s?/, "").replace(/\s?│$/, "").trim());
  const choices: CodexPaneChoicePicker["choices"] = [];
  let activeIndex = -1;
  let firstChoiceIndex = -1;
  let hint = "";

  lines.forEach((line, lineIndex) => {
    const match = line.match(/^(›\s*)?(\d+)\.\s+(.+?)(?:\s{2,}(.+))?$/);
    if (!match) return;
    if (firstChoiceIndex === -1) firstChoiceIndex = lineIndex;
    if (match[1]) activeIndex = choices.length;
    choices.push({
      number: match[2],
      label: match[3].trim(),
      description: match[4]?.trim()
    });
  });

  if (!choices.length) return null;

  for (const line of lines.slice(firstChoiceIndex + choices.length)) {
    if (/press enter/i.test(line)) {
      hint = line;
      break;
    }
  }

  const title = findPickerTitle(lines, firstChoiceIndex);
  const description = lines
    .slice(Math.max(0, firstChoiceIndex - 3), firstChoiceIndex)
    .filter((line) => line && line !== title && !shouldSkipCodexPaneLine(line))
    .at(-1);

  return {
    title,
    description,
    hint,
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    choices
  };
}

function findPickerTitle(lines: string[], firstChoiceIndex: number) {
  for (let index = firstChoiceIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || shouldSkipCodexPaneLine(line)) continue;
    if (/press enter/i.test(line)) continue;
    if (/^›/.test(line)) continue;
    if (/^\d+\./.test(line)) continue;
    return line;
  }
  return "Choose an option";
}

function CodexActionTimeline({ actions }: { actions: CodexPaneAction[] }) {
  const groups = codexActionGroups(actions);

  return (
    <div className="grid min-w-0 max-w-full gap-2 overflow-hidden">
      {groups.map((group) => {
        return (
          <CodexActionGroupSection key={group.kind} kind={group.kind} actions={group.actions} />
        );
      })}
    </div>
  );
}

function CodexActionGroupSection({ kind, actions }: { kind: CodexPaneAction["kind"]; actions: CodexPaneAction[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [actions.length]);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
      <header className="flex h-9 items-center justify-between gap-2 border-b border-gray-100 bg-white/70 px-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-gray-700">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[10px] text-gray-500 shadow-sm shadow-black/5">
            <Icon name={codexActionIcon(kind)} />
          </span>
          {codexActionGroupLabel(kind)}
        </span>
        <span className="text-[11px] font-medium text-gray-400">{actions.length}</span>
      </header>
      <div ref={scrollRef} className="thin-scrollbar grid max-h-[7.9rem] gap-1 overflow-auto p-1.5">
        {actions.map((action, index) => (
          <CodexActionRow
            key={`${kind}-${index}-${action.label}-${action.detail || ""}`}
            action={action}
          />
        ))}
      </div>
    </section>
  );
}

function CodexActionRow({ action }: { action: CodexPaneAction }) {
  return (
    <div className="min-w-0 rounded-xl bg-white px-3 py-2 text-xs text-gray-500 shadow-sm shadow-black/[0.02]">
      <span className="font-semibold text-gray-700">{action.label}</span>
      {action.detail ? <span className="ml-1 break-all font-mono text-[11px] text-gray-500">{action.detail}</span> : null}
    </div>
  );
}

function codexActionGroups(actions: CodexPaneAction[]) {
  const byKind = new Map<CodexPaneAction["kind"], CodexPaneAction[]>();
  const order: CodexPaneAction["kind"][] = [];
  for (const action of actions) {
    if (!byKind.has(action.kind)) {
      byKind.set(action.kind, []);
      order.push(action.kind);
    }
    byKind.get(action.kind)!.push(action);
  }
  return order.map((kind) => ({ kind, actions: byKind.get(kind)! }));
}

function codexActionGroupLabel(kind: CodexPaneAction["kind"]) {
  if (kind === "search") return "Search";
  if (kind === "command") return "Terminal";
  if (kind === "file") return "Files";
  if (kind === "thinking") return "Reasoning";
  return "Actions";
}

function codexActionIcon(kind: CodexPaneAction["kind"]) {
  if (kind === "search") return "fa-magnifying-glass";
  if (kind === "command") return "fa-terminal";
  if (kind === "file") return "fa-file-code";
  if (kind === "thinking") return "fa-circle-notch";
  return "fa-bolt";
}

function parseCodexActionLine(plain: string): CodexPaneAction | null {
  const clean = plain.replace(/^•\s*/, "").trim();
  if (!clean) return null;

  if (/^Searching the web/i.test(clean)) {
    return { kind: "search", label: "Searching the web" };
  }
  if (/^Searched\b/i.test(clean)) {
    return { kind: "search", label: "Searched", detail: clean.replace(/^Searched\s*/i, "").trim() };
  }
  if (/^Running\b/i.test(clean)) {
    return { kind: "command", label: "Running", detail: clean.replace(/^Running\s*/i, "").trim() };
  }
  if (/^Ran\b/i.test(clean)) {
    return { kind: "command", label: "Ran", detail: clean.replace(/^Ran\s*/i, "").trim() };
  }
  if (/^(Reading|Read|Opening|Opened)\b/i.test(clean)) {
    return { kind: "file", label: clean.split(/\s+/)[0], detail: clean.replace(/^\S+\s*/i, "").trim() };
  }
  if (/^(Editing|Edited|Writing|Wrote|Updated|Created|Deleted)\b/i.test(clean)) {
    return { kind: "file", label: clean.split(/\s+/)[0], detail: clean.replace(/^\S+\s*/i, "").trim() };
  }
  if (/^(Thinking|Planning|Inspecting|Checking)\b/i.test(clean)) {
    return { kind: "thinking", label: clean };
  }

  return null;
}

function shouldSkipCodexPaneLine(plain: string) {
  if (!plain) return false;
  if (plain.includes("OpenAI Codex")) return true;
  if (plain.includes("Booting MCP server")) return true;
  if (plain.startsWith("model:")) return true;
  if (plain.startsWith("directory:")) return true;
  if (plain.startsWith("Tip:")) return true;
  if (plain.startsWith("gpt-") && plain.includes("·")) return true;
  return /^[╭╰╮╯│─>_ ]+$/.test(plain);
}

function MessageBubble({
  message,
  onAction
}: {
  message: Message;
  onAction: (action: MessageAction) => void;
}) {
  const user = message.role === "user";
  return (
    <article className={`flex min-w-0 gap-4 ${user ? "justify-end" : "justify-start"}`}>
      {!user ? (
        <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</span>
      ) : null}
      <div className={`min-w-0 max-w-[86%] ${user ? "rounded-[1.5rem] bg-gray-100 px-4 py-3" : "py-1"}`}>
        <MessageContent content={message.content} user={user} />
        {!user && message.actions?.length ? <MessageActions actions={message.actions} onAction={onAction} /> : null}
      </div>
    </article>
  );
}

function MessageActions({ actions, onAction }: { actions: MessageAction[]; onAction: (action: MessageAction) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onAction(action)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:border-gray-300 hover:text-black"
        >
          <Icon name={actionIcon(action.kind)} />
          {action.label}
        </button>
      ))}
    </div>
  );
}

function actionIcon(kind: MessageAction["kind"]) {
  if (kind === "open_inputs") return "fa-keyboard";
  if (kind === "open_runs") return "fa-clock-rotate-left";
  if (kind === "open_files") return "fa-folder-tree";
  if (kind === "open_checks") return "fa-shield-halved";
  return "fa-code-branch";
}

function MessageContent({ content, user }: { content: string; user: boolean }) {
  if (user) {
    return <p className="whitespace-pre-wrap text-sm leading-7 text-gray-900">{content}</p>;
  }

  const marker = "\n\nOutput:\n";
  const index = content.indexOf(marker);
  if (index === -1) {
    return (
      <div className="min-w-0 max-w-full overflow-hidden rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
        <MarkdownMessage content={content} />
      </div>
    );
  }

  const intro = content.slice(0, index);
  const output = content.slice(index + marker.length);
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
      <MarkdownMessage content={intro} />
      <details className="mt-4 rounded-[1.25rem] border border-gray-200 bg-[#fbfbf9] p-3" open={output.length < 1200}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Sandbox output</summary>
        <pre className="thin-scrollbar mt-3 max-h-80 max-w-full overflow-auto whitespace-pre-wrap rounded-[1rem] bg-black p-3 text-xs leading-6 text-gray-100">
          {output || "No output."}
        </pre>
      </details>
    </div>
  );
}

function PendingBubble({ message, centered }: { message: string; centered?: boolean }) {
  return (
    <article className={`flex gap-4 justify-start ${centered ? "mx-auto mt-20 max-w-3xl" : ""}`}>
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</span>
      <div className="rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
        <p className="inline-flex items-center gap-3 text-sm font-medium text-gray-700">
          <Icon name="fa-circle-notch fa-spin" />
          {message}
        </p>
      </div>
    </article>
  );
}

function ThinkingBubble({ centered }: { centered?: boolean }) {
  return (
    <article className={`flex gap-4 justify-start ${centered ? "mx-auto mt-20 max-w-3xl" : ""}`}>
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</span>
      <div className="rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
        <span className="inline-flex items-center gap-1.5" aria-label="Assistant is responding">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" />
        </span>
      </div>
    </article>
  );
}

function ApprovalStatusBubble({ plan }: { plan: InfraPlan }) {
  return (
    <article className="flex gap-4 justify-start">
      <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</span>
      <div className="max-w-[86%] rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] p-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-gray-900">
          {[
            `Approval recorded for ${plan.title}.`,
            "",
            "Progress:",
            "1. Approval is recorded in the workspace.",
            "2. Run terraform fmt and terraform plan from the action bar above the input.",
            "3. Browse files, then apply or destroy when the workspace policy allows cloud-changing actions."
          ].join("\n")}
        </p>
      </div>
    </article>
  );
}

function PlanModal({
  plans,
  selectedPlan,
  selectedRun,
  onClose,
  onSelect
}: {
  plans: InfraPlan[];
  selectedPlan: InfraPlan | null;
  selectedRun: SandboxRun | null;
  onClose: () => void;
  onSelect: (plan: InfraPlan) => void;
}) {
  return (
    <Modal
      title={selectedPlan?.title || "Plan"}
      description="Review the active plan. Terraform actions live above the chat input."
      icon="fa-code-branch"
      size="xl"
      onClose={onClose}
    >
      {selectedPlan ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-4">
            <div className="rounded-[1.75rem] bg-[#f7f7f4] p-5">
              <div className="flex flex-wrap gap-2">
                <Chip>{selectedPlan.providerLabel}</Chip>
                <Chip>{selectedPlan.status.replaceAll("_", " ")}</Chip>
                <Chip danger={selectedPlan.risk === "critical"}>{selectedPlan.risk}</Chip>
              </div>
              <p className="mt-4 text-sm leading-7 text-gray-700">{selectedPlan.summary}</p>
            </div>

            <details className="rounded-[1.5rem] border border-gray-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                <span className="inline-flex items-center gap-2">
                  <Icon name="fa-code" />
                  Terraform changes
                </span>
              </summary>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-gray-700">
                {selectedPlan.terraformChanges.map((item) => (
                  <li key={item} className="rounded-2xl bg-gray-50 px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </details>

            <details className="rounded-[1.5rem] border border-gray-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                <span className="inline-flex items-center gap-2">
                  <Icon name="fa-shield-halved" />
                  Safety checks
                </span>
              </summary>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-gray-700">
                {selectedPlan.securityChecks.map((item) => (
                  <li key={item} className="rounded-2xl bg-gray-50 px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </details>

            <details className="rounded-[1.5rem] border border-gray-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold">
                <span className="inline-flex items-center gap-2">
                  <Icon name="fa-folder-tree" />
                  Planned files
                </span>
              </summary>
              <ul className="mt-3 grid gap-2 text-sm leading-6 text-gray-700">
                {(selectedPlan.materializedFiles?.length ? selectedPlan.materializedFiles : selectedPlan.plannedFiles).map((item) => (
                  <li key={item} className="rounded-2xl bg-gray-50 px-3 py-2 font-mono text-xs">
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <aside className="grid gap-3">
            <MiniStat label="Provider" value={selectedPlan.providerLabel} />
            <MiniStat label="Files" value={`${selectedPlan.materializedFiles?.length || 0}`} />
            <MiniStat label="Latest sandbox" value={selectedRun ? `${selectedRun.mode} ${selectedRun.status}` : "not run"} />

            {plans.length > 1 ? (
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Plan history
                <select
                  value={selectedPlan.id}
                  onChange={(event) => {
                    const next = plans.find((plan) => plan.id === event.target.value);
                    if (next) onSelect(next);
                  }}
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                >
                  {plans.slice().reverse().map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.title} - {plan.status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-7 text-gray-600">
              Sandbox output is posted into the transcript. Use the action bar above the composer for fmt, plan, files, approval, apply, and destroy.
            </div>
          </aside>
        </div>
      ) : (
        <div className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-7 text-gray-600">
          Use chat to create a plan.
        </div>
      )}
    </Modal>
  );
}

function ChecksModal({ root, onClose }: { root: TerraformRoot | null; onClose: () => void }) {
  return (
    <Modal title="Root checks" description="Policy and structure checks for the selected Terraform root." icon="fa-shield-halved" size="xl" onClose={onClose}>
      {root ? (
        <div className="mt-5 grid gap-4">
          <div className="rounded-[1.5rem] bg-[#f7f7f4] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Terraform root</p>
            <p className="mt-2 truncate font-mono text-sm text-gray-800">{root.path}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <MiniStat label="Initialized" value={root.initialized ? "yes" : "no"} />
              <MiniStat label="Backend" value={root.backend} />
              <MiniStat label="Applied" value={root.applied ? "yes" : "no"} />
              <MiniStat label="Resources" value={`${root.resourceCount}`} />
            </div>
          </div>
          <div className="grid gap-3">
            {root.checks.map((check) => (
              <div key={check.id} className="rounded-[1.25rem] border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{check.label}</p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">{check.detail}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${check.status === "pass" ? "bg-emerald-50 text-emerald-700" : check.status === "warn" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                    {check.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm text-gray-600">No Terraform root is selected.</p>
      )}
    </Modal>
  );
}

function DiffModal({
  git,
  loading,
  onClose,
  onRefresh
}: {
  git: GitWorkspaceStatus;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  return (
    <Modal title="Workspace diff" description="Review local repository changes before approving or committing." icon="fa-code-branch" size="xl" onClose={onClose}>
      <div className="mt-5 flex justify-end">
        <button type="button" onClick={onRefresh} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-full border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition hover:border-gray-300 disabled:text-gray-400">
          <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-rotate"} />
          Refresh
        </button>
      </div>
      <GitDiffContent git={git} />
    </Modal>
  );
}

function CommitPushModal({
  git,
  loading,
  commitMessage,
  onCommitMessageChange,
  onClose,
  onInit,
  onCommit,
  onSync,
  onPush,
  onCommitAndPush,
  onCreateBranch
}: {
  git: GitWorkspaceStatus;
  loading: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onClose: () => void;
  onInit: () => void;
  onCommit: (mode: "all" | "staged") => void;
  onSync: () => void;
  onPush: () => void;
  onCommitAndPush: () => void;
  onCreateBranch: (branch: string) => void;
}) {
  const stagedCount = git.files.filter((file) => Boolean(file.indexStatus && file.indexStatus !== "?")).length;
  const changedCount = git.files.length;
  const detached = isDetachedGit(git);
  const [detachedBranchName, setDetachedBranchName] = useState(defaultDetachedBranchName(git));
  const canPush = Boolean(git.remoteUrl) && (git.ahead || 0) > 0 && !detached;
  const canSync = Boolean(git.remoteUrl) && Boolean(git.upstream) && !detached;
  const canCommit = git.initialized && changedCount > 0;
  const canCommitAndPush = canCommit && Boolean(git.remoteUrl) && !detached;

  useEffect(() => {
    if (detached) setDetachedBranchName(defaultDetachedBranchName(git));
  }, [detached, git.head?.shortHash]);

  return (
    <Modal
      title="Commit & push"
      description="Checkpoint the current Terraform repository without opening the full Git workspace."
      icon="fa-cloud-arrow-up"
      size="xl"
      onClose={onClose}
    >
      <div className="mt-5 grid gap-4">
        <GitStatusStrip git={git} />

        {!git.initialized ? (
          <button type="button" onClick={onInit} disabled={loading || !git.available} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
            <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-code-commit"} />
            Initialize Git repository
          </button>
        ) : (
          <>
            {detached ? (
              <DetachedHeadCallout
                git={git}
                branchName={detachedBranchName}
                loading={loading}
                onBranchNameChange={setDetachedBranchName}
                onCreateBranch={() => onCreateBranch(detachedBranchName)}
              />
            ) : null}

            <div className="grid gap-3 rounded-[1.5rem] border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Ready to checkpoint</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {changedCount ? `${changedCount} changed file${changedCount === 1 ? "" : "s"}` : "No local changes"}
                    {stagedCount ? ` · ${stagedCount} staged` : ""}
                    {(git.ahead || 0) > 0 ? ` · ${git.ahead} commit${git.ahead === 1 ? "" : "s"} ahead` : ""}
                    {(git.behind || 0) > 0 ? ` · ${git.behind} behind` : ""}
                  </p>
                </div>
                {!git.remoteUrl ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">No remote</span>
                ) : null}
              </div>

              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Commit message
                <input
                  value={commitMessage}
                  onChange={(event) => onCommitMessageChange(event.target.value)}
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-4 outline-none transition focus:border-black"
                />
              </label>

              <div className="flex flex-wrap justify-end gap-2">
                <GitButton label="Commit staged" tooltip="Commit only staged files" icon="fa-check" primary disabled={loading || !stagedCount} onClick={() => onCommit("staged")} />
                <GitButton label="Commit all" tooltip="Stage and commit all local changes" icon="fa-check-double" primary disabled={loading || !canCommit} onClick={() => onCommit("all")} />
                <GitButton label={(git.behind || 0) > 0 ? `Sync ${git.behind}` : "Sync"} tooltip="Fetch and rebase this branch before pushing" icon="fa-rotate" disabled={loading || !canSync} onClick={onSync} />
                <GitButton label={(git.ahead || 0) > 0 ? `Push ${git.ahead}` : "Push"} tooltip="Push committed changes to the remote branch" icon="fa-arrow-up" disabled={loading || !canPush} onClick={onPush} />
                <GitButton label="Commit all & push" tooltip="Stage all changes, commit, then push" icon="fa-cloud-arrow-up" primary disabled={loading || !canCommitAndPush} onClick={onCommitAndPush} />
              </div>
            </div>

            <div className="thin-scrollbar grid max-h-80 gap-2 overflow-auto rounded-[1.5rem] bg-gray-50 p-3">
              {git.files.length ? git.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{file.status}</span>
                  <span className="min-w-0 truncate font-mono text-xs font-semibold text-gray-800">{file.path}</span>
                </div>
              )) : (
                <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">No uncommitted workspace changes.</p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function MergeBranchModal({
  git,
  loading,
  onClose,
  onMerge
}: {
  git: GitWorkspaceStatus;
  loading: boolean;
  onClose: () => void;
  onMerge: (targetBranch: string, push: boolean) => void | Promise<void>;
}) {
  const sourceBranch = git.branch || "";
  const [targetBranch, setTargetBranch] = useState(defaultMergeTargetBranch(git));
  const [pushAfterMerge, setPushAfterMerge] = useState(false);
  const detached = isDetachedGit(git);
  const sameBranch = Boolean(sourceBranch && targetBranch.trim() === sourceBranch);
  const disabled = loading || detached || !sourceBranch || sameBranch || !targetBranch.trim();

  useEffect(() => {
    setTargetBranch(defaultMergeTargetBranch(git));
  }, [git.branch]);

  return (
    <Modal
      title="Merge branch"
      description="Merge the current workspace branch into a target branch."
      icon="fa-code-merge"
      size="xl"
      onClose={onClose}
    >
      <div className="mt-5 grid gap-4">
        <GitStatusStrip git={git} />

        {detached ? (
          <p className="rounded-[1.5rem] border border-[#F05032]/20 bg-[#F05032]/5 p-4 text-sm leading-6 text-gray-700">
            This workspace is on a detached HEAD. Create a branch before merging.
          </p>
        ) : (
          <div className="grid gap-4 rounded-[1.5rem] border border-gray-200 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Source</p>
                <p className="mt-2 truncate font-mono text-sm font-semibold text-gray-900">{sourceBranch || "unknown"}</p>
              </div>
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                Target branch
                <input
                  value={targetBranch}
                  onChange={(event) => setTargetBranch(event.target.value)}
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-4 font-mono outline-none transition focus:border-black"
                  placeholder="main"
                />
              </label>
            </div>

            {sameBranch ? (
              <p className="rounded-2xl bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-800">
                Pick a different target branch. Source and target cannot be the same.
              </p>
            ) : (
              <p className="text-xs leading-5 text-gray-500">
                The workspace must be clean. A merge conflict will stop the operation so you can resolve it in the repository.
              </p>
            )}

            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
              <input
                type="checkbox"
                checked={pushAfterMerge}
                onChange={(event) => setPushAfterMerge(event.target.checked)}
              />
              Push target branch after merge
            </label>

            <div className="flex justify-end gap-2">
              <GitButton label="Cancel" disabled={loading} onClick={onClose} />
              <GitButton
                label="Merge"
                tooltip="Merge the current branch into the target branch"
                icon={loading ? "fa-circle-notch fa-spin" : "fa-code-merge"}
                primary
                disabled={disabled}
                onClick={() => void onMerge(targetBranch.trim(), pushAfterMerge)}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function DetachedHeadCallout({
  git,
  branchName,
  loading,
  onBranchNameChange,
  onCreateBranch
}: {
  git: GitWorkspaceStatus;
  branchName: string;
  loading: boolean;
  onBranchNameChange: (value: string) => void;
  onCreateBranch: () => void;
}) {
  const shortHash = git.head?.shortHash || "HEAD";
  return (
    <section className="rounded-[1.5rem] border border-[#F05032]/20 bg-[#F05032]/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-950">
            <Icon name="fa-code-branch" className="text-[#F05032]" />
            Detached HEAD
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            The workspace is checked out at <span className="font-mono font-semibold text-gray-900">{shortHash}</span>.
            Create a branch from this commit before pushing.
          </p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 font-mono text-[11px] font-semibold text-[#F05032]">
          no branch
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1.5 text-xs font-semibold text-gray-700">
          New branch name
          <input
            value={branchName}
            onChange={(event) => onBranchNameChange(event.target.value)}
            className="h-10 rounded-2xl border border-gray-200 bg-white px-3 font-mono text-sm text-black outline-none transition focus:border-[#F05032]"
            placeholder="workspace-updates"
          />
        </label>
        <div className="flex items-end">
          <GitButton
            label="Create branch"
            tooltip="Create a branch at the current detached HEAD"
            icon="fa-plus"
            primary
            disabled={loading || !branchName.trim()}
            onClick={onCreateBranch}
          />
        </div>
      </div>
    </section>
  );
}

function GitModal({
  git,
  history,
  stashes,
  loading,
  commitMessage,
  stashMessage,
  onCommitMessageChange,
  onStashMessageChange,
  onClose,
  onInit,
  onStage,
  onUnstage,
  onCommit,
  onSync,
  onPush,
  onCreateBranch,
  onStash,
  onStashApply,
  onStashDrop,
  onCheckout,
  onRevert,
  onReset,
  onResetAll,
  onDiscardFile,
  onRefresh
}: {
  git: GitWorkspaceStatus;
  history: GitCommit[];
  stashes: GitStashEntry[];
  loading: boolean;
  commitMessage: string;
  stashMessage: string;
  onCommitMessageChange: (value: string) => void;
  onStashMessageChange: (value: string) => void;
  onClose: () => void;
  onInit: () => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onCommit: (mode: "all" | "staged") => void;
  onSync: () => void;
  onPush: () => void;
  onCreateBranch: (branch: string) => void;
  onStash: (includeUntracked: boolean) => void;
  onStashApply: (index: number, mode: "apply" | "pop") => void;
  onStashDrop: (index: number) => void;
  onCheckout: (ref: string, options?: { stashBefore?: boolean; createBranch?: string }) => void;
  onRevert: (ref: string, options?: { stashBefore?: boolean }) => void;
  onReset: (ref: string, options: { confirm: string; stashBefore?: boolean }) => void;
  onResetAll: () => void;
  onDiscardFile: (path: string) => void;
  onRefresh: () => void;
}) {
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [pendingAction, setPendingAction] = useState<{ kind: "checkout" | "branch" | "revert" | "reset"; commit: GitCommit } | null>(null);
  const [branchName, setBranchName] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [stashBefore, setStashBefore] = useState(false);
  const [dropConfirmIndex, setDropConfirmIndex] = useState<number | null>(null);
  const [discardConfirmPath, setDiscardConfirmPath] = useState<string | null>(null);
  const [resetAllConfirm, setResetAllConfirm] = useState("");
  const [focusedGitPanel, setFocusedGitPanel] = useState<"history" | "changes" | "stashes" | null>(null);
  const detached = isDetachedGit(git);
  const [detachedBranchName, setDetachedBranchName] = useState(defaultDetachedBranchName(git));
  const dirty = git.initialized && !git.clean;
  const stagedCount = git.files.filter((file) => Boolean(file.indexStatus && file.indexStatus !== "?")).length;
  const unstagedCount = git.files.filter((file) => Boolean(file.worktreeStatus)).length;
  const canSync = Boolean(git.remoteUrl) && Boolean(git.upstream) && !detached;

  useEffect(() => {
    if (detached) setDetachedBranchName(defaultDetachedBranchName(git));
  }, [detached, git.head?.shortHash]);

  function startHistoryAction(kind: "checkout" | "branch" | "revert" | "reset", commit: GitCommit) {
    setPendingAction({ kind, commit });
    setBranchName(`restore-${commit.shortHash}`);
    setResetConfirm("");
    setStashBefore(false);
  }

  function runPendingAction() {
    if (!pendingAction) return;
    const ref = pendingAction.commit.hash;
    const options = dirty ? { stashBefore } : undefined;
    if (pendingAction.kind === "checkout") onCheckout(ref, options);
    if (pendingAction.kind === "branch") onCheckout(ref, { ...options, createBranch: branchName });
    if (pendingAction.kind === "revert") onRevert(ref, options);
    if (pendingAction.kind === "reset") onReset(ref, { confirm: resetConfirm, ...(dirty ? { stashBefore } : {}) });
    setPendingAction(null);
  }

  return (
    <Modal
      title="Git workspace"
      description="Review history, checkpoint changes, commit, push, stash, and recover safely."
      icon="fa-brands fa-git-alt"
      iconClassName="text-[34px] text-[#F05032]"
      iconFrameClassName="grid h-12 w-12 shrink-0 place-items-center"
      size="xl"
      onClose={onClose}
    >
      <div className="mt-5 grid min-h-0 gap-4">
        <GitStatusStrip git={git} />

        {!git.initialized ? (
          <button type="button" onClick={onInit} disabled={loading || !git.available} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
            <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-code-commit"} />
            Initialize Git repository
          </button>
        ) : (
          <>
          {detached ? (
            <DetachedHeadCallout
              git={git}
              branchName={detachedBranchName}
              loading={loading}
              onBranchNameChange={setDetachedBranchName}
              onCreateBranch={() => onCreateBranch(detachedBranchName)}
            />
          ) : null}

          <div className={`grid min-h-0 gap-4 ${detached ? "lg:h-[calc(100vh-340px)]" : "lg:h-[calc(100vh-280px)]"} ${focusedGitPanel ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(360px,0.92fr)_minmax(460px,1.08fr)]"}`}>
            {focusedGitPanel === null || focusedGitPanel === "history" ? (
            <section className="flex min-h-0 flex-col gap-3 rounded-[1.5rem] border border-gray-200 p-4 lg:h-full">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">History</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {git.head ? `HEAD ${git.head.shortHash}: ${git.head.subject}` : "No commits yet."}
                    {(git.ahead || git.behind) ? ` · ahead ${git.ahead || 0}, behind ${git.behind || 0}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <GitPanelFocusButton focused={focusedGitPanel === "history"} onClick={() => setFocusedGitPanel(focusedGitPanel === "history" ? null : "history")} />
                  <GitButton label={(git.behind || 0) > 0 ? `Sync ${git.behind}` : "Sync"} tooltip={detached ? "Create a branch before syncing" : "Fetch and rebase this branch before pushing"} icon="fa-rotate" disabled={loading || !canSync} onClick={onSync} />
                  <GitButton label={(git.ahead || 0) > 0 ? `Push ${git.ahead}` : "Push"} tooltip={detached ? "Create a branch from this detached HEAD before pushing" : "Push committed changes to the remote branch"} icon="fa-arrow-up" disabled={loading || !git.remoteUrl || detached} onClick={onPush} />
                </div>
              </div>

              {pendingAction ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-amber-950">{gitHistoryActionTitle(pendingAction.kind)}</p>
                      <p className="mt-1 text-xs leading-5 text-amber-800">
                        Target: <span className="font-mono">{pendingAction.commit.shortHash}</span> {pendingAction.commit.subject}
                      </p>
                    </div>
                    <button type="button" onClick={() => setPendingAction(null)} className="grid h-8 w-8 place-items-center rounded-lg text-amber-800 transition hover:bg-amber-100" aria-label="Cancel Git action">
                      <Icon name="fa-xmark" />
                    </button>
                  </div>
                  {dirty ? (
                    <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-amber-900">
                      <input type="checkbox" checked={stashBefore} onChange={(event) => setStashBefore(event.target.checked)} />
                      Stash current working changes before continuing
                    </label>
                  ) : null}
                  {pendingAction.kind === "branch" ? (
                    <label className="mt-3 grid gap-2 text-xs font-semibold text-amber-900">
                      New branch name
                      <input value={branchName} onChange={(event) => setBranchName(event.target.value)} className="h-10 rounded-xl border border-amber-200 bg-white px-3 text-sm text-black outline-none focus:border-amber-500" />
                    </label>
                  ) : null}
                  {pendingAction.kind === "reset" ? (
                    <label className="mt-3 grid gap-2 text-xs font-semibold text-amber-900">
                      Type RESET to hard reset this repository
                      <input value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} className="h-10 rounded-xl border border-amber-200 bg-white px-3 text-sm text-black outline-none focus:border-amber-500" />
                    </label>
                  ) : null}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <GitButton label="Cancel" disabled={loading} onClick={() => setPendingAction(null)} />
                    <GitButton
                      label={pendingAction.kind === "reset" ? "Hard reset" : pendingAction.kind === "revert" ? "Revert" : pendingAction.kind === "branch" ? "Create branch" : "Checkout"}
                      tooltip={pendingAction.kind === "reset" ? "Move this branch to the selected commit" : pendingAction.kind === "revert" ? "Create a new commit that undoes this commit" : pendingAction.kind === "branch" ? "Create a new branch at this commit" : "Check out this exact commit"}
                      danger={pendingAction.kind === "reset"}
                      primary={pendingAction.kind !== "reset"}
                      disabled={loading || (dirty && !stashBefore) || (pendingAction.kind === "reset" && resetConfirm !== "RESET") || (pendingAction.kind === "branch" && !branchName.trim())}
                      onClick={runPendingAction}
                    />
                  </div>
                </div>
              ) : null}

              <GitHistoryTimeline
                history={history}
                currentHash={git.head?.hash || ""}
                loading={loading}
                onAction={startHistoryAction}
              />
            </section>
            ) : null}

            {focusedGitPanel !== "history" ? (
            <div className={`grid min-h-0 gap-4 lg:h-full ${focusedGitPanel ? "" : "lg:grid-rows-[minmax(0,1fr)_minmax(0,0.72fr)]"}`}>
              {focusedGitPanel === null || focusedGitPanel === "changes" ? (
              <section className="flex min-h-0 flex-col gap-3 rounded-[1.5rem] border border-gray-200 p-4 lg:h-full">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Current changes</h3>
                    <p className="mt-1 text-xs text-gray-500">{stagedCount} staged, {unstagedCount} unstaged</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <GitPanelFocusButton focused={focusedGitPanel === "changes"} onClick={() => setFocusedGitPanel(focusedGitPanel === "changes" ? null : "changes")} />
                    <GitButton label="Stage all" tooltip="Stage every changed file for the next commit" icon="fa-plus" disabled={loading || git.clean} onClick={() => onStage([])} />
                    <GitButton label="Unstage all" tooltip="Move all staged files back to working changes" icon="fa-minus" disabled={loading || !stagedCount} onClick={() => onUnstage([])} />
                    <GitButton label="Stash all" tooltip="Save every current change into a stash" icon="fa-box-archive" disabled={loading || git.clean} onClick={() => onStash(includeUntracked)} />
                    <GitButton label="Reset all" tooltip="Discard every uncommitted workspace change" icon="fa-rotate-left" danger disabled={loading || git.clean} onClick={() => setResetAllConfirm("pending")} />
                  </div>
                </div>

                {resetAllConfirm ? (
                  <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-red-950">Reset all workspace changes?</p>
                        <p className="mt-1 text-xs leading-5 text-red-800">This discards staged, unstaged, and untracked files in the repository.</p>
                      </div>
                      <button type="button" onClick={() => setResetAllConfirm("")} className="grid h-8 w-8 place-items-center rounded-lg text-red-800 transition hover:bg-red-100" aria-label="Cancel reset all">
                        <Icon name="fa-xmark" />
                      </button>
                    </div>
                    <label className="mt-3 grid gap-2 text-xs font-semibold text-red-900">
                      Type RESET to continue
                      <input
                        value={resetAllConfirm === "pending" ? "" : resetAllConfirm}
                        onChange={(event) => setResetAllConfirm(event.target.value)}
                        className="h-10 rounded-xl border border-red-200 bg-white px-3 text-sm text-black outline-none focus:border-red-500"
                      />
                    </label>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <GitButton label="Cancel" disabled={loading} onClick={() => setResetAllConfirm("")} />
                      <GitButton
                        label="Reset all"
                        tooltip="Discard all workspace changes"
                        danger
                        disabled={loading || resetAllConfirm !== "RESET"}
                        onClick={() => { onResetAll(); setResetAllConfirm(""); }}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 rounded-2xl bg-gray-50 p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    Commit message
                    <input
                      value={commitMessage}
                      onChange={(event) => onCommitMessageChange(event.target.value)}
                      className="h-11 rounded-2xl border border-gray-200 bg-white px-4 outline-none transition focus:border-black"
                    />
                  </label>
                  <div className="flex flex-wrap items-end gap-2">
                    <GitButton label="Commit staged" tooltip="Commit only the staged files" icon="fa-check" primary disabled={loading || !stagedCount} onClick={() => onCommit("staged")} />
                    <GitButton label="Commit all" tooltip="Stage and commit all current workspace changes" icon="fa-check-double" primary disabled={loading || git.clean} onClick={() => onCommit("all")} />
                  </div>
                </div>

                <div className="thin-scrollbar grid min-h-0 flex-1 gap-2 overflow-auto pr-1">
                  {git.files.length ? git.files.map((file) => (
                    <div key={file.path} className="rounded-2xl bg-gray-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="mr-2 rounded-full bg-white px-2 py-0.5 font-mono text-xs text-gray-600">{file.status}</span>
                          <span className="break-all font-mono text-xs font-semibold text-gray-800">{file.path}</span>
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <GitIconButton label="Stage file" tooltip="Stage this file" icon="fa-plus" disabled={loading} onClick={() => onStage([file.path])} />
                          <GitIconButton label="Unstage file" tooltip="Remove this file from the staged set" icon="fa-minus" disabled={loading || !file.indexStatus || file.indexStatus === "?"} onClick={() => onUnstage([file.path])} />
                          <GitIconButton label="Discard file" tooltip="Discard local changes in this file" icon="fa-trash" danger disabled={loading} onClick={() => setDiscardConfirmPath(file.path)} />
                        </span>
                      </div>
                      {discardConfirmPath === file.path ? (
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3">
                          <span className="mr-auto text-xs text-gray-500">Discard local changes in this file?</span>
                          <GitButton label="Cancel" disabled={loading} onClick={() => setDiscardConfirmPath(null)} />
                          <GitButton label="Discard" danger disabled={loading} onClick={() => { onDiscardFile(file.path); setDiscardConfirmPath(null); }} />
                        </div>
                      ) : null}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-gray-500">Diff preview</summary>
                        <pre className="thin-scrollbar mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-black p-3 text-xs leading-5 text-gray-100">
                          {file.diff || "No textual diff available."}
                        </pre>
                      </details>
                    </div>
                  )) : (
                    <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">No uncommitted workspace changes.</p>
                  )}
                </div>
              </section>
              ) : null}

              {focusedGitPanel === null || focusedGitPanel === "stashes" ? (
              <section className="flex min-h-0 flex-col gap-3 rounded-[1.5rem] border border-gray-200 p-4 lg:h-full">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Stashes</h3>
                    <p className="mt-1 text-xs text-gray-500">{stashes.length ? `${stashes.length} saved checkpoint${stashes.length === 1 ? "" : "s"}` : "No saved checkpoints"}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <GitPanelFocusButton focused={focusedGitPanel === "stashes"} onClick={() => setFocusedGitPanel(focusedGitPanel === "stashes" ? null : "stashes")} />
                    <GitButton label="Stash changes" tooltip="Save current changes without committing them" icon="fa-box-archive" disabled={loading || git.clean} onClick={() => onStash(includeUntracked)} />
                  </div>
                </div>

                <div className="grid gap-3 rounded-2xl bg-gray-50 p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    Stash message
                    <input
                      value={stashMessage}
                      onChange={(event) => onStashMessageChange(event.target.value)}
                      className="h-10 rounded-2xl border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-xs font-medium text-gray-600">
                    <input type="checkbox" checked={includeUntracked} onChange={(event) => setIncludeUntracked(event.target.checked)} />
                    Include untracked
                  </label>
                </div>

                <div className="thin-scrollbar grid min-h-0 flex-1 gap-2 overflow-auto pr-1">
                  {stashes.length ? stashes.map((stash) => (
                    <div key={stash.name} className="rounded-2xl bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-gray-800">{stash.name}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600">{stash.message}</p>
                          <p className="mt-1 text-[11px] text-gray-400">{stash.relativeTime}</p>
                        </div>
                        <span className="flex shrink-0 gap-1">
                          <GitIconButton label="Apply stash" tooltip="Apply this stash and keep it saved" icon="fa-clone" disabled={loading} onClick={() => onStashApply(stash.index, "apply")} />
                          <GitIconButton label="Pop stash" tooltip="Apply this stash and remove it" icon="fa-box-open" disabled={loading} onClick={() => onStashApply(stash.index, "pop")} />
                          <GitIconButton label="Drop stash" tooltip="Delete this stash" icon="fa-trash" danger disabled={loading} onClick={() => setDropConfirmIndex(stash.index)} />
                        </span>
                      </div>
                      {dropConfirmIndex === stash.index ? (
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-200 pt-3">
                          <span className="mr-auto text-xs text-gray-500">Drop this stash?</span>
                          <GitButton label="Cancel" disabled={loading} onClick={() => setDropConfirmIndex(null)} />
                          <GitButton label="Drop" danger disabled={loading} onClick={() => { onStashDrop(stash.index); setDropConfirmIndex(null); }} />
                        </div>
                      ) : null}
                    </div>
                  )) : (
                    <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">No stashes yet.</p>
                  )}
                </div>
              </section>
              ) : null}
            </div>
            ) : null}
          </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function GitStatusStrip({ git }: { git: GitWorkspaceStatus }) {
  const repository = git.repositoryName || "repository";
  const detached = isDetachedGit(git);
  const branch = detached ? "Detached HEAD" : git.branch || "-";
  const upstream = detached ? `HEAD ${git.head?.shortHash || ""}`.trim() : git.upstream || "no upstream";
  const changes = git.clean ? "clean" : `${git.files.length} changed`;
  const sync = detached ? "branch required" : (git.ahead || git.behind) ? `ahead ${git.ahead || 0} / behind ${git.behind || 0}` : "synced";
  const repositoryUrl = gitRepositoryWebUrl(git.remoteUrl);

  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f7f7f4] px-4 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name="fa-brands fa-git-alt" className="text-xl text-[#F05032]" />
        {repositoryUrl ? (
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate rounded-lg font-mono text-sm font-semibold text-gray-950 underline-offset-4 transition hover:text-[#F05032] hover:underline"
            title={`Open ${repository} repository`}
          >
            {repository}:{branch}
          </a>
        ) : (
          <span className="min-w-0 truncate font-mono text-sm font-semibold text-gray-950">{repository}:{branch}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500">
        <span className="rounded-full bg-white px-2.5 py-1">upstream <span className="font-mono text-gray-800">{upstream}</span></span>
        <span className={`rounded-full px-2.5 py-1 font-semibold ${git.clean ? "bg-white text-gray-500" : "bg-[#F05032]/10 text-[#F05032]"}`}>{changes}</span>
        <span className={`rounded-full px-2.5 py-1 ${detached ? "bg-[#F05032]/10 text-[#F05032]" : "bg-white"}`}>{sync}</span>
      </div>
    </div>
  );
}

function isDetachedGit(git: GitWorkspaceStatus) {
  return Boolean(git.initialized && git.branch === "detached");
}

function defaultDetachedBranchName(git: GitWorkspaceStatus) {
  const shortHash = git.head?.shortHash || "head";
  return `workspace-${shortHash}`;
}

function defaultMergeTargetBranch(git: GitWorkspaceStatus) {
  const branch = git.branch || "";
  if (branch && branch !== "main") return "main";
  if (branch && branch !== "master") return "master";
  return "main";
}

function gitRepositoryWebUrl(remoteUrl?: string) {
  const remote = String(remoteUrl || "").trim();
  if (!remote) return "";
  const normalized = remote.replace(/\.git$/, "");
  if (/^https?:\/\//.test(normalized)) return normalized;

  const azureScpLike = normalized.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/(.+)$/);
  if (azureScpLike) {
    const [, org, project, repo] = azureScpLike;
    return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
  }

  const scpLike = normalized.match(/^git@([^:]+):(.+)$/);
  if (scpLike) {
    const [, host, path] = scpLike;
    return `https://${host}/${path}`;
  }

  const sshUrl = normalized.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/);
  if (sshUrl) {
    const [, host, path] = sshUrl;
    const azurePath = path.match(/^v3\/([^/]+)\/([^/]+)\/(.+)$/);
    if (host === "ssh.dev.azure.com" && azurePath) {
      const [, org, project, repo] = azurePath;
      return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
    }
    return `https://${host}/${path}`;
  }

  return "";
}

function GitHistoryTimeline({
  history,
  currentHash,
  loading,
  onAction
}: {
  history: GitCommit[];
  currentHash: string;
  loading: boolean;
  onAction: (kind: "checkout" | "branch" | "revert" | "reset", commit: GitCommit) => void;
}) {
  if (!history.length) {
    return <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">No Git history available.</p>;
  }

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-auto pr-1">
      <ol className="grid">
        {history.map((commit, index) => (
          <li key={commit.hash} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
            <GitGraphRail commit={commit} index={index} total={history.length} current={commit.hash === currentHash} />
            <article className={`mb-3 rounded-2xl border p-3 transition hover:border-gray-200 hover:bg-white ${
              commit.hash === currentHash ? "border-[#F05032]/30 bg-[#F05032]/5 shadow-sm shadow-[#F05032]/10" : "border-gray-100 bg-gray-50/90"
            }`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-gray-950">{commit.shortHash}</span>
                    {commit.hash === currentHash ? <span className="rounded-full bg-[#F05032]/10 px-2 py-0.5 text-[11px] font-semibold text-[#F05032]">current HEAD</span> : null}
                    {commit.parents.length > 1 ? <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-semibold text-white">merge</span> : null}
                    {commit.parents.length === 0 ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500">root</span> : null}
                    {commit.refs.map((ref) => (
                      <GitRefPill key={`${commit.hash}-${ref}`} refName={ref} />
                    ))}
                  </div>
                  <p className="mt-2 break-words text-sm font-semibold leading-5 text-gray-800">{commit.subject}</p>
                  <p className="mt-1 text-xs text-gray-500">{commit.authorName} · {commit.relativeTime}</p>
                </div>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <GitIconButton label="Checkout commit" tooltip="Inspect the repository at this commit" icon="fa-code-branch" disabled={loading} onClick={() => onAction("checkout", commit)} />
                  <GitIconButton label="Create branch here" tooltip="Create a new branch from this commit" icon="fa-plus" disabled={loading} onClick={() => onAction("branch", commit)} />
                  <GitIconButton label="Revert commit" tooltip="Create a revert commit for this change" icon="fa-rotate-left" disabled={loading} onClick={() => onAction("revert", commit)} />
                  <GitIconButton label="Hard reset here" tooltip="Move the current branch back to this commit" icon="fa-triangle-exclamation" danger disabled={loading} onClick={() => onAction("reset", commit)} />
                </span>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}

function GitGraphRail({ commit, index, total, current }: { commit: GitCommit; index: number; total: number; current: boolean }) {
  const isMerge = commit.parents.length > 1;
  const isRoot = commit.parents.length === 0;

  return (
    <div className="relative flex justify-center">
      {index > 0 ? <span className="absolute top-0 h-5 w-px bg-gray-200" /> : null}
      {index < total - 1 ? <span className="absolute bottom-0 top-5 w-px bg-gray-200" /> : null}
      {isMerge ? (
        <>
          <span className="absolute left-1/2 top-5 h-px w-4 rounded-full bg-[#F05032]/50" />
          <span className="absolute left-[0.55rem] top-3 h-4 w-px rounded-full bg-[#F05032]/50" />
        </>
      ) : null}
      <span
        className={`relative mt-3 grid h-4 w-4 place-items-center rounded-full border-2 bg-white ${
          current
            ? "border-[#F05032] shadow-[0_0_0_4px_rgba(240,80,50,0.10)]"
            : isMerge
              ? "border-gray-950"
              : isRoot
                ? "border-gray-300"
                : "border-gray-400"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${current ? "bg-[#F05032]" : isMerge ? "bg-gray-950" : "bg-gray-400"}`} />
      </span>
    </div>
  );
}

function GitRefPill({ refName }: { refName: string }) {
  const label = refName.replace(/^HEAD ->\s*/, "");
  const isTag = label.startsWith("tag:");
  const isRemote = label.includes("/");
  const tone = isTag
    ? "bg-amber-50 text-amber-700"
    : isRemote
      ? "bg-sky-50 text-sky-700"
      : "bg-white text-gray-500";

  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function GitPanelFocusButton({ focused, onClick }: { focused: boolean; onClick: () => void }) {
  const label = focused ? "Show all Git panels" : "Focus this panel";
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="grid h-10 w-10 place-items-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:text-black"
      >
        <Icon name={focused ? "fa-compress" : "fa-expand"} />
      </button>
      <ButtonTooltip text={label} />
    </span>
  );
}

function GitButton({
  label,
  icon,
  tooltip,
  primary,
  danger,
  disabled,
  onClick
}: {
  label: string;
  icon?: string;
  tooltip?: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tone = primary
    ? "border-black bg-black text-white hover:bg-gray-800"
    : danger
      ? "border-red-700 bg-red-700 text-white hover:bg-red-800"
      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-black";
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={tooltip || label}
        title={tooltip || label}
        className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-100 disabled:text-gray-400 ${tone}`}
      >
        {icon ? <Icon name={icon} /> : null}
        {label}
      </button>
      <ButtonTooltip text={tooltip || label} />
    </span>
  );
}

function GitIconButton({
  label,
  icon,
  tooltip,
  danger,
  disabled,
  onClick
}: {
  label: string;
  icon: string;
  tooltip?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`grid h-8 w-8 place-items-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
          danger ? "text-red-500 hover:bg-red-50 hover:text-red-700" : "text-gray-400 hover:bg-white hover:text-black"
        }`}
        aria-label={tooltip || label}
        title={tooltip || label}
      >
        <Icon name={icon} />
      </button>
      <ButtonTooltip text={tooltip || label} />
    </span>
  );
}

function ButtonTooltip({ text }: { text: string }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-30 hidden max-w-64 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-xl shadow-black/15 group-hover:block group-focus-within:block">
      {text}
    </span>
  );
}

function gitHistoryActionTitle(kind: "checkout" | "branch" | "revert" | "reset") {
  if (kind === "checkout") return "Checkout this commit";
  if (kind === "branch") return "Create a branch from this commit";
  if (kind === "revert") return "Revert this commit";
  return "Hard reset to this commit";
}

function GitDiffContent({ git, compact }: { git: GitWorkspaceStatus; compact?: boolean }) {
  if (!git.available || !git.initialized) {
    return <p className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-6 text-gray-600">{git.message || "Git status is unavailable."}</p>;
  }
  if (git.clean) {
    return <p className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-6 text-gray-600">No uncommitted workspace changes.</p>;
  }
  return (
    <div className="mt-5 grid gap-4">
      {git.files.map((file) => (
        <details key={file.path} className="rounded-[1.25rem] border border-gray-200 bg-white p-3" open={!compact && git.files.length <= 3}>
          <summary className="cursor-pointer text-sm font-semibold">
            <span className="mr-2 rounded-full bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-600">{file.status}</span>
            <span className="font-mono text-xs">{file.path}</span>
          </summary>
          <pre className="thin-scrollbar mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-[1rem] bg-black p-3 text-xs leading-6 text-gray-100">
            {file.diff || "No textual diff available."}
          </pre>
        </details>
      ))}
    </div>
  );
}

function RunsModal({ root, runs, onClose }: { root: TerraformRoot | null; runs: SandboxRun[]; onClose: () => void }) {
  const rootRuns = root
    ? runs
        .filter((run) => run.rootPath === root.path || (!run.rootPath && run.planId === root.planId))
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];

  return (
    <Modal title="Run history" description="Terraform sandbox runs for the selected root." icon="fa-clock-rotate-left" size="xl" onClose={onClose}>
      {root ? (
        <div className="grid gap-4">
          <div className="rounded-[1.5rem] bg-[#f7f7f4] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Terraform root</p>
            <p className="mt-2 truncate font-mono text-sm text-gray-800">{root.path}</p>
          </div>
          {rootRuns.length ? (
            <div className="grid gap-3">
              {rootRuns.map((run) => (
                <details key={run.id} className="rounded-[1.25rem] border border-gray-200 bg-white p-4" open={run === rootRuns[0]}>
                  <summary className="cursor-pointer">
                    <div className="inline-flex w-full flex-wrap items-center justify-between gap-3 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${runStatusTone(run.status)}`}>{run.status}</span>
                        <span className="text-sm font-semibold text-gray-900">{run.mode.replace("terraform-", "Terraform ")}</span>
                        <span className="text-xs text-gray-500">{new Date(run.createdAt).toLocaleString()}</span>
                      </div>
                      {run.planSummary ? (
                        <span className="text-xs font-medium text-gray-500">
                          +{run.planSummary.adds} ~{run.planSummary.changes} -{run.planSummary.destroys} replace {run.planSummary.replacements}
                        </span>
                      ) : null}
                    </div>
                  </summary>
                  {run.planSummary ? <PlanSummaryPanel summary={run.planSummary} /> : null}
                  {run.output ? (
                    <pre className="thin-scrollbar mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-[1rem] bg-black p-3 text-xs leading-6 text-gray-100">
                      {run.output}
                    </pre>
                  ) : null}
                </details>
              ))}
            </div>
          ) : (
            <p className="rounded-[1.5rem] bg-gray-50 p-4 text-sm text-gray-600">No sandbox runs have targeted this root yet.</p>
          )}
        </div>
      ) : (
        <p className="rounded-[1.5rem] bg-gray-50 p-4 text-sm text-gray-600">No Terraform root is selected.</p>
      )}
    </Modal>
  );
}

function VariablesModal({
  root,
  values,
  saving,
  onChange,
  onClose,
  onSave
}: {
  root: TerraformRoot | null;
  values: Record<string, string>;
  saving: boolean;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const variables = root?.variables || [];

  return (
    <Modal title="Terraform inputs" description="Provide root variables that Terraform needs before it can plan or apply." icon="fa-keyboard" size="xl" onClose={onClose}>
      {root ? (
        <div className="grid gap-5">
          <div className="rounded-[1.5rem] bg-[#f7f7f4] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Terraform root</p>
            <p className="mt-2 truncate font-mono text-sm text-gray-800">{root.path}</p>
          </div>
          {variables.length ? (
            <div className="grid gap-4">
              {variables.map((variable) => (
                <VariableField key={variable.name} variable={variable} value={values[variable.name] || ""} onChange={onChange} />
              ))}
            </div>
          ) : (
            <p className="rounded-[1.5rem] bg-gray-50 p-4 text-sm text-gray-600">This root does not declare Terraform variables.</p>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
              Cancel
            </button>
            <button type="button" onClick={onSave} disabled={saving || !variables.length} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
              <Icon name={saving ? "fa-circle-notch fa-spin" : "fa-floppy-disk"} />
              Save inputs
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-[1.5rem] bg-gray-50 p-4 text-sm text-gray-600">No Terraform root is selected.</p>
      )}
    </Modal>
  );
}

function WorkspaceProfileSetupModal({
  workspaceMode,
  provider,
  providerConnection,
  git,
  loading,
  onClose,
  onComplete
}: {
  workspaceMode: WorkspaceMode;
  provider: CloudProvider;
  providerConnection?: Omit<ProviderConnection, "secrets">;
  git: GitWorkspaceStatus;
  loading: boolean;
  onClose: () => void;
  onComplete: (input: {
    cloudProvider?: CloudProvider;
    cloudDetails?: Record<string, string>;
    gitProvider: GitProvider;
    repositoryMode: GitRepositoryMode;
    repositoryUrl: string;
    repositoryName: string;
    repositoryOwner: string;
    repositoryBranch: string;
    gitAuthMethod: GitAuthMethod;
    gitUsername: string;
    gitToken: string;
    gitSshPrivateKey: string;
    nextjsAppName: string;
    nextjsHeroText: string;
  }) => Promise<void>;
}) {
  const setupSteps = workspaceMode === "infra" ? ["Cloud", "Source", "Repository", "Access", "Confirm"] : ["Source", "Repository", "Access", "Confirm"];
  const [step, setStep] = useState(0);
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>(provider === "aws" ? "aws" : "azure");
  const [cloudDetails, setCloudDetails] = useState<Record<string, string>>(() => profileCredentialDefaults(providerConnection?.provider || provider, providerConnection));
  const [credentialTesting, setCredentialTesting] = useState(false);
  const [credentialTest, setCredentialTest] = useState<{ status: string; label: string; detail: string } | null>(providerConnection ? {
    status: "configured",
    label: `${cloudProviderLabel(providerConnection.provider)} credentials saved`,
    detail: "Saved credentials are available for Terraform sandbox runs."
  } : null);
  const [gitProvider, setGitProvider] = useState<GitProvider>("github");
  const [repositoryMode, setRepositoryMode] = useState<GitRepositoryMode>(workspaceMode === "web" ? "nextjs" : "dstack");
  const [repositoryUrl, setRepositoryUrl] = useState(git.remoteUrl || "");
  const [repositoryName, setRepositoryName] = useState(workspaceMode === "web" ? "a2w-web-app" : "a2w-infrastructure");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState(git.branch && git.branch !== "detached" ? git.branch : "main");
  const [nextjsAppName, setNextjsAppName] = useState("a2w-web-app");
  const [nextjsHeroText, setNextjsHeroText] = useState("Build from here.");
  const [gitAuthMethod, setGitAuthMethod] = useState<GitAuthMethod>("none");
  const [gitUsername, setGitUsername] = useState("");
  const [gitToken, setGitToken] = useState("");
  const [gitSshPrivateKey, setGitSshPrivateKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = workspaceMode === "web" ? "Web" : "Infra";
  const accent = workspaceMode === "web" ? "text-[#087ea4]" : "text-[#5c4ee5]";
  const icon = workspaceMode === "web" ? "fa-brands fa-react" : "fa-diagram-project";
  const cloudFields = credentialFields(cloudProvider);
  const sourceStep = workspaceMode === "infra" ? 1 : 0;
  const repositoryStep = sourceStep + 1;
  const accessStep = sourceStep + 2;
  const confirmStep = sourceStep + 3;

  function setCloudProviderAndReset(nextProvider: CloudProvider) {
    setCloudProvider(nextProvider);
    setCloudDetails(profileCredentialDefaults(nextProvider));
    setCredentialTest(null);
    setError(null);
  }

  function setCloudDetail(name: string, value: string) {
    setCloudDetails((current) => ({ ...current, [name]: value }));
    setCredentialTest(null);
    setError(null);
  }

  function validateCloud() {
    if (workspaceMode !== "infra") return true;
    const missing = cloudFields.filter((field) => !String(cloudDetails[field.name] || "").trim() && !(field.type === "password" && providerConnection?.provider === cloudProvider)).map((field) => field.label);
    if (missing.length) {
      setError(`Enter ${missing.join(", ")}.`);
      return false;
    }
    if (cloudProvider === "azure" && credentialTest?.status !== "connected" && providerConnection?.provider !== cloudProvider) {
      setError("Test Azure credentials before continuing.");
      return false;
    }
    if (cloudProvider === "aws" && !credentialTest) {
      setError("Check AWS credential shape before continuing.");
      return false;
    }
    return true;
  }

  async function testCloudCredentials() {
    setCredentialTesting(true);
    setCredentialTest(null);
    setError(null);
    try {
      const response = await fetch("/api/provider-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: cloudProvider,
          ...cloudDetails
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || "Credential check failed.");
      setCredentialTest(data.result);
    } catch (nextError) {
      setCredentialTest({
        status: "failed",
        label: "Credential check failed",
        detail: nextError instanceof Error ? nextError.message : String(nextError)
      });
    } finally {
      setCredentialTesting(false);
    }
  }

  function validate(final = false) {
    setError(null);
    if (repositoryMode === "existing" && !repositoryUrl.trim()) {
      setError("Enter the remote repository URL.");
      return;
    }
    if ((repositoryMode === "dstack" || repositoryMode === "nextjs") && !repositoryName.trim()) {
      setError("Enter the repository name.");
      return;
    }
    if (repositoryMode === "nextjs" && !nextjsAppName.trim()) {
      setError("Enter the Next.js package name.");
      return;
    }
    if (final && (repositoryMode === "dstack" || repositoryMode === "nextjs") && !repositoryUrl.trim() && !(gitProvider === "github" && gitAuthMethod === "token")) {
      setError("Enter an empty remote repository URL you already created, or use a GitHub HTTPS token so A2W can create the repository.");
      return;
    }
    if (gitAuthMethod === "token" && !gitToken.trim()) {
      setError("Enter an HTTPS token or choose no auth.");
      return;
    }
    if (gitAuthMethod === "ssh" && !gitSshPrivateKey.trim()) {
      setError("Paste the SSH private key or choose no auth.");
      return;
    }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workspaceMode === "infra" && step === 0 && !validateCloud()) return;
    if (step < setupSteps.length - 1) {
      if ((workspaceMode === "infra" ? step > 1 : step > 0) && !validate(false)) return;
      setStep((current) => Math.min(current + 1, setupSteps.length - 1));
      return;
    }
    if (!validate(true)) return;
    try {
      await onComplete({
        ...(workspaceMode === "infra" ? { cloudProvider, cloudDetails } : {}),
        gitProvider,
        repositoryMode,
        repositoryUrl,
        repositoryName,
        repositoryOwner,
        repositoryBranch,
        gitAuthMethod,
        gitUsername,
        gitToken,
        gitSshPrivateKey,
        nextjsAppName,
        nextjsHeroText
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  return (
    <Modal
      title={`Set up ${label} repository`}
      description={`Connect the Git repository that ${label} chats should work against. Current Git values are prefilled when available.`}
      icon={workspaceMode === "web" ? "fa-window-maximize" : "fa-diagram-project"}
      size="xl"
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid h-full min-h-[520px] grid-cols-12 gap-3 py-4">
        <aside className="col-span-12 rounded-[1.5rem] border border-gray-200 bg-[#f7f7f4] p-4 md:col-span-3">
          <div className="flex items-center gap-3">
            <span className={`grid h-10 w-10 place-items-center rounded-2xl bg-white text-lg shadow-sm shadow-black/5 ${accent}`}>
              <Icon name={icon} />
            </span>
            <div>
              <p className="text-sm font-semibold">{label} workspace</p>
              <p className="text-xs text-gray-500">Repository setup</p>
            </div>
          </div>
          <div className="mt-6 grid gap-1">
            {setupSteps.map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => setStep(index)}
                className="flex h-10 items-center gap-3 rounded-xl px-2 text-left text-sm transition hover:bg-white/70"
              >
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                  index <= step ? "bg-black text-white" : "bg-white text-gray-400"
                }`}>
                  {index + 1}
                </span>
                <span className={index === step ? "font-semibold text-black" : "text-gray-500"}>{item}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="col-span-12 flex min-h-0 flex-col rounded-[1.5rem] border border-gray-200 bg-white p-5 md:col-span-9">
          <div className="min-h-0 flex-1">
            {workspaceMode === "infra" && step === 0 ? (
              <div className="grid gap-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Cloud setup</p>
                  <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Connect the Infra cloud account.</h3>
                  <p className="mt-3 text-sm leading-6 text-gray-500">
                    Pick the provider and enter the credentials Terraform should use from the sandbox.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <CloudSetupChoice provider="azure" active={cloudProvider === "azure"} onClick={() => setCloudProviderAndReset("azure")} />
                  <CloudSetupChoice provider="aws" active={cloudProvider === "aws"} onClick={() => setCloudProviderAndReset("aws")} />
                </div>

                <div className="grid gap-4 rounded-[1.5rem] border border-gray-200 bg-[#f7f7f4] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-sm shadow-black/5">
                        <CloudProviderLogo provider={cloudProvider} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{cloudProviderLabel(cloudProvider)} credentials</p>
                        <p className="text-xs text-gray-500">Saved before repository setup finishes.</p>
                      </div>
                    </div>
                    {credentialTest ? (
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        credentialTest.status === "connected" ? "bg-emerald-50 text-emerald-700" : credentialTest.status === "configured" ? "bg-gray-100 text-gray-600" : "bg-red-50 text-red-700"
                      }`}>
                        {credentialTest.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {cloudFields.map((field) => (
                      <label key={field.name} className={field.wide ? "grid gap-2 text-sm font-medium text-gray-700 sm:col-span-2" : "grid gap-2 text-sm font-medium text-gray-700"}>
                        {field.label}
                        <input
                          type={field.type || "text"}
                          value={cloudDetails[field.name] || ""}
                          onChange={(event) => setCloudDetail(field.name, event.target.value)}
                          placeholder={field.type === "password" && providerConnection?.provider === cloudProvider ? "Leave blank to keep existing secret" : field.placeholder || field.fallback}
                          className="h-11 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                        />
                      </label>
                    ))}
                  </div>

                  {credentialTest ? (
                    <p className={`rounded-[1.25rem] p-3 text-xs leading-5 ${
                      credentialTest.status === "connected" ? "bg-emerald-50 text-emerald-800" : credentialTest.status === "configured" ? "bg-white text-gray-600" : "bg-red-50 text-red-700"
                    }`}>
                      {credentialTest.detail}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={testCloudCredentials}
                    disabled={credentialTesting}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300 sm:w-fit"
                  >
                    <Icon name={credentialTesting ? "fa-circle-notch fa-spin" : "fa-shield-halved"} />
                    {credentialTesting ? "Checking credentials" : cloudProvider === "azure" ? "Test Azure credentials" : "Check AWS credentials"}
                  </button>
                </div>
              </div>
            ) : null}

            {step === sourceStep ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Repository source</p>
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Choose how {label} starts.</h3>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <ProfileChoiceCard
                    active={repositoryMode === (workspaceMode === "web" ? "nextjs" : "dstack")}
                    icon={workspaceMode === "web" ? "fa-brands fa-react" : "fa-seedling"}
                    title={workspaceMode === "web" ? "Next.js template" : "A2W best-practice repo"}
                    body={workspaceMode === "web" ? "Generate a small TypeScript Next.js app and push it to a new remote." : "Import the DStack Terraform layout into your own remote."}
                    variant={workspaceMode === "web" ? "react" : "default"}
                    onClick={() => setRepositoryMode(workspaceMode === "web" ? "nextjs" : "dstack")}
                  />
                  <ProfileChoiceCard
                    active={repositoryMode === "existing"}
                    icon="fa-brands fa-git-alt"
                    title="Use my repository"
                    body={workspaceMode === "web" ? "Clone an existing application repository." : "Clone an existing Terraform repository."}
                    variant="git"
                    onClick={() => setRepositoryMode("existing")}
                  />
                </div>
              </div>
            ) : null}

            {step === repositoryStep ? (
              <div className="grid gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Repository details</p>
                  <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Point A2W at Git.</h3>
                </div>
                <div className="grid gap-2 sm:grid-cols-5">
                  {(["github", "gitlab", "bitbucket", "azure-devops", "generic"] as GitProvider[]).map((provider) => (
                    <GitProviderChoice
                      key={provider}
                      provider={provider}
                      active={gitProvider === provider}
                      onClick={() => setGitProvider(provider)}
                    />
                  ))}
                </div>
                {(repositoryMode === "dstack" || repositoryMode === "nextjs") ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium text-gray-700">
                      Repository name
                      <input value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} placeholder={workspaceMode === "web" ? "a2w-web-app" : "a2w-infrastructure"} className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black" />
                    </label>
                    <label className="grid gap-2 text-sm font-medium text-gray-700">
                      Organization
                      <input value={repositoryOwner} onChange={(event) => setRepositoryOwner(event.target.value)} placeholder="optional" className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black" />
                    </label>
                  </div>
                ) : null}
                <label className="grid gap-2 text-sm font-medium text-gray-700">
                  Remote URL
                  <input
                    value={repositoryUrl}
                    onChange={(event) => setRepositoryUrl(event.target.value)}
                    placeholder={workspaceMode === "web" ? "git@github.com:company/web-app.git" : "git@github.com:company/infra.git"}
                    className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black"
                  />
                  <span className="text-xs font-normal leading-5 text-gray-500">
                    {repositoryMode === "nextjs" ? "Use an empty remote, or leave this blank with a GitHub token so A2W can create it." : "SSH URLs work best for private repositories in self-hosted deployments."}
                  </span>
                </label>
                {repositoryMode === "nextjs" ? (
                  <div className="grid gap-3 rounded-[1.5rem] border border-[#61dafb]/35 bg-[#f1fbff] p-4">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#087ea4] shadow-sm shadow-black/5">
                        <Icon name="fa-brands fa-react" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-[#052f3f]">Next.js starter template</p>
                        <p className="text-xs text-[#087ea4]/75">These values are written into the generated app.</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium text-[#052f3f]">
                        Package name
                        <input value={nextjsAppName} onChange={(event) => setNextjsAppName(event.target.value)} placeholder="a2w-web-app" className="h-11 rounded-2xl border border-[#61dafb]/45 bg-white px-4 text-black outline-none transition focus:border-[#087ea4]" />
                      </label>
                      <label className="grid gap-2 text-sm font-medium text-[#052f3f]">
                        Starter headline
                        <input value={nextjsHeroText} onChange={(event) => setNextjsHeroText(event.target.value)} placeholder="Build from here." className="h-11 rounded-2xl border border-[#61dafb]/45 bg-white px-4 text-black outline-none transition focus:border-[#087ea4]" />
                      </label>
                    </div>
                  </div>
                ) : null}
                <label className="grid gap-2 text-sm font-medium text-gray-700">
                  Branch
                  <input value={repositoryBranch} onChange={(event) => setRepositoryBranch(event.target.value)} placeholder="main" className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black" />
                </label>
              </div>
            ) : null}

            {step === accessStep ? (
              <div className="grid gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Git access</p>
                  <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Choose clone credentials.</h3>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["none", "ssh", "token"] as GitAuthMethod[]).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setGitAuthMethod(method)}
                      className={`h-11 rounded-2xl border text-sm font-semibold transition ${
                        gitAuthMethod === method ? "border-black bg-black text-white" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {method === "none" ? "Host auth" : method === "ssh" ? "SSH key" : "HTTPS token"}
                    </button>
                  ))}
                </div>
                {gitAuthMethod === "none" ? (
                  <p className="rounded-[1.25rem] bg-gray-50 p-4 text-sm leading-6 text-gray-600">
                    Use this when the remote is public or this self-hosted machine already has Git credentials configured.
                  </p>
                ) : null}
                {gitAuthMethod === "token" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input value={gitUsername} onChange={(event) => setGitUsername(event.target.value)} placeholder="Username" className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black" />
                    <input value={gitToken} onChange={(event) => setGitToken(event.target.value)} placeholder="HTTPS token" type="password" className="h-11 rounded-2xl border border-gray-200 px-4 outline-none focus:border-black" />
                  </div>
                ) : null}
                {gitAuthMethod === "ssh" ? (
                  <textarea
                    value={gitSshPrivateKey}
                    onChange={(event) => setGitSshPrivateKey(event.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={7}
                    className="thin-scrollbar resize-none rounded-2xl border border-gray-200 p-4 font-mono text-xs outline-none focus:border-black"
                  />
                ) : null}
              </div>
            ) : null}

            {step === confirmStep ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Confirm</p>
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Run repository setup.</h3>
                <div className="mt-5 grid gap-2 rounded-[1.5rem] border border-gray-200 p-4 text-sm">
                  <SettingLine label="Mode" value={label} />
                  {workspaceMode === "infra" ? <SettingLine label="Cloud" value={`${cloudProviderLabel(cloudProvider)} / ${cloudDetails.region || "default region"}`} /> : null}
                  <SettingLine label="Source" value={repositoryMode === "nextjs" ? "Next.js template" : repositoryMode === "dstack" ? "A2W best practices" : "Existing repository"} />
                  {repositoryMode === "nextjs" ? <SettingLine label="Template" value={`${nextjsAppName || "a2w-web-app"} / ${nextjsHeroText || "Build from here."}`} /> : null}
                  <SettingLine label="Remote" value={repositoryUrl || `${gitProviderLabel(gitProvider)} token repository creation`} />
                  <SettingLine label="Branch" value={repositoryBranch || "provider default"} />
                  <SettingLine label="Auth" value={gitAuthMethod === "none" ? "Host/public auth" : gitAuthMethod === "ssh" ? "SSH key" : "HTTPS token"} />
                </div>
              </div>
            ) : null}
          </div>

          {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:justify-between">
            <button type="button" onClick={onClose} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
              Cancel
            </button>
            <div className="flex gap-2">
              {step > 0 ? (
                <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
                  Back
                </button>
              ) : null}
              <button type="submit" disabled={loading} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
                <Icon name={loading ? "fa-circle-notch fa-spin" : step === setupSteps.length - 1 ? "fa-check" : "fa-arrow-right"} />
                {step === setupSteps.length - 1 ? "Finish setup" : "Continue"}
              </button>
            </div>
          </div>
        </section>
      </form>
    </Modal>
  );
}

function ProfileChoiceCard({
  active,
  icon,
  title,
  body,
  variant = "default",
  onClick
}: {
  active: boolean;
  icon: string;
  title: string;
  body: string;
  variant?: "default" | "react" | "git";
  onClick: () => void;
}) {
  const activeStyle = variant === "react"
    ? "border-[#61dafb] bg-[#61dafb] text-[#052f3f] shadow-[#61dafb]/25 ring-2 ring-[#61dafb] ring-offset-2 ring-offset-white"
    : variant === "git"
      ? "border-[#f05032] bg-[#f05032] text-white shadow-[#f05032]/25 ring-2 ring-[#f05032] ring-offset-2 ring-offset-white"
      : "border-black bg-black text-white shadow-black/10";
  const idleStyle = variant === "react"
    ? "border-[#61dafb]/35 bg-[#f1fbff] text-[#052f3f] shadow-[#61dafb]/10 hover:border-[#61dafb]"
    : variant === "git"
      ? "border-[#f05032]/25 bg-[#fff6f2] text-[#3b160f] shadow-[#f05032]/10 hover:border-[#f05032]/60"
      : "border-gray-200 bg-[#f7f7f4] text-gray-700 hover:border-gray-300";
  const iconStyle = active
    ? variant === "git"
      ? "bg-white text-[#f05032]"
      : variant === "react"
        ? "bg-white text-[#087ea4]"
        : "bg-white text-black"
    : variant === "git"
      ? "bg-white text-[#f05032]"
      : variant === "react"
        ? "bg-white text-[#087ea4]"
        : "bg-white text-gray-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-[1.5rem] border p-5 text-left shadow-xl transition hover:-translate-y-0.5 ${
        active ? activeStyle : idleStyle
      }`}
    >
      <span className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/20" />
      <span className={`relative grid h-11 w-11 place-items-center rounded-2xl shadow-sm shadow-black/5 ${iconStyle}`}>
        <Icon name={icon} />
      </span>
      <p className="relative mt-4 text-base font-semibold">{title}</p>
      <p className={`relative mt-2 text-sm leading-6 ${
        active ? variant === "react" ? "text-[#052f3f]/75" : "text-white/75" : variant === "react" ? "text-[#087ea4]/75" : variant === "git" ? "text-[#9a3412]/75" : "text-gray-500"
      }`}>{body}</p>
    </button>
  );
}

function CloudSetupChoice({
  provider,
  active,
  onClick
}: {
  provider: "aws" | "azure";
  active: boolean;
  onClick: () => void;
}) {
  const azure = provider === "azure";
  const activeStyle = azure
    ? "border-[#0078d4] bg-[#0078d4] text-white shadow-[#0078d4]/20"
    : "border-[#232f3e] bg-[#232f3e] text-white shadow-[#232f3e]/20";
  const idleStyle = azure
    ? "border-[#0078d4]/20 bg-[#f2f8ff] text-[#003a63] shadow-[#0078d4]/10 hover:border-[#0078d4]/45"
    : "border-[#232f3e]/20 bg-[#fff8ed] text-[#2c1b00] shadow-[#ff9900]/10 hover:border-[#ff9900]/45";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-[1.5rem] border p-4 text-left shadow-xl transition hover:-translate-y-0.5 ${active ? activeStyle : idleStyle}`}
    >
      <span className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/15" />
      <span className="relative grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-sm shadow-black/5">
        <CloudProviderLogo provider={provider} />
      </span>
      <p className="relative mt-4 text-base font-semibold">{cloudProviderLabel(provider)}</p>
      <p className={`relative mt-1 text-xs leading-5 ${active ? "text-white/75" : azure ? "text-[#0078d4]/75" : "text-[#7a4a00]/75"}`}>
        {azure ? "Use an Azure app registration and subscription." : "Use an IAM role and external ID."}
      </p>
      <span className={`relative mt-4 inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ${active ? "bg-white text-black" : "bg-white/70 text-gray-600"}`}>
        {active ? "Selected" : "Select"}
      </span>
    </button>
  );
}

function profileCredentialDefaults(provider: CloudProvider, connection?: Omit<ProviderConnection, "secrets">) {
  return Object.fromEntries(credentialFields(provider).map((field) => [field.name, connection?.provider === provider ? connection.details[field.name] || field.fallback : field.fallback]));
}

function gitProviderLabel(provider: GitProvider) {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  if (provider === "bitbucket") return "Bitbucket";
  if (provider === "azure-devops") return "Azure DevOps";
  return "Other";
}

function GitProviderChoice({
  provider,
  active,
  onClick
}: {
  provider: GitProvider;
  active: boolean;
  onClick: () => void;
}) {
  const meta = gitProviderChoiceMeta(provider);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative min-h-24 overflow-hidden rounded-[1.25rem] border p-3 text-left shadow-lg transition hover:-translate-y-0.5 ${
        active ? meta.activeCard : meta.idleCard
      }`}
    >
      <span className={`pointer-events-none absolute -right-7 -top-7 h-20 w-20 rounded-full ${active ? "bg-white/15" : meta.glow}`} />
      <span className={`relative grid h-8 w-8 place-items-center rounded-xl text-base shadow-sm shadow-black/5 ${active ? meta.activeIcon : meta.idleIcon}`}>
        <Icon name={meta.icon} />
      </span>
      <span className="relative mt-3 block truncate text-xs font-semibold">{meta.label}</span>
      <span className={`relative mt-2 inline-flex h-6 items-center rounded-full px-2 text-[10px] font-semibold ${active ? meta.activeBadge : meta.idleBadge}`}>
        {active ? "Selected" : "Select"}
      </span>
    </button>
  );
}

function gitProviderChoiceMeta(provider: GitProvider) {
  if (provider === "github") {
    return {
      label: "GitHub",
      icon: "fa-brands fa-github",
      activeCard: "border-black bg-black text-white shadow-black/15",
      activeIcon: "bg-white text-black",
      activeBadge: "bg-white text-black",
      idleCard: "border-gray-200 bg-white text-gray-700 shadow-black/5 hover:border-black/30",
      idleIcon: "bg-gray-50 text-black",
      idleBadge: "bg-gray-100 text-gray-500",
      glow: "bg-black/10"
    };
  }
  if (provider === "gitlab") {
    return {
      label: "GitLab",
      icon: "fa-brands fa-gitlab",
      activeCard: "border-[#fc6d26] bg-[#fc6d26] text-white shadow-[#fc6d26]/20",
      activeIcon: "bg-white text-[#fc6d26]",
      activeBadge: "bg-white text-[#fc6d26]",
      idleCard: "border-[#fc6d26]/20 bg-white text-gray-700 shadow-[#fc6d26]/10 hover:border-[#fc6d26]/45",
      idleIcon: "bg-[#fc6d26]/10 text-[#fc6d26]",
      idleBadge: "bg-[#fc6d26]/10 text-[#fc6d26]",
      glow: "bg-[#fc6d26]/14"
    };
  }
  if (provider === "bitbucket") {
    return {
      label: "Bitbucket",
      icon: "fa-brands fa-bitbucket",
      activeCard: "border-[#0052cc] bg-[#0052cc] text-white shadow-[#0052cc]/20",
      activeIcon: "bg-white text-[#0052cc]",
      activeBadge: "bg-white text-[#0052cc]",
      idleCard: "border-[#0052cc]/20 bg-white text-gray-700 shadow-[#0052cc]/10 hover:border-[#0052cc]/45",
      idleIcon: "bg-[#0052cc]/10 text-[#0052cc]",
      idleBadge: "bg-[#0052cc]/10 text-[#0052cc]",
      glow: "bg-[#0052cc]/14"
    };
  }
  if (provider === "azure-devops") {
    return {
      label: "Azure",
      icon: "fa-brands fa-microsoft",
      activeCard: "border-[#0078d4] bg-[#0078d4] text-white shadow-[#0078d4]/20",
      activeIcon: "bg-white text-[#0078d4]",
      activeBadge: "bg-white text-[#0078d4]",
      idleCard: "border-[#0078d4]/20 bg-white text-gray-700 shadow-[#0078d4]/10 hover:border-[#0078d4]/45",
      idleIcon: "bg-[#0078d4]/10 text-[#0078d4]",
      idleBadge: "bg-[#0078d4]/10 text-[#0078d4]",
      glow: "bg-[#0078d4]/14"
    };
  }
  return {
    label: "Other",
    icon: "fa-code-branch",
    activeCard: "border-gray-800 bg-gray-800 text-white shadow-black/15",
    activeIcon: "bg-white text-gray-800",
    activeBadge: "bg-white text-gray-800",
    idleCard: "border-gray-200 bg-white text-gray-700 shadow-black/5 hover:border-gray-400",
    idleIcon: "bg-gray-100 text-gray-700",
    idleBadge: "bg-gray-100 text-gray-500",
    glow: "bg-gray-900/8"
  };
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-gray-900" title={value}>{value || "-"}</span>
    </div>
  );
}

function VariableField({
  variable,
  value,
  onChange
}: {
  variable: TerraformVariableDefinition;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const configured = variable.value === "configured";
  return (
    <label className={`grid gap-2 rounded-[1.25rem] border p-4 text-sm ${variable.required && !variable.value ? "border-amber-200 bg-amber-50/40" : "border-gray-200 bg-white"}`}>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-gray-900">{variable.name}</span>
        <span className="flex items-center gap-2">
          {variable.required ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">required</span> : null}
          {configured ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">configured</span> : null}
        </span>
      </span>
      {variable.description ? <span className="text-sm leading-6 text-gray-600">{variable.description}</span> : null}
      <input
        type={variable.sensitive ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(variable.name, event.target.value)}
        placeholder={configured ? "Leave blank to keep current value" : variable.type || "value"}
        className="h-11 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
      />
      {variable.name === "admin_ssh_public_key" ? (
        <span className="text-xs leading-5 text-gray-500">Paste an OpenSSH public key such as <code>ssh-ed25519 AAAA... name@example</code>. Do not paste a private key.</span>
      ) : null}
    </label>
  );
}

function PlanSummaryPanel({ summary }: { summary: NonNullable<SandboxRun["planSummary"]> }) {
  return (
    <div className="mt-4 rounded-[1.25rem] bg-[#f7f7f4] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Create" value={`${summary.adds}`} />
        <MiniStat label="Update" value={`${summary.changes}`} />
        <MiniStat label="Destroy" value={`${summary.destroys}`} />
        <MiniStat label="Replace" value={`${summary.replacements}`} />
      </div>
      {summary.resources.length ? (
        <div className="mt-4 grid gap-2">
          {summary.resources.slice(0, 12).map((resource) => (
            <div key={resource.address} className="flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2 text-xs">
              <span className="font-mono text-gray-700">{resource.address}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">{resource.actions.join("+")}</span>
            </div>
          ))}
        </div>
      ) : null}
      {summary.dangerous ? <p className="mt-4 rounded-2xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">This plan includes delete or replacement actions.</p> : null}
    </div>
  );
}

function runStatusTone(status: SandboxRun["status"]) {
  if (status === "succeeded") return "bg-emerald-50 text-emerald-700";
  if (status === "failed" || status === "cancelled") return "bg-red-50 text-red-700";
  if (status === "running") return "bg-amber-50 text-amber-700";
  return "bg-gray-100 text-gray-600";
}

function CredentialsModal({
  provider,
  connection,
  onSaved,
  onClose
}: {
  provider: CloudProvider;
  connection?: Omit<ProviderConnection, "secrets">;
  onSaved: (connection: Omit<ProviderConnection, "secrets">) => void;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ status: string; label: string; detail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fields = credentialFields(provider);

  async function saveCredentials(options: { quiet?: boolean } = {}) {
    if (!formRef.current) return null;
    setSaving(true);
    setError(null);
    if (!options.quiet) setResult(null);

    try {
      const response = await fetch("/api/provider-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          ...Object.fromEntries(new FormData(formRef.current).entries())
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || "Could not save credentials.");
      onSaved(data.connection);
      if (!options.quiet) {
        setResult({
          status: "configured",
          label: `${cloudProviderLabel(provider)} credentials saved`,
          detail: "The saved values will be injected into Terraform sandbox runs when needed."
        });
      }
      return data.connection as Omit<ProviderConnection, "secrets">;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await saveCredentials();
    if (saved) onClose();
  }

  async function checkCredentials() {
    setChecking(true);
    setResult(null);
    const saved = await saveCredentials({ quiet: true });
    if (!saved) {
      setChecking(false);
      return;
    }

    try {
      const response = await fetch("/api/provider-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Credential check failed.");
      setResult(data.result);
    } catch (err) {
      setResult({
        status: "failed",
        label: "Credential check failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal title="Provider credentials" description="Configure and verify the cloud credentials used by Terraform runs." icon="fa-key" onClose={onClose}>
      <form ref={formRef} onSubmit={submitCredentials} className="grid gap-5">
        <div className="flex items-center justify-between gap-3 rounded-[1.5rem] bg-[#f7f7f4] p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white shadow-sm shadow-black/5">
              <CloudProviderLogo provider={provider} />
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{cloudProviderLabel(provider)}</p>
              <p className="text-xs text-gray-500">
                {connection ? `Status: ${connection.status.replace("_", " ")}` : "No credentials saved yet"}
              </p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connection ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
            {connection ? "configured" : "not configured"}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.name} className={field.wide ? "grid gap-2 text-sm font-medium text-gray-700 sm:col-span-2" : "grid gap-2 text-sm font-medium text-gray-700"}>
              {field.label}
              <input
                name={field.name}
                type={field.type || "text"}
                defaultValue={field.type === "password" ? "" : connection?.details[field.name] || field.fallback}
                placeholder={field.type === "password" && connection ? "Leave blank to keep existing secret" : field.placeholder || field.fallback}
                className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
              />
            </label>
          ))}
        </div>

        <p className="rounded-[1.25rem] bg-gray-50 p-4 text-xs leading-6 text-gray-500">
          Client secrets and private credentials are stored server-side only and are not rendered back into the browser. For Azure, the check uses the Azure OAuth and Resource Manager APIs.
        </p>

        {result ? (
          <div className={`rounded-[1.5rem] p-4 text-sm leading-6 ${result.status === "connected" ? "bg-emerald-50 text-emerald-800" : result.status === "configured" ? "bg-gray-50 text-gray-700" : "bg-red-50 text-red-700"}`}>
            <p className="font-semibold">{result.label}</p>
            <p className="mt-1">{result.detail}</p>
          </div>
        ) : null}

        {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={saving || checking}
            onClick={checkCredentials}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <Icon name={checking ? "fa-circle-notch fa-spin" : "fa-shield-halved"} />
            {provider === "azure" ? "Save and check Azure API" : "Save and check"}
          </button>
          <button
            type="submit"
            disabled={saving || checking}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300"
          >
            <Icon name={saving ? "fa-circle-notch fa-spin" : "fa-floppy-disk"} />
            Save credentials
          </button>
        </div>
      </form>
    </Modal>
  );
}

type CredentialField = {
  name: string;
  label: string;
  fallback: string;
  placeholder?: string;
  type?: "text" | "password";
  wide?: boolean;
};

function credentialFields(provider: CloudProvider): CredentialField[] {
  if (provider === "aws") {
    return [
      { name: "roleArn", label: "IAM role ARN", fallback: "arn:aws:iam::123456789012:role/a2w-infra-agent", wide: true },
      { name: "externalId", label: "External ID", fallback: "a2w-demo-external-id" },
      { name: "region", label: "Region", fallback: "eu-central-1" }
    ];
  }
  if (provider === "azure") {
    return [
      { name: "tenantId", label: "Tenant ID", fallback: "11111111-1111-4111-8111-111111111111" },
      { name: "subscriptionId", label: "Subscription ID", fallback: "22222222-2222-4222-8222-222222222222" },
      { name: "clientId", label: "Client ID", fallback: "33333333-3333-4333-8333-333333333333" },
      { name: "region", label: "Region", fallback: "westeurope" },
      { name: "clientSecret", label: "Client secret", fallback: "", placeholder: "Enter client secret", type: "password", wide: true }
    ];
  }
  return [
    { name: "projectId", label: "Project ID", fallback: "my-gcp-project" },
    { name: "serviceAccountEmail", label: "Service account email", fallback: "terraform@my-gcp-project.iam.gserviceaccount.com", wide: true },
    { name: "region", label: "Region", fallback: "europe-west4" }
  ];
}

function SandboxModal({
  plan,
  mode,
  loading,
  applyConfirm,
  applyDisabled,
  applyRuntimeEnabled,
  onApplyConfirmChange,
  onClose,
  onRun
}: {
  plan: InfraPlan;
  mode: SandboxMode;
  loading: boolean;
  applyConfirm: string;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
  onApplyConfirmChange: (value: string) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const mutationNotApproved = !plan.status.includes("approved");
  const mutationUnavailable = applyDisabled || !applyRuntimeEnabled || mutationNotApproved;
  const danger = true;
  const expectedConfirmation = mode === "terraform-apply" ? "APPLY" : mode === "terraform-destroy" ? "DESTROY" : "";

  return (
    <Modal
      title={modeLabel(mode)}
      description={modeDescription(mode)}
      icon={mode === "terraform-apply" ? "fa-rocket" : mode === "terraform-destroy" ? "fa-trash" : mode === "terraform-plan" ? "fa-terminal" : "fa-code"}
      danger={danger}
      onClose={onClose}
    >
      <div className="mt-5 rounded-[1.5rem] bg-gray-50 p-5">
        <h3 className="text-xl font-semibold tracking-[-0.03em]">{plan.title}</h3>
        <p className="mt-3 text-sm leading-7 text-gray-600">{plan.summary}</p>
      </div>
      <div className="mt-5 grid gap-4">
        {mutationUnavailable ? (
          <div className="rounded-[1.5rem] bg-red-50 p-4 text-sm leading-7 text-red-800">
            {mutationNotApproved
              ? "Approve the plan before running cloud-changing Terraform actions."
              : applyDisabled
                ? "Terraform apply/destroy is disabled in Settings."
                : "Restart the local server with A2W_ENABLE_TERRAFORM_APPLY=true to allow apply or destroy."}
          </div>
        ) : null}

        <label className="grid gap-2 rounded-[1.5rem] bg-red-50 p-4 text-sm font-medium text-red-900">
          Type {expectedConfirmation} to {mode === "terraform-destroy" ? "destroy Terraform-managed cloud resources" : "create or update cloud resources"}
          <input
            value={applyConfirm}
            onChange={(event) => onApplyConfirmChange(event.target.value)}
            className="h-12 rounded-2xl border border-red-100 bg-white px-4 text-black outline-none transition focus:border-red-700"
            placeholder={expectedConfirmation}
          />
        </label>
      </div>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
          Cancel
        </button>
        <button
          disabled={loading || mutationUnavailable || applyConfirm !== expectedConfirmation}
          type="button"
          onClick={onRun}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-red-700 px-5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:bg-gray-300"
        >
          <Icon name={loading ? "fa-circle-notch fa-spin" : mode === "terraform-apply" ? "fa-rocket" : mode === "terraform-destroy" ? "fa-trash" : "fa-play"} />
          Confirm {mode === "terraform-destroy" ? "destroy" : "apply"}
        </button>
      </div>
    </Modal>
  );
}

function modeLabel(mode: SandboxMode, progressive = false) {
  if (mode === "terraform-fmt") return progressive ? "Formatting Terraform" : "Terraform fmt";
  if (mode === "terraform-plan") return progressive ? "Running Terraform plan" : "Terraform plan";
  if (mode === "terraform-apply") return progressive ? "Applying Terraform" : "Terraform apply";
  if (mode === "terraform-destroy") return progressive ? "Destroying Terraform resources" : "Terraform destroy";
  if (mode === "npm-install") return progressive ? "Installing dependencies" : "NPM install";
  if (mode === "npm-audit") return progressive ? "Auditing dependencies" : "NPM audit";
  if (mode === "npm-lint") return progressive ? "Running lint" : "NPM lint";
  if (mode === "npm-test") return progressive ? "Running tests" : "NPM test";
  if (mode === "npm-build") return progressive ? "Building web app" : "NPM build";
  return progressive ? "Running validation" : "Validate files";
}

function modeDescription(mode: SandboxMode) {
  if (mode === "terraform-fmt") return "Format generated Terraform files inside the sandbox-mounted workspace.";
  if (mode === "terraform-plan") return "Run provider-backed Terraform plan. This requires network and credentials.";
  if (mode === "terraform-apply") return "Run Terraform apply inside the configured sandbox backend. This can create cloud resources.";
  if (mode === "terraform-destroy") return "Run Terraform destroy inside the configured sandbox backend. This removes resources tracked in the local Terraform state.";
  if (mode === "npm-install") return "Install Node dependencies for the active web workspace.";
  if (mode === "npm-audit") return "Run npm audit against the active web workspace with sandbox network enabled.";
  if (mode === "npm-lint") return "Run the package lint script inside the sandbox-mounted workspace.";
  if (mode === "npm-test") return "Run the package test script inside the sandbox-mounted workspace.";
  if (mode === "npm-build") return "Run the package build script inside the sandbox-mounted workspace.";
  return "Run offline checks and optional provider validation inside the configured sandbox backend.";
}

function npmActionMode(action: NpmSlashAction): SandboxMode {
  if (action === "install") return "npm-install";
  if (action === "audit") return "npm-audit";
  if (action === "lint") return "npm-lint";
  if (action === "test") return "npm-test";
  return "npm-build";
}

function isTerraformSandboxMode(mode: SandboxMode) {
  return mode === "terraform-fmt" || mode === "validate" || mode === "terraform-plan" || mode === "terraform-apply" || mode === "terraform-destroy";
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function Chip({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${danger ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-700"}`}>{children}</span>;
}

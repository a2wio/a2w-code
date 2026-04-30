"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Chat, CloudProvider, GitCommit, GitStashEntry, GitWorkspaceStatus, InfraPlan, Message, MessageAction, ProviderConnection, SandboxRun, TerraformRoot, TerraformVariableDefinition } from "@/lib/types";
import { FilesBrowser } from "./FilesBrowser";
import { Icon } from "./Icon";
import { MarkdownMessage } from "./MarkdownMessage";
import { Modal } from "./Modal";
import { Toast } from "./Toast";

const promptSuggestions = [
  "Run terraform fmt for my first resource.",
  "Run terraform plan and tell me what will be created.",
  "Show me the generated files before I apply.",
  "/model",
  "What is blocking this deployment?",
  "Destroy the Terraform-managed first resource."
];

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
  }
] as const;
type SlashCommand = (typeof slashCommands)[number];
type TerraformSlashAction = Extract<SlashCommand, { kind: "terraform" }>["action"];

type SandboxMode = "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy";
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
const EDITOR_TREE_EXPANDED_STORAGE_KEY = "a2w.editor.fileTree.expanded.v1";
const WORKSPACE_TREE_POLL_INTERVAL_MS = 5000;
const CHAT_UPSERT_EVENT = "a2w:chat-upsert";
const CHAT_DELETE_EVENT = "a2w:chat-delete";

export function AgentChat({
  chats,
  messages,
  plans,
  sandboxRuns,
  terraformRoots,
  gitStatus,
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
  const [runsOpen, setRunsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
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
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [mode, setMode] = useState<SandboxMode>("terraform-fmt");
  const [applyConfirm, setApplyConfirm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const codexPickerKeyRequest = useRef(0);
  const editorMode = activeChatId !== "new";
  const codexBusy = editorMode && Boolean(codexPane?.running && !codexPane.ready && !codexPane.viewingTranscript && !codexPane.stagedInput);
  const codexStagedInput = codexBusy ? codexPane?.stagedInput : "";
  const slashQuery = slashCommandQuery(value);
  const slashMatches = useMemo(() => {
    if (slashQuery === null) return [];
    return slashCommands.filter((item) => item.command.startsWith(slashQuery));
  }, [slashQuery]);
  const slashOpen = slashMatches.length > 0;
  const slashMode = slashQuery !== null;
  const selectedSlashCommand = slashMatches[slashIndex] || null;
  const exactSlashCommand = slashMatches.find((item) => item.command === slashQuery) || null;
  const codexPicker = useMemo(() => editorMode ? parseCodexChoicePicker(codexPane?.output || "") : null, [editorMode, codexPane?.output]);

  const chatThreads = useMemo(() => buildChatThreads(chatList, messages, plans), [chatList, messages, plans]);
  const visibleMessages = useMemo(() => {
    if (activeChatId === "new") return [];
    return messages.filter((message) => message.chatId === activeChatId);
  }, [activeChatId, messages]);

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

  useEffect(() => {
    setChatList(chats);
  }, [chats]);

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
    const frame = window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleMessages.length, pendingStatus, activeApprovalStatusPlan?.id, activeChatId, codexPane?.output]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

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
      if (!codexBusy && !codexPicker) return;
      event.preventDefault();
      void sendCodexControlKey("escape");
    }

    window.addEventListener("keydown", cancelCodexOnEscape);
    return () => window.removeEventListener("keydown", cancelCodexOnEscape);
  }, [activeChatId, codexBusy, codexPicker, editorMode]);

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
    const message = value.trim();
    if (!message) return;
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, provider, chatId: activeChatId === "new" ? undefined : activeChatId, rootPath: selectedRoot?.path })
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
      flash(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
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
    if (codexBusy) return;
    setPendingStatus(command.command === "/model" ? "Opening Codex model picker..." : `Running ${command.command} in Codex...`);
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: command.command, provider, chatId: activeChatId === "new" ? undefined : activeChatId, rootPath: selectedRoot?.path })
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
    if (!nextPlan) return;
    const plan = nextPlan;
    const currentMode = nextMode;
    const label = modeLabel(currentMode, true);
    setSandboxPlan(null);
    setPendingStatus(`${label} for ${plan.title}...`);
    setLoading(true);

    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
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
      setSelectedPlanId(plan.id);
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
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error));
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

  return (
    <>
      <section className="motion-enter relative flex h-full w-full overflow-hidden bg-white">
        {editorMode ? (
          <EditorFileRail
            files={editorFiles}
            git={git}
            loading={editorFilesLoading}
            onOpenFile={openFilePanel}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[65px] items-center justify-between gap-4 border-b border-gray-100 px-5 sm:px-6">
            {activeChatId !== "new" && selectedRoot ? (
              <TerraformCurrentMeta root={selectedRoot} roots={roots} onSelectRoot={selectRoot} />
            ) : (
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">New chat</p>
                <h1 className="truncate text-xl font-semibold tracking-[-0.02em]">Message A2W</h1>
              </div>
            )}
          </div>

          <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-y-auto overflow-x-hidden px-4 py-7 sm:px-8">
            {editorMode ? (
              <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-7">
                <CodexTmuxHistory pane={codexPane} fallbackMessages={visibleMessages} onMessageAction={handleMessageAction} />
                {activeApprovalStatusPlan ? <ApprovalStatusBubble plan={activeApprovalStatusPlan} /> : null}
                {pendingStatus ? <PendingBubble message={pendingStatus} /> : null}
                {loading && !pendingStatus ? <ThinkingBubble /> : null}
              </div>
            ) : visibleMessages.length ? (
              <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-7">
                {visibleMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onAction={handleMessageAction}
                  />
                ))}
                {activeApprovalStatusPlan ? <ApprovalStatusBubble plan={activeApprovalStatusPlan} /> : null}
                {pendingStatus ? <PendingBubble message={pendingStatus} /> : null}
                {loading && !pendingStatus ? <ThinkingBubble /> : null}
              </div>
            ) : (
              pendingStatus ? <PendingBubble message={pendingStatus} centered /> : loading ? <ThinkingBubble centered /> : <EmptyChat onPick={setValue} />
            )}
          </div>

          <form onSubmit={submit} className="h-[156px] shrink-0 border-t border-gray-100 bg-white px-3 py-2 sm:px-5">
            <div className="mx-auto max-w-3xl">
              <TerraformActionBar
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
                onApprove={() => selectedPlan && void approve(selectedPlan)}
                onSandbox={(nextMode) => selectedPlan && openSandbox(selectedPlan, nextMode)}
                missingVariables={missingRequiredVariables.length}
              />
            </div>

            <div className="relative mx-auto mt-2 max-w-3xl rounded-[1.75rem] border border-gray-200 bg-[#fbfbf9] p-2.5 shadow-2xl shadow-black/5">
              {codexPicker ? (
                <CodexChoicePicker picker={codexPicker} chatId={activeChatId} onPane={setCodexPane} onKey={(key) => sendCodexControlKey(key, { requirePicker: true })} />
              ) : slashOpen ? (
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
                    if (slashOpen && event.key === "ArrowDown") {
                      event.preventDefault();
                      setSlashIndex((current) => (current + 1) % slashMatches.length);
                      return;
                    }
                    if (slashOpen && event.key === "ArrowUp") {
                      event.preventDefault();
                      setSlashIndex((current) => (current - 1 + slashMatches.length) % slashMatches.length);
                      return;
                    }
                    if (slashOpen && event.key === "Tab") {
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
                      if (slashOpen && slashQuery !== selectedSlashCommand?.command) {
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
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-black outline-none"
                  placeholder={codexStagedInput ? "Submitting queued Codex input..." : codexBusy ? "Codex is working..." : "Message A2W..."}
                />
                <button
                  disabled={loading || codexBusy || slashMode || !value.trim()}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  type="submit"
                  aria-label={slashMode ? "Slash commands run from keyboard" : "Send message"}
                >
                  <Icon name="fa-arrow-up" />
                </button>
              </div>
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
            </div>
          </form>
          <ChatStatusBar provider={provider} providerConnection={activeProviderConnection} git={git} onCredentialsClick={() => setCredentialsOpen(true)} />
        </div>

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
          onPush={() => gitAction("push", {}, "Branch pushed")}
          onCommitAndPush={commitAllAndPush}
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
          onPush={() => gitAction("push", {}, "Branch pushed")}
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

function EditorFileRail({
  files,
  git,
  loading,
  onOpenFile
}: {
  files: FileEntry[];
  git: GitWorkspaceStatus;
  loading: boolean;
  onOpenFile: (path: string) => void;
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
  const branch = git.initialized ? git.branch || "unknown" : "not initialized";
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
    <aside className="hidden h-full w-[286px] shrink-0 flex-col border-r border-gray-200 bg-[#fbfbf9] lg:flex">
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
  const branch = git.initialized ? git.branch || "unknown" : "not initialized";
  const credentialsConfigured = Boolean(providerConnection);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-gray-100 bg-[#fbfbf9] px-4 text-[11px] text-gray-500 sm:px-6" aria-label="Workspace status">
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
      <aside className="absolute left-0 top-0 flex h-full w-[min(72%,1120px)] min-w-0 max-w-[calc(100%-32px)] overflow-hidden border-r border-gray-200 bg-white shadow-2xl shadow-black/12 sm:min-w-[640px]">
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

function TerraformActionBar({
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
  onApprove,
  onSandbox,
  missingVariables
}: {
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
  onApprove: () => void;
  onSandbox: (mode: SandboxMode) => void;
  missingVariables: number;
}) {
  const [openGroup, setOpenGroup] = useState<"terraform" | "git" | null>(null);
  const approved = Boolean(plan?.status.includes("approved"));
  const canMutate = approved && !applyDisabled && applyRuntimeEnabled;
  const disabled = loading || !plan;

  function run(action: () => void) {
    setOpenGroup(null);
    action();
  }

  return (
    <div className="relative flex min-h-10 items-start justify-between gap-4">
      {openGroup ? (
        <div className={`absolute bottom-full z-20 mb-2 w-64 rounded-[1.25rem] border border-gray-200 bg-white p-2 shadow-2xl shadow-black/10 ${openGroup === "terraform" ? "left-0" : "right-0"}`}>
          {openGroup === "terraform" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-code-branch" label="View plan" disabled={disabled} onClick={() => run(onViewPlan)} />
              <ActionMenuButton icon="fa-clock-rotate-left" label="Run history" disabled={loading || !root} onClick={() => run(onRuns)} />
              <ActionMenuButton icon="fa-keyboard" label={missingVariables ? `Inputs (${missingVariables})` : "Inputs"} disabled={loading || !root} onClick={() => run(onVariables)} />
              <ActionMenuButton icon="fa-code" label="Terraform fmt" disabled={disabled} onClick={() => run(() => onSandbox("terraform-fmt"))} />
              <ActionMenuButton icon="fa-terminal" label="Terraform plan" disabled={disabled} onClick={() => run(() => onSandbox("terraform-plan"))} />
              {approved ? (
                <>
                  <ActionMenuButton icon="fa-rocket" label="Apply" danger disabled={loading || !canMutate} onClick={() => run(() => onSandbox("terraform-apply"))} />
                  <ActionMenuButton icon="fa-trash" label="Destroy" subtleDanger disabled={loading || !canMutate} onClick={() => run(() => onSandbox("terraform-destroy"))} />
                </>
              ) : (
                <ActionMenuButton icon="fa-check" label="Approve" primary disabled={disabled || Boolean(plan?.blocked)} onClick={() => run(onApprove)} />
              )}
            </div>
          ) : null}

          {openGroup === "git" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-code-branch" label="View diff" disabled={loading} onClick={() => run(onDiff)} />
              <ActionMenuButton icon="fa-cloud-arrow-up" label="Commit & push" disabled={loading} onClick={() => run(onCommitPush)} />
              <ActionMenuButton icon="fa-code-commit" label="Git workspace" disabled={loading} onClick={() => run(onGit)} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-[#fbfbf9] p-1">
        <GroupTrigger icon={<TerraformMark />} label="Terraform" active={openGroup === "terraform"} onClick={() => setOpenGroup(openGroup === "terraform" ? null : "terraform")} />
      </div>
      <div className="flex items-center justify-end gap-1.5 rounded-full border border-gray-200 bg-[#fbfbf9] p-1">
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

function EmptyChat({
  onPick
}: {
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[56vh] max-w-3xl flex-col items-center justify-center text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[1.25rem] bg-black text-white shadow-xl shadow-black/10">
        <Icon name="fa-message" />
      </span>
      <h2 className="mt-6 text-4xl font-semibold tracking-[-0.04em]">Deploy from chat.</h2>
      <p className="mt-4 max-w-xl text-sm leading-7 text-gray-600">
        Generate or edit files from the prompt. Terraform controls stay pinned above the input.
      </p>
      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
        {promptSuggestions.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-[1.25rem] border border-gray-200 bg-[#fbfbf9] p-4 text-left text-sm leading-6 text-gray-700 transition hover:border-gray-300 hover:bg-white"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
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

function parseCodexPaneTurns(output: string): CodexPaneTurn[] {
  const turns: CodexPaneTurn[] = [];
  let current: CodexPaneTurn | null = null;
  let skippingPrimer = false;

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    const plain = line.trim().replace(/^│\s?/, "").replace(/\s?│$/, "").trim();

    if (shouldSkipCodexPaneLine(plain)) continue;
    if (plain.startsWith("You are Codex inside ")) {
      skippingPrimer = true;
      continue;
    }
    if (skippingPrimer) {
      if (plain.startsWith("Operator request:")) skippingPrimer = false;
      continue;
    }
    if (plain.startsWith("Operator request:")) continue;

    if (plain.startsWith("›")) {
      const prompt = plain.replace(/^›\s*/, "").trim();
      if (prompt.startsWith("/")) {
        current = null;
        continue;
      }
      if (!prompt || isCodexPromptPlaceholder(prompt)) continue;
      current = { prompt, response: "", actions: [] };
      turns.push(current);
      continue;
    }

    if (!current) continue;
    if (!plain && !current.response) continue;
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

function isCodexPromptPlaceholder(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return true;
  if (clean === "explain this codebase") return true;
  if (clean === "review my changes") return true;
  if (clean === "find and fix a bug") return true;
  if (/^type\s+(a\s+)?message/.test(clean)) return true;
  if (/^(ask|message)\s+codex\b/.test(clean)) return true;
  return /^(find and fix|write tests|explain|review)\b/.test(clean) && clean.includes("@filename");
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
  onPush,
  onCommitAndPush
}: {
  git: GitWorkspaceStatus;
  loading: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onClose: () => void;
  onInit: () => void;
  onCommit: (mode: "all" | "staged") => void;
  onPush: () => void;
  onCommitAndPush: () => void;
}) {
  const stagedCount = git.files.filter((file) => Boolean(file.indexStatus && file.indexStatus !== "?")).length;
  const changedCount = git.files.length;
  const canPush = Boolean(git.remoteUrl) && (git.ahead || 0) > 0;
  const canCommit = git.initialized && changedCount > 0;
  const canCommitAndPush = canCommit && Boolean(git.remoteUrl);

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
            <div className="grid gap-3 rounded-[1.5rem] border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Ready to checkpoint</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {changedCount ? `${changedCount} changed file${changedCount === 1 ? "" : "s"}` : "No local changes"}
                    {stagedCount ? ` · ${stagedCount} staged` : ""}
                    {(git.ahead || 0) > 0 ? ` · ${git.ahead} commit${git.ahead === 1 ? "" : "s"} ahead` : ""}
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
  onPush,
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
  onPush: () => void;
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
  const dirty = git.initialized && !git.clean;
  const stagedCount = git.files.filter((file) => Boolean(file.indexStatus && file.indexStatus !== "?")).length;
  const unstagedCount = git.files.filter((file) => Boolean(file.worktreeStatus)).length;

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
          <div className={`grid min-h-0 gap-4 lg:h-[calc(100vh-280px)] ${focusedGitPanel ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(360px,0.92fr)_minmax(460px,1.08fr)]"}`}>
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
                  <GitButton label={(git.ahead || 0) > 0 ? `Push ${git.ahead}` : "Push"} tooltip="Push committed changes to the remote branch" icon="fa-arrow-up" disabled={loading || !git.remoteUrl} onClick={onPush} />
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
        )}
      </div>
    </Modal>
  );
}

function GitStatusStrip({ git }: { git: GitWorkspaceStatus }) {
  const repository = git.repositoryName || "repository";
  const branch = git.branch || "-";
  const upstream = git.upstream || "no upstream";
  const changes = git.clean ? "clean" : `${git.files.length} changed`;
  const sync = (git.ahead || git.behind) ? `ahead ${git.ahead || 0} / behind ${git.behind || 0}` : "synced";
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
        <span className="rounded-full bg-white px-2.5 py-1">{sync}</span>
      </div>
    </div>
  );
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
  return progressive ? "Running validation" : "Validate files";
}

function modeDescription(mode: SandboxMode) {
  if (mode === "terraform-fmt") return "Format generated Terraform files inside the sandbox-mounted workspace.";
  if (mode === "terraform-plan") return "Run provider-backed Terraform plan. This requires network and credentials.";
  if (mode === "terraform-apply") return "Run Terraform apply inside the configured sandbox backend. This can create cloud resources.";
  if (mode === "terraform-destroy") return "Run Terraform destroy inside the configured sandbox backend. This removes resources tracked in the local Terraform state.";
  return "Run offline checks and optional provider validation inside the configured sandbox backend.";
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

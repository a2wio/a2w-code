"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Chat, CloudProvider, GitWorkspaceStatus, InfraPlan, Message, MessageAction, SandboxRun, TerraformRoot, TerraformVariableDefinition } from "@/src/lib/types";
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

export function AgentChat({
  chats,
  messages,
  plans,
  sandboxRuns,
  terraformRoots,
  gitStatus,
  provider,
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
  const [activeChatId, setActiveChatId] = useState<string>(initialChatId || "new");
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [savingVariables, setSavingVariables] = useState(false);
  const [providerTestOpen, setProviderTestOpen] = useState(false);
  const [providerTest, setProviderTest] = useState<{ status: string; label: string; detail: string } | null>(null);
  const [providerTestLoading, setProviderTestLoading] = useState(false);
  const [gitLoading, setGitLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("Update Terraform workspace");
  const [approvePlan, setApprovePlan] = useState<InfraPlan | null>(null);
  const [sandboxPlan, setSandboxPlan] = useState<InfraPlan | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [modalFiles, setModalFiles] = useState<FileEntry[]>([]);
  const [allowNetwork, setAllowNetwork] = useState(false);
  const [mode, setMode] = useState<SandboxMode>("terraform-fmt");
  const [applyConfirm, setApplyConfirm] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatThreads = useMemo(() => buildChatThreads(chats, messages, plans), [chats, messages, plans]);
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
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleMessages.length, pendingStatus, activeApprovalStatusPlan?.id, activeChatId]);

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
    if (activeChatId !== "new" && !chats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId("new");
    }
  }, [activeChatId, chats]);

  useEffect(() => {
    const nextChatId = initialChatId || "new";
    setActiveChatId(nextChatId);
    if (nextChatId === "new") {
      setSelectedPlanId(null);
      setValue(initialPrompt || "");
      setPlanModalOpen(false);
      setApprovePlan(null);
      setSandboxPlan(null);
    }
  }, [initialChatId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      if (data.chat?.id) setActiveChatId(data.chat.id);
      if (data.plan?.id) setSelectedPlanId(data.plan.id);
      flash(data.plan ? "Plan generated and files written" : "Message sent");
      if (data.chat?.id) router.replace(`/dashboard/agent?chat=${encodeURIComponent(data.chat.id)}`);
      else router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3200);
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!approvePlan) return;
    const plan = approvePlan;
    setApprovePlan(null);
    setPendingStatus(`Recording approval for ${plan.title}...`);
    setLoading(true);
    try {
      const response = await fetch(`/api/plans/${plan.id}/approve`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not approve plan.");
      setSelectedPlanId(plan.id);
      if (plan.chatId) setActiveChatId(plan.chatId);
      flash("Plan approved");
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3200);
    } finally {
      setLoading(false);
      window.setTimeout(() => setPendingStatus(null), 900);
    }
  }

  async function runSandbox() {
    if (!sandboxPlan) return;
    const plan = sandboxPlan;
    const currentMode = mode;
    const label = modeLabel(currentMode, true);
    setSandboxPlan(null);
    setPendingStatus(`${label} for ${plan.title}...`);
    setLoading(true);

    try {
      const response = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan.id, rootPath: selectedRoot?.path, mode: currentMode, allowNetwork, confirm: applyConfirm })
      });
      const data = await response.json();
      if (!response.ok && !data.run) throw new Error(data.error || "Sandbox run failed.");
      setApplyConfirm("");
      setSelectedPlanId(plan.id);
      if (plan.chatId) setActiveChatId(plan.chatId);
      flash(data.run?.status === "succeeded" ? `${label} succeeded` : `${label} failed`);
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3600);
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
      flash(error instanceof Error ? error.message : String(error), 3200);
    } finally {
      setFilesLoading(false);
    }
  }

  function flash(message: string, timeout = 2400) {
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
    setAllowNetwork(nextMode === "terraform-plan" || nextMode === "terraform-apply" || nextMode === "terraform-destroy");
    setApplyConfirm("");
    setSandboxPlan(plan);
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
      flash(error instanceof Error ? error.message : String(error), 3600);
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
      flash(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function refreshGit() {
    const response = await fetch("/api/git");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load Git status.");
    setGit(data.git);
    return data.git as GitWorkspaceStatus;
  }

  async function openDiff() {
    setDiffOpen(true);
    try {
      await refreshGit();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function openGit() {
    setGitOpen(true);
    try {
      await refreshGit();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3200);
    }
  }

  async function gitAction(action: "init" | "commit") {
    setGitLoading(true);
    try {
      const response = await fetch("/api/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, message: commitMessage })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Git action failed.");
      setGit(data.git);
      flash(action === "init" ? "Git initialized" : "Workspace changes committed");
      router.refresh();
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 3600);
    } finally {
      setGitLoading(false);
    }
  }

  async function testProviderCredentials() {
    setProviderTestOpen(true);
    setProviderTestLoading(true);
    setProviderTest(null);
    try {
      const response = await fetch("/api/provider-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: selectedRoot?.provider || provider })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Provider test failed.");
      setProviderTest(data.result);
    } catch (error) {
      setProviderTest({
        status: "failed",
        label: "Provider test failed",
        detail: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setProviderTestLoading(false);
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
      <section className="motion-enter flex h-full w-full overflow-hidden bg-white">
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

          <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-auto px-4 py-7 sm:px-8">
            {visibleMessages.length ? (
              <div className="mx-auto grid max-w-3xl gap-7">
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

          <form onSubmit={submit} className="h-[169px] shrink-0 border-t border-gray-100 bg-white px-3 py-2 sm:px-5">
            <div className="mx-auto max-w-3xl">
              <TerraformActionBar
                plan={selectedPlan}
                root={selectedRoot}
                loading={loading}
                applyDisabled={applyDisabled}
                applyRuntimeEnabled={applyRuntimeEnabled}
                onViewPlan={() => selectedPlan && setPlanModalOpen(true)}
                onChecks={() => setChecksOpen(true)}
                onRuns={() => setRunsOpen(true)}
                onVariables={openVariables}
                onDiff={openDiff}
                onGit={openGit}
                onTestProvider={testProviderCredentials}
                onApprove={() => selectedPlan && setApprovePlan(selectedPlan)}
                onSandbox={(nextMode) => selectedPlan && openSandbox(selectedPlan, nextMode)}
                onFiles={openFiles}
                missingVariables={missingRequiredVariables.length}
              />
            </div>

            <div className="mx-auto mt-2 max-w-3xl rounded-[1.75rem] border border-gray-200 bg-[#fbfbf9] p-2.5 shadow-2xl shadow-black/5">
              <div className="flex items-end gap-3">
                <textarea
                  rows={1}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-black outline-none"
                  placeholder="Message A2W..."
                />
                <button
                  disabled={loading || !value.trim()}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  type="submit"
                  aria-label="Send message"
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
        </div>
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

      {gitOpen ? (
        <GitModal
          git={git}
          loading={gitLoading}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          onClose={() => setGitOpen(false)}
          onInit={() => gitAction("init")}
          onCommit={() => gitAction("commit")}
          onRefresh={openGit}
        />
      ) : null}

      {providerTestOpen ? (
        <ProviderTestModal
          result={providerTest}
          loading={providerTestLoading}
          onClose={() => setProviderTestOpen(false)}
          onRetry={testProviderCredentials}
        />
      ) : null}

      {approvePlan ? (
        <Modal title="Approve plan" description="This records explicit approval. It still will not deploy to your cloud account." icon="fa-check" onClose={() => setApprovePlan(null)}>
          <div className="mt-5 rounded-[1.5rem] bg-gray-50 p-5">
            <h3 className="text-xl font-semibold tracking-[-0.03em]">{approvePlan.title}</h3>
            <p className="mt-3 text-sm leading-7 text-gray-600">{approvePlan.summary}</p>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setApprovePlan(null)} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
              Cancel
            </button>
            <button disabled={loading} type="button" onClick={approve} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
              <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-check"} />
              Confirm approval
            </button>
          </div>
        </Modal>
      ) : null}

      {sandboxPlan ? (
        <SandboxModal
          plan={sandboxPlan}
          mode={mode}
          loading={loading}
          allowNetwork={allowNetwork}
          applyConfirm={applyConfirm}
          applyDisabled={applyDisabled}
          applyRuntimeEnabled={applyRuntimeEnabled}
          onModeChange={(nextMode) => {
            setMode(nextMode);
            setAllowNetwork(nextMode === "terraform-plan" || nextMode === "terraform-apply" || nextMode === "terraform-destroy");
            if (nextMode !== "terraform-apply" && nextMode !== "terraform-destroy") setApplyConfirm("");
          }}
          onAllowNetworkChange={setAllowNetwork}
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

function TerraformActionBar({
  plan,
  root,
  loading,
  applyDisabled,
  applyRuntimeEnabled,
  onViewPlan,
  onChecks,
  onRuns,
  onVariables,
  onDiff,
  onGit,
  onTestProvider,
  onApprove,
  onSandbox,
  onFiles,
  missingVariables
}: {
  plan: InfraPlan | null;
  root: TerraformRoot | null;
  loading: boolean;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
  onViewPlan: () => void;
  onChecks: () => void;
  onRuns: () => void;
  onVariables: () => void;
  onDiff: () => void;
  onGit: () => void;
  onTestProvider: () => void;
  onApprove: () => void;
  onSandbox: (mode: SandboxMode) => void;
  onFiles: () => void;
  missingVariables: number;
}) {
  const [openGroup, setOpenGroup] = useState<"terraform" | "git" | "controls" | null>(null);
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
              <ActionMenuButton icon="fa-code-commit" label="Git workspace" disabled={loading} onClick={() => run(onGit)} />
            </div>
          ) : null}

          {openGroup === "controls" ? (
            <div className="grid gap-1">
              <ActionMenuButton icon="fa-folder-tree" label="Files" disabled={loading} onClick={() => run(onFiles)} />
              <ActionMenuButton icon="fa-key" label="Credentials" disabled={loading} onClick={() => run(onTestProvider)} />
              <ActionMenuButton icon="fa-shield-halved" label="Checks" disabled={loading || !root} onClick={() => run(onChecks)} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-[#fbfbf9] p-1">
        <GroupTrigger icon={<TerraformMark />} label="Terraform" active={openGroup === "terraform"} onClick={() => setOpenGroup(openGroup === "terraform" ? null : "terraform")} />
      </div>
      <div className="flex items-center justify-end gap-1.5 rounded-full border border-gray-200 bg-[#fbfbf9] p-1">
        <GroupTrigger icon={<Icon name="fa-brands fa-git-alt" className="text-[13px] text-[#F05032]" />} label="Git" active={openGroup === "git"} onClick={() => setOpenGroup(openGroup === "git" ? null : "git")} />
        <GroupTrigger label="Controls" active={openGroup === "controls"} onClick={() => setOpenGroup(openGroup === "controls" ? null : "controls")} />
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

function MessageBubble({
  message,
  onAction
}: {
  message: Message;
  onAction: (action: MessageAction) => void;
}) {
  const user = message.role === "user";
  return (
    <article className={`flex gap-4 ${user ? "justify-end" : "justify-start"}`}>
      {!user ? (
        <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</span>
      ) : null}
      <div className={`max-w-[86%] ${user ? "rounded-[1.5rem] bg-gray-100 px-4 py-3" : "py-1"}`}>
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
      <div className="rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
        <MarkdownMessage content={content} />
      </div>
    );
  }

  const intro = content.slice(0, index);
  const output = content.slice(index + marker.length);
  return (
    <div className="rounded-[1.5rem] border border-gray-200 bg-[#fbfbf9] px-4 py-3">
      <MarkdownMessage content={intro} />
      <details className="mt-4 rounded-[1.25rem] border border-gray-200 bg-[#fbfbf9] p-3" open={output.length < 1200}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Sandbox output</summary>
        <pre className="thin-scrollbar mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-[1rem] bg-black p-3 text-xs leading-6 text-gray-100">
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

function GitModal({
  git,
  loading,
  commitMessage,
  onCommitMessageChange,
  onClose,
  onInit,
  onCommit,
  onRefresh
}: {
  git: GitWorkspaceStatus;
  loading: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onClose: () => void;
  onInit: () => void;
  onCommit: () => void;
  onRefresh: () => void;
}) {
  return (
    <Modal title="Git workspace" description="Initialize Git, inspect working tree status, and commit reviewed Terraform changes." icon="fa-code-commit" size="xl" onClose={onClose}>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-3 rounded-[1.5rem] bg-[#f7f7f4] p-4 text-sm sm:grid-cols-3">
          <MiniStat label="Git" value={!git.available ? "unavailable" : git.initialized ? "initialized" : "not initialized"} />
          <MiniStat label="Branch" value={git.branch || "-"} />
          <MiniStat label="Working tree" value={git.clean ? "clean" : `${git.files.length} changed`} />
        </div>

        {!git.initialized ? (
          <button type="button" onClick={onInit} disabled={loading || !git.available} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
            <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-code-commit"} />
            Initialize Git repository
          </button>
        ) : (
          <div className="grid gap-3 rounded-[1.5rem] border border-gray-200 p-4">
            <label className="grid gap-2 text-sm font-medium text-gray-700">
              Commit message
              <input
                value={commitMessage}
                onChange={(event) => onCommitMessageChange(event.target.value)}
                className="h-11 rounded-2xl border border-gray-200 px-4 outline-none transition focus:border-black"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onRefresh} disabled={loading} className="h-10 rounded-full border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:text-gray-400">
                Refresh
              </button>
              <button type="button" onClick={onCommit} disabled={loading || git.clean} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-black px-4 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300">
                <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-check"} />
                Commit changes
              </button>
            </div>
          </div>
        )}

        <GitDiffContent git={git} compact />
      </div>
    </Modal>
  );
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

function ProviderTestModal({
  result,
  loading,
  onClose,
  onRetry
}: {
  result: { status: string; label: string; detail: string } | null;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Modal title="Provider credentials" description="Verify whether saved cloud credentials can authenticate from this self-hosted server." icon="fa-key" onClose={onClose}>
      <div className="mt-5 rounded-[1.5rem] bg-[#f7f7f4] p-5">
        {loading ? (
          <p className="inline-flex items-center gap-3 text-sm font-medium text-gray-700">
            <Icon name="fa-circle-notch fa-spin" />
            Testing provider credentials...
          </p>
        ) : result ? (
          <>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${result.status === "connected" ? "bg-emerald-50 text-emerald-700" : result.status === "configured" ? "bg-gray-100 text-gray-700" : "bg-red-50 text-red-700"}`}>
              {result.status}
            </span>
            <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em]">{result.label}</h3>
            <p className="mt-3 text-sm leading-7 text-gray-600">{result.detail}</p>
          </>
        ) : null}
      </div>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onRetry} disabled={loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:text-gray-400">
          <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-rotate"} />
          Retest
        </button>
      </div>
    </Modal>
  );
}

function SandboxModal({
  plan,
  mode,
  loading,
  allowNetwork,
  applyConfirm,
  applyDisabled,
  applyRuntimeEnabled,
  onModeChange,
  onAllowNetworkChange,
  onApplyConfirmChange,
  onClose,
  onRun
}: {
  plan: InfraPlan;
  mode: SandboxMode;
  loading: boolean;
  allowNetwork: boolean;
  applyConfirm: string;
  applyDisabled: boolean;
  applyRuntimeEnabled: boolean;
  onModeChange: (mode: SandboxMode) => void;
  onAllowNetworkChange: (allow: boolean) => void;
  onApplyConfirmChange: (value: string) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const mutationMode = mode === "terraform-apply" || mode === "terraform-destroy";
  const mutationNotApproved = !plan.status.includes("approved");
  const mutationUnavailable = mutationMode && (applyDisabled || !applyRuntimeEnabled || mutationNotApproved);
  const danger = mutationMode;
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
        <label className="grid gap-2 text-sm font-medium text-gray-700">
          Action
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value as SandboxMode)}
            className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
          >
            <option value="terraform-fmt">Terraform fmt</option>
            <option value="validate">Validate files</option>
            <option value="terraform-plan">Terraform plan</option>
            <option value="terraform-apply">Terraform apply</option>
            <option value="terraform-destroy">Terraform destroy</option>
          </select>
        </label>

        <label className="flex items-center gap-3 rounded-2xl bg-gray-50 p-4 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={allowNetwork || mode === "terraform-apply" || mode === "terraform-destroy" || mode === "terraform-plan"}
            disabled={mode === "terraform-apply" || mode === "terraform-destroy" || mode === "terraform-plan"}
            onChange={(event) => onAllowNetworkChange(event.target.checked)}
          />
          Allow network inside sandbox
        </label>

        {mutationUnavailable ? (
          <div className="rounded-[1.5rem] bg-red-50 p-4 text-sm leading-7 text-red-800">
            {mutationNotApproved
              ? "Approve the plan before running cloud-changing Terraform actions."
              : applyDisabled
                ? "Terraform apply/destroy is disabled in Settings."
                : "Restart the local server with A2W_ENABLE_TERRAFORM_APPLY=true to allow apply or destroy."}
          </div>
        ) : null}

        {mutationMode ? (
          <label className="grid gap-2 rounded-[1.5rem] bg-red-50 p-4 text-sm font-medium text-red-900">
            Type {expectedConfirmation} to {mode === "terraform-destroy" ? "destroy Terraform-managed cloud resources" : "create or update cloud resources"}
            <input
              value={applyConfirm}
              onChange={(event) => onApplyConfirmChange(event.target.value)}
              className="h-12 rounded-2xl border border-red-100 bg-white px-4 text-black outline-none transition focus:border-red-700"
              placeholder={expectedConfirmation}
            />
          </label>
        ) : null}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
          Cancel
        </button>
        <button
          disabled={loading || mutationUnavailable || (mutationMode && applyConfirm !== expectedConfirmation)}
          type="button"
          onClick={onRun}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition disabled:bg-gray-300 ${
            mutationMode ? "bg-red-700 hover:bg-red-800" : "bg-black hover:bg-gray-800"
          }`}
        >
          <Icon name={loading ? "fa-circle-notch fa-spin" : mode === "terraform-apply" ? "fa-rocket" : mode === "terraform-destroy" ? "fa-trash" : "fa-play"} />
          Run {modeLabel(mode).toLowerCase()}
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
  if (mode === "terraform-apply") return "Run Terraform apply inside local Podman. This can create cloud resources.";
  if (mode === "terraform-destroy") return "Run Terraform destroy inside local Podman. This removes resources tracked in the local Terraform state.";
  return "Run offline checks and optional provider validation inside local Podman.";
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

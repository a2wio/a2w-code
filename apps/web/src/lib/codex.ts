import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { CloudProvider, InfraPlan, ProviderConnection, Workspace } from "./types";
import { listWorkspaceFiles } from "./materialize";
import { workspaceRepoRoot } from "./data";
import { workspaceMode } from "./workspace-mode";

type CodexRun = {
  finalMessage: string;
  output: string;
  changedFiles: string[];
  codexThreadId?: string;
  plan: Omit<InfraPlan, "workspaceId" | "createdAt">;
};

export function codexBackendEnabled(workspace?: Workspace) {
  return workspace?.codexEnabled || process.env.A2W_AGENT_BACKEND === "codex";
}

export async function getCodexLoginStatus() {
  try {
    const output = await execCodexCommand(["login", "status"], process.cwd(), 10000);
    return {
      available: true,
      authenticated: /logged in/i.test(output),
      output
    };
  } catch (error) {
    return {
      available: !(error instanceof Error && /Could not start codex/i.test(error.message)),
      authenticated: false,
      output: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runCodexWorkspaceAgent(input: {
  message: string;
  workspace: Workspace;
  provider: CloudProvider;
  providerConnection?: ProviderConnection;
  codexThreadId?: string;
  selectedRootPath?: string;
}): Promise<CodexRun> {
  const mode = workspaceMode(input.workspace);
  const before = await listWorkspaceFiles(input.workspace.id, mode);
  const beforeByPath = new Map(before.map((file) => [file.path, `${file.size}:${file.updatedAt}`]));
  const repoRoot = workspaceRepoRoot(input.workspace.id, mode);
  const tempDir = await mkdtemp(join(tmpdir(), "a2w-codex-"));
  const finalMessagePath = join(tempDir, "last-message.txt");

  try {
    const output = await execCodex({
      repoRoot,
      finalMessagePath,
      prompt: codexPrompt(input),
      model: input.workspace.codexModel,
      codexThreadId: input.codexThreadId
    });
    const finalMessage = (await readFinalMessage(finalMessagePath)) || "Codex completed the workspace task.";
    const after = await listWorkspaceFiles(input.workspace.id, mode);
    const changedFiles = after
      .filter((file) => beforeByPath.get(file.path) !== `${file.size}:${file.updatedAt}`)
      .map((file) => file.path);

    return {
      finalMessage,
      output,
      changedFiles,
      codexThreadId: extractThreadId(output) || input.codexThreadId,
      plan: codexPlan(input, finalMessage, changedFiles.length ? changedFiles : after.map((file) => file.path))
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function execCodex({
  repoRoot,
  finalMessagePath,
  prompt,
  model,
  codexThreadId
}: {
  repoRoot: string;
  finalMessagePath: string;
  prompt: string;
  model?: string;
  codexThreadId?: string;
}) {
  const args = codexThreadId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        ...codexSandboxArgs(),
        "--output-last-message",
        finalMessagePath
      ]
    : [
        "exec",
        "--json",
        "--cd",
        repoRoot,
        "--skip-git-repo-check",
        ...codexSandboxArgs(),
        "--color",
        "never",
        "--output-last-message",
        finalMessagePath
      ];
  const selectedModel = model || process.env.A2W_CODEX_MODEL;
  if (selectedModel) args.push("--model", selectedModel);
  if (codexThreadId) args.push(codexThreadId);
  args.push(prompt);

  return execCodexCommand(args, repoRoot, Number(process.env.A2W_CODEX_TIMEOUT_MS || 180000));
}

function codexSandboxArgs() {
  if (process.env.A2W_CODEX_BYPASS_SANDBOX === "true") return ["--dangerously-bypass-approvals-and-sandbox"];
  return ["--sandbox", process.env.A2W_CODEX_SANDBOX || "workspace-write"];
}

function execCodexCommand(args: string[], cwd: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timeout = windowlessTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Could not start codex. Run codex login on this host and verify the CLI is on PATH. ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(output.trim());
        return;
      }
      reject(new Error(`Codex exited with code ${code ?? "unknown"}.\n\n${output.trim()}`));
    });
  });
}

async function readFinalMessage(path: string) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return "";
  }
}

function extractThreadId(output: string) {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: string; thread_id?: string };
      if (event.type === "thread.started" && event.thread_id) return event.thread_id;
    } catch {
      // Ignore non-JSON stderr lines mixed into the Codex output stream.
    }
  }
  return "";
}

function codexPrompt(input: {
  message: string;
  workspace: Workspace;
  provider: CloudProvider;
  providerConnection?: ProviderConnection;
  selectedRootPath?: string;
}) {
  const mode = workspaceMode(input.workspace);
  if (mode === "web") {
    return `You are the local code-writing agent inside A2W-Code, a self-hosted Codex workspace.

Workspace:
- Name: ${input.workspace.companyName}
- Mode: Web / Next.js

Operator request:
${input.message}

Execution contract:
- Work only inside the current repository.
- Treat this repository as a web application codebase.
- Prefer existing package scripts, framework conventions, and small reviewable changes.
- Do not run long-lived dev servers unless the operator explicitly asks.
- Do not write secrets, access tokens, or private keys to files.
- If the request is only a question, answer it without changing files.

Final response:
- Summarize what you changed or decided.
- List changed files when applicable.
- State the next operator action, usually npm lint, npm test, npm build, review, commit, then push.`;
  }

  return `You are the local code-writing agent inside A2W, a self-hosted infrastructure console.

Workspace:
- Name: ${input.workspace.companyName}
- Default provider: ${input.provider}
- Region: ${input.providerConnection?.region || "not configured"}
- Active Terraform root: ${input.selectedRootPath || input.workspace.selectedTerraformRoot || "none selected"}

Operator request:
${input.message}

Execution contract:
- Work only inside the current repository.
- You may create or edit Terraform, app, README, and operational notes files.
- Treat this chat as a persistent Codex conversation for the selected operator context. The platform resumes your Codex thread for follow-up messages in the same chat.
- Treat this repository as one shared A2W workspace. Chats share files, but Terraform state belongs to provider call directories, not chats.
- When an active Terraform root is selected, treat it like the current terminal directory in an editor/tmux workflow. If the request says to work "here", "this stack", or "this directory", use that active root and its matching module.
- Follow the DStack Terraform layout exactly:
  - Put reusable resource implementation in infrastructure/terraform/modules/<provider>/<module>.
  - Put deployable call directories in infrastructure/terraform/providers/<provider>/<region>/<stack>.
  - Provider call directories should contain Terraform/provider initialization, concrete locals, module blocks, and outputs that proxy module outputs.
  - Do not put cloud resource blocks such as azurerm_*, aws_*, google_* directly in provider call directories; put them in modules.
  - Initialize, plan, apply, and destroy Terraform only from a provider call directory. Never create a repo-root Terraform state.
- For a new resource request such as "cheap linux vm", create or update a module like infrastructure/terraform/modules/azure/cheap-linux-vm and call it from infrastructure/terraform/providers/azure/<region>/cheap-linux-vm.
- Do not write cloud secrets, access tokens, client secrets, or private keys to files.
- Do not run terraform apply, terraform destroy, cloud CLIs, or any command that mutates real cloud resources.
- Prefer boring, standardized Terraform modules and clear file layout.
- Keep changes small and reviewable.
- If the request is only a question, answer it without changing files.

Final response:
- Summarize what you changed or decided.
- List changed files when applicable.
- State the next operator action, usually terraform fmt, terraform plan, file review, approval, then apply.`;
}

function codexPlan(
  input: {
    workspace: Workspace;
    provider: CloudProvider;
    providerConnection?: ProviderConnection;
  },
  finalMessage: string,
  files: string[]
): Omit<InfraPlan, "workspaceId" | "createdAt"> {
  const providerLabel = input.provider === "azure" ? "Azure" : input.provider === "gcp" ? "GCP" : "AWS";
  const summary = finalMessage.split("\n").find((line) => line.trim())?.trim() || "Codex completed a workspace change.";
  return {
    id: `plan_${randomUUID()}`,
    title: "Codex workspace change",
    provider: input.provider,
    providerLabel,
    cluster: "Workspace",
    environment: "development",
    region: input.providerConnection?.region || (input.provider === "azure" ? "westeurope" : "eu-central-1"),
    status: "ready_for_review",
    risk: "medium",
    blocked: false,
    approvalRequired: true,
    providerConnected: Boolean(input.providerConnection),
    summary,
    assumptions: [
      "Codex ran locally on the self-hosted machine using the operator's Codex authentication.",
      "Generated files still require operator review before any Terraform apply.",
      "Provider credentials remain outside the repository and are injected only into sandbox actions."
    ],
    terraformChanges: [
      files.length ? `Codex touched ${files.length} workspace file${files.length === 1 ? "" : "s"}.` : "Codex did not report file changes.",
      "Run terraform fmt and terraform plan before approval."
    ],
    gitopsChanges: ["Review the changed files to confirm whether GitOps manifests were touched."],
    securityChecks: [
      "No cloud apply or destroy was delegated to Codex.",
      "No provider secrets should be present in generated files.",
      "Apply and destroy remain gated by chat approval, server env, and workspace policy."
    ],
    executionSteps: [
      "Review the Codex response.",
      "Browse the changed files.",
      "Run terraform fmt.",
      "Run terraform plan.",
      "Approve only after the plan matches intent."
    ],
    plannedFiles: files,
    contextRules: [
      "Codex can edit only the local workspace repository.",
      "Chats share one workspace repository; Terraform state is per provider call directory.",
      "Terraform resource logic belongs in infrastructure/terraform/modules/<provider>/<module>.",
      "Provider call directories under infrastructure/terraform/providers/<provider>/<region>/<stack> call modules and own their own state.",
      "Terraform apply and destroy stay separate from Codex generation.",
      "Every infrastructure change must be reviewable from chat and files."
    ]
  };
}

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms);
}

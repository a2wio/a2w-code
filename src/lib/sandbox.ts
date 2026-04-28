import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { PROJECT_ROOT, readData, updateData, workspaceRepoRoot } from "./data";
import { decryptSecret } from "./secrets";
import { parseTerraformPlanOutput, stripTerraformPlanJson } from "./terraform-plan-parser";
import { terraformVariableEnv } from "./terraform-variables";
import type { SandboxRun } from "./types";

const execFileAsync = promisify(execFile);

type CommandError = NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
  code?: number;
};

const FORWARDED_CLOUD_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "ARM_CLIENT_ID",
  "ARM_CLIENT_SECRET",
  "ARM_TENANT_ID",
  "ARM_SUBSCRIPTION_ID",
  "ARM_USE_OIDC",
  "ARM_OIDC_TOKEN",
  "ARM_USE_MSI",
  "GOOGLE_CREDENTIALS",
  "GOOGLE_PROJECT",
  "GOOGLE_REGION"
];

export async function runSandbox(input: {
  workspaceId: string;
  planId?: string;
  rootPath?: string;
  mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy";
  allowNetwork?: boolean;
}) {
  if (isCloudMutationMode(input.mode) && process.env.A2W_ENABLE_TERRAFORM_APPLY !== "true") {
    throw new Error("Terraform cloud mutations are disabled. Set A2W_ENABLE_TERRAFORM_APPLY=true only for local break-glass testing.");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const image = process.env.A2W_SANDBOX_IMAGE || "a2w-infra-sandbox:latest";
  const repoRoot = workspaceRepoRoot(input.workspaceId);
  const sandboxScripts = join(PROJECT_ROOT, "sandbox", "scripts");
  const script = sandboxScript(input.mode);
  const network = input.allowNetwork ? "slirp4netns" : "none";
  const credentialEnv = await sandboxCredentialEnv(input.workspaceId, input.planId);
  const targetDirEnv = await sandboxTerraformTargetDirEnv(input.workspaceId, input.planId, input.mode, input.rootPath);
  const variableEnv = await sandboxTerraformVariableEnv(input.workspaceId, input.rootPath);
  const forwardedEnvNames = forwardedCloudEnvNames({ ...credentialEnv, ...targetDirEnv, ...variableEnv });
  const childEnv = { ...process.env, ...credentialEnv, ...targetDirEnv, ...variableEnv };
  const command = [
    "run",
    "--rm",
    `--network=${network}`,
    "-e",
    `A2W_SANDBOX_NETWORK=${input.allowNetwork ? "1" : "0"}`,
    ...envNameArgs(forwardedEnvNames),
    "-v",
    `${repoRoot}:/workspace:Z`,
    "-v",
    `${sandboxScripts}:/sandbox:ro,Z`,
    "-w",
    "/workspace",
    image,
    "/bin/sh",
    script
  ];

  await updateData((data) => {
    const locks = data.rootLocks || [];
    data.rootLocks = locks.filter((lock) => new Date(lock.expiresAt).getTime() > Date.now());
    if (input.rootPath) {
      const existing = data.rootLocks.find((lock) => lock.workspaceId === input.workspaceId && lock.rootPath === input.rootPath);
      if (existing) {
        throw new Error(`Terraform root is busy with ${existing.mode}. Wait for the active run to finish before starting another action.`);
      }
      data.rootLocks.push({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        rootPath: input.rootPath,
        runId: id,
        mode: input.mode,
        createdAt,
        expiresAt: new Date(Date.now() + sandboxTimeoutMs(input.mode) + 60_000).toISOString()
      });
    }
    data.sandboxRuns.push({
      id,
      workspaceId: input.workspaceId,
      planId: input.planId,
      rootPath: input.rootPath,
      mode: input.mode,
      status: "running",
      command: ["podman", ...command],
      exitCode: null,
      output: "",
      createdAt,
      startedAt: createdAt
    });
    data.events.push({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      type: "sandbox.run_started",
      label: `Sandbox ${input.mode} started`,
      createdAt: new Date().toISOString()
    });
  });

  let output = "";
  let exitCode: number | null = 0;
  let status: SandboxRun["status"] = "succeeded";

  try {
    await execFileAsync("podman", ["info"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });

    const result = await execFileAsync("podman", command, {
      env: childEnv,
      timeout: sandboxTimeoutMs(input.mode),
      maxBuffer: 1024 * 1024 * 4
    });
    output = `${result.stdout || ""}${result.stderr || ""}`;
  } catch (error) {
    const err = error as CommandError;
    status = "failed";
    exitCode = typeof err.code === "number" ? err.code : null;
    output = formatSandboxFailure(err, image);
  }

  const planSummary = input.mode === "terraform-plan" ? parseTerraformPlanOutput(output) : undefined;
  const cleanOutput = input.mode === "terraform-plan" ? stripTerraformPlanJson(output) : output.trim();

  const run: SandboxRun = {
    id,
    workspaceId: input.workspaceId,
    planId: input.planId,
    rootPath: input.rootPath,
    mode: input.mode,
    status,
    command: ["podman", ...command],
    exitCode,
    output: cleanOutput,
    planSummary,
    createdAt,
    startedAt: createdAt,
    completedAt: new Date().toISOString()
  };

  await updateData((data) => {
    const existing = data.sandboxRuns.find((item) => item.id === id && item.workspaceId === input.workspaceId);
    if (existing) Object.assign(existing, run);
    else data.sandboxRuns.push(run);
    data.rootLocks = (data.rootLocks || []).filter((lock) => lock.runId !== id);
    data.events.push({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      type: status === "succeeded" ? "sandbox.run_completed" : "sandbox.run_failed",
      label: `Sandbox ${input.mode} ${status}`,
      createdAt: new Date().toISOString()
    });
  });

  return run;
}

function sandboxScript(mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy") {
  if (mode === "terraform-fmt") return "/sandbox/terraform-fmt.sh";
  if (mode === "validate") return "/sandbox/validate.sh";
  if (mode === "terraform-apply") return "/sandbox/terraform-apply.sh";
  if (mode === "terraform-destroy") return "/sandbox/terraform-destroy.sh";
  return "/sandbox/terraform-plan.sh";
}

function sandboxTimeoutMs(mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy") {
  if (isCloudMutationMode(mode)) return 10 * 60_000;
  if (mode === "terraform-plan") return 4 * 60_000;
  return 2 * 60_000;
}

function isCloudMutationMode(mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy") {
  return mode === "terraform-apply" || mode === "terraform-destroy";
}

function forwardedCloudEnvNames(credentialEnv: Record<string, string>) {
  return Array.from(new Set([
    ...FORWARDED_CLOUD_ENV.filter((name) => Boolean(process.env[name])),
    ...Object.keys(credentialEnv)
  ]));
}

function envNameArgs(names: string[]) {
  return names.flatMap((name) => ["-e", name]);
}

async function sandboxCredentialEnv(workspaceId: string, planId?: string): Promise<Record<string, string>> {
  const data = await readData();
  const plan = planId ? data.plans.find((item) => item.id === planId && item.workspaceId === workspaceId) : undefined;
  const workspace = data.workspaces.find((item) => item.id === workspaceId);
  const provider = plan?.provider || workspace?.cloudPreference;
  if (!provider) return {};

  const connection = data.providerConnections
    .filter((item) => item.workspaceId === workspaceId && item.provider === provider)
    .at(-1);

  if (!connection) return {};

  if (provider === "azure") {
    const env: Record<string, string> = {
      ARM_TENANT_ID: connection.details.tenantId,
      ARM_SUBSCRIPTION_ID: connection.details.subscriptionId,
      ARM_CLIENT_ID: connection.details.clientId
    };
    if (connection.secrets?.clientSecret) {
      env.ARM_CLIENT_SECRET = decryptSecret(connection.secrets.clientSecret);
    }
    return Object.fromEntries(Object.entries(env).filter(([, value]) => Boolean(value)));
  }

  return {};
}

async function sandboxTerraformTargetDirEnv(
  workspaceId: string,
  planId: string | undefined,
  mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy",
  rootPath?: string
): Promise<Record<string, string>> {
  if (rootPath && mode !== "terraform-fmt") return { A2W_TERRAFORM_DIRS: rootPath };
  if (!planId || mode === "terraform-fmt") return {};

  const data = await readData();
  const plan = data.plans.find((item) => item.id === planId && item.workspaceId === workspaceId);
  const dirs = terraformProviderCallDirsFromPlan(plan?.plannedFiles || []);
  if (!dirs.length) return {};
  return { A2W_TERRAFORM_DIRS: dirs.join(":") };
}

async function sandboxTerraformVariableEnv(workspaceId: string, rootPath?: string) {
  if (!rootPath) return {};
  const data = await readData();
  const values = (data.terraformVariables || []).filter((item) => item.workspaceId === workspaceId && item.rootPath === rootPath);
  return terraformVariableEnv(values);
}

function terraformProviderCallDirsFromPlan(files: string[]) {
  const prefix = "infrastructure/terraform/providers/";
  const dirs = new Set<string>();

  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (!normalized.startsWith(prefix)) continue;
    const dir = dirname(normalized).replace(/\\/g, "/");
    if (dir !== "." && dir.startsWith(prefix) && !dir.includes("/.terraform")) {
      dirs.add(dir);
    }
  }

  return [...dirs].sort();
}

function formatSandboxFailure(error: CommandError, image: string) {
  const rawOutput = `${error.stdout || ""}${error.stderr || ""}${error.message ? `\n${error.message}` : ""}`.trim();
  const lower = rawOutput.toLowerCase();

  if (lower.includes("spawn podman enoent") || lower.includes("podman: command not found")) {
    return [
      "Podman is not installed or is not available on PATH for the Next.js server process.",
      "",
      "Install Podman Desktop or the Podman CLI, restart the dev server, then retry the sandbox.",
      "",
      "Original output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("cannot connect to podman") ||
    lower.includes("unable to connect to podman socket") ||
    lower.includes("connection refused") ||
    lower.includes("is not running")
  ) {
    return [
      "Podman is not reachable from this machine.",
      "",
      "The A2W sandbox runs generated infrastructure code inside a local Podman VM. The VM is stopped, crashed after startup, or its SSH/socket forwarding is stale.",
      "",
      "Run these locally, then retry the sandbox:",
      "  podman machine list",
      "  podman machine stop podman-machine-default",
      "  podman machine start podman-machine-default",
      "  podman info",
      "",
      "If `podman info` still fails, recreate or repair the Podman machine before running A2W sandbox validation.",
      "",
      "Original Podman output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("azurecli authorizer") ||
    lower.includes("unable to build authorizer for resource manager api") ||
    lower.includes('exec: "az": executable file not found') ||
    lower.includes("please run 'az login'")
  ) {
    return [
      "Terraform reached Azure provider authentication.",
      "",
      "The generated files initialized, but `terraform plan` needs Azure credentials inside the Podman sandbox. A host `az login` session is not available inside this container.",
      "",
      "Add the Azure client secret in onboarding or Cloud settings, then rerun Terraform plan with network enabled. A2W injects the saved service principal values into Podman as ARM_* environment variables.",
      "",
      "A2W does not write secret values into generated files or the sandbox command log.",
      "",
      "If you want to use Azure CLI auth instead, run `terraform plan` directly on the host where `az login` is configured, or build a sandbox image that includes Azure CLI and mounts a local Azure config intentionally.",
      "",
      "Original Terraform output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("error acquiring the state lock") ||
    lower.includes("resource temporarily unavailable") ||
    lower.includes("lock info:")
  ) {
    return [
      "Terraform could not acquire the local state lock.",
      "",
      "A previous sandbox run likely exited while Terraform still considered the local state file locked. A2W now runs plan-only checks with `-lock=false`; apply still uses locking and waits for a real in-flight operation.",
      "",
      "Retry Terraform plan from chat. If apply hits this later, wait for any active run to finish and retry.",
      "",
      "Original Terraform output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("authorizationfailed") &&
    lower.includes("microsoft.resources/subscriptions/providers/read")
  ) {
    return [
      "Azure accepted the service principal credentials, but rejected the subscription permission check.",
      "",
      "The service principal can authenticate, but it cannot read Azure Resource Provider metadata at the selected subscription scope. For the MVP, assign the app registration service principal `Contributor` on the target subscription or on the target resource group scope.",
      "",
      "If you want a narrower role, it must still allow provider/resource reads plus writes for this template: resource groups, storage accounts, App Service plans, and Function Apps. Also make sure `Microsoft.Storage` and `Microsoft.Web` are registered on the subscription.",
      "",
      "If access was just granted, retry the apply after Azure RBAC propagation completes.",
      "",
      "Original Terraform output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("missingsubscriptionregistration") ||
    (lower.includes("authorizationfailed") && lower.includes("/register/action"))
  ) {
    return [
      "Azure reached the subscription, but required Azure Resource Providers are not registered.",
      "",
      "This first Azure Function stack needs `Microsoft.Storage` for the storage account and `Microsoft.Web` for the App Service plan/function app. A2W generated Terraform asks AzureRM to register exactly those providers before creating the resources.",
      "",
      "If this still fails, grant the service principal subscription-scope permission to register resource providers, or register these providers once in the Azure Portal under Subscription > Resource providers: `Microsoft.Storage` and `Microsoft.Web`.",
      "",
      "Original Terraform output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("no valid credential sources") ||
    lower.includes("no credential providers") ||
    lower.includes("could not load credentials") ||
    lower.includes("google: could not find default credentials")
  ) {
    return [
      "Terraform reached cloud provider authentication.",
      "",
      "The sandbox can run Terraform, but this mode needs cloud credentials in the Next.js server environment so they can be forwarded into Podman.",
      "",
      "Use Validate files for offline checks, or export provider credentials before starting `npm run dev` and rerun Terraform plan with network enabled.",
      "",
      "Original Terraform output:",
      rawOutput || "No output."
    ].join("\n");
  }

  if (
    lower.includes("no such image") ||
    lower.includes("image not known") ||
    lower.includes("short-name") ||
    lower.includes("pull access denied")
  ) {
    return [
      `Sandbox image \`${image}\` is not available locally.`,
      "",
      "Build it from the project root, then retry:",
      `  podman build -t ${image} -f sandbox/Containerfile sandbox`,
      "",
      "Original Podman output:",
      rawOutput || "No output."
    ].join("\n");
  }

  return rawOutput || "Sandbox failed without output.";
}

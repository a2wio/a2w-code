import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { workspaceRepoRoot } from "./data";
import { runPolicyChecks } from "./policy";
import { discoverTerraformVariables } from "./terraform-variables";
import type { AppData, CloudProvider, InfraPlan, SandboxRun, TerraformRoot } from "./types";

const PROVIDER_ROOT_PREFIX = "infrastructure/terraform/providers/";

export async function listTerraformRoots(workspaceId: string, data: AppData): Promise<TerraformRoot[]> {
  const repoRoot = workspaceRepoRoot(workspaceId);
  const rootPaths = await discoverTerraformRootPaths(workspaceId);
  const plans = data.plans.filter((plan) => plan.workspaceId === workspaceId);
  const runs = data.sandboxRuns.filter((run) => run.workspaceId === workspaceId);
  const locks = (data.rootLocks || []).filter((lock) => lock.workspaceId === workspaceId && new Date(lock.expiresAt).getTime() > Date.now());

  const roots = await Promise.all(
    rootPaths.map(async (path) => {
      const plan = latestPlanForRoot(plans, path);
      const rootRuns = runsForRoot(runs, plans, path);
      const lock = locks.find((item) => item.rootPath === path);
      const parts = path.split("/");
      const provider = normalizeProvider(parts[3]);
      const region = parts[4] || "default";
      const name = parts[5] || basename(path);
      const state = await readStateSummary(repoRoot, path);
      const variables = await discoverTerraformVariables(workspaceId, path, data);
      const checks = await runPolicyChecks(workspaceId, path);
      const latest = (mode: SandboxRun["mode"]) => rootRuns.filter((run) => run.mode === mode).at(-1);

      return {
        id: path,
        workspaceId,
        path,
        provider,
        region,
        name,
        label: name,
        planId: plan?.id,
        chatId: plan?.chatId,
        initialized: await pathExists(join(repoRoot, path, ".terraform")),
        backend: await backendType(repoRoot, path),
        applied: rootApplied(rootRuns),
        resourceCount: state.resources.length,
        resources: state.resources,
        lastFmt: latest("terraform-fmt"),
        lastValidate: latest("validate"),
        lastPlan: latest("terraform-plan"),
        lastApply: latest("terraform-apply"),
        lastDestroy: latest("terraform-destroy"),
        lastRun: rootRuns.at(-1),
        lock,
        variables,
        checks
      } satisfies TerraformRoot;
    })
  );

  return roots.sort((a, b) => a.path.localeCompare(b.path));
}

export async function discoverTerraformRootPaths(workspaceId: string) {
  const repoRoot = workspaceRepoRoot(workspaceId);
  const providerRoot = join(repoRoot, PROVIDER_ROOT_PREFIX);
  const dirs: string[] = [];
  await walk(providerRoot, repoRoot, dirs);
  return dirs.sort();
}

export function terraformRootPathsFromPlan(plan?: Pick<InfraPlan, "plannedFiles" | "materializedFiles"> | null) {
  const files = plan?.materializedFiles?.length ? plan.materializedFiles : plan?.plannedFiles || [];
  const dirs = new Set<string>();

  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (!normalized.startsWith(PROVIDER_ROOT_PREFIX) || !normalized.endsWith(".tf")) continue;
    const dir = dirname(normalized).replace(/\\/g, "/");
    if (dir !== "." && dir.startsWith(PROVIDER_ROOT_PREFIX) && !dir.includes("/.terraform")) {
      dirs.add(dir);
    }
  }

  return [...dirs].sort();
}

export function validateTerraformRootPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!/^infrastructure\/terraform\/providers\/[^/]+\/[^/]+\/[^/]+$/.test(normalized)) {
    throw new Error("Invalid Terraform root path.");
  }
  return normalized;
}

function latestPlanForRoot(plans: InfraPlan[], rootPath: string) {
  return plans
    .filter((plan) => terraformRootPathsFromPlan(plan).includes(rootPath))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
}

function runsForRoot(runs: SandboxRun[], plans: InfraPlan[], rootPath: string) {
  return runs
    .filter((run) => {
      if (run.rootPath) return run.rootPath === rootPath;
      const plan = run.planId ? plans.find((item) => item.id === run.planId) : undefined;
      return terraformRootPathsFromPlan(plan).includes(rootPath);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function rootApplied(runs: SandboxRun[]) {
  const mutation = runs
    .filter((run) => run.status === "succeeded" && (run.mode === "terraform-apply" || run.mode === "terraform-destroy"))
    .at(-1);
  return mutation?.mode === "terraform-apply";
}

async function walk(dir: string, repoRoot: string, roots: string[]) {
  let children: string[];
  try {
    children = await readdir(dir);
  } catch {
    return;
  }

  const hasTf = await directoryHasTerraformFiles(dir);
  if (hasTf) {
    const path = relative(repoRoot, dir).split(sep).join("/");
    if (/^infrastructure\/terraform\/providers\/[^/]+\/[^/]+\/[^/]+$/.test(path)) roots.push(path);
    return;
  }

  for (const child of children) {
    if (child === ".terraform") continue;
    const full = join(dir, child);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, repoRoot, roots);
  }
}

async function directoryHasTerraformFiles(dir: string) {
  try {
    const children = await readdir(dir);
    return children.some((child) => child.endsWith(".tf"));
  } catch {
    return false;
  }
}

async function readStateSummary(repoRoot: string, rootPath: string) {
  const statePath = join(repoRoot, rootPath, "terraform.tfstate");
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as { resources?: Array<{ type?: string; name?: string; mode?: string }> };
    const resources = (parsed.resources || [])
      .filter((resource) => resource.mode !== "data")
      .map((resource) => `${resource.type || "resource"}.${resource.name || "unnamed"}`)
      .sort();
    return { resources };
  } catch {
    return { resources: [] as string[] };
  }
}

async function backendType(repoRoot: string, rootPath: string): Promise<TerraformRoot["backend"]> {
  try {
    const files = await readdir(join(repoRoot, rootPath));
    const contents = await Promise.all(
      files
        .filter((file) => file.endsWith(".tf"))
        .map((file) => readFile(join(repoRoot, rootPath, file), "utf8").catch(() => ""))
    );
    if (contents.some((content) => /backend\s+"[^"]+"\s*\{/.test(content))) return "remote";
    if (await pathExists(join(repoRoot, rootPath, "terraform.tfstate"))) return "local";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeProvider(value: string | undefined): CloudProvider {
  if (value === "aws" || value === "azure" || value === "gcp") return value;
  return "azure";
}

export function safeWorkspacePath(root: string, path: string) {
  const target = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Invalid workspace path.");
  }
  return target;
}

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { workspaceRepoRoot } from "./data";
import { buildWorkspaceIgnoreMatcher, isHiddenWorkspaceFile, workspaceGitignore } from "./workspace-ignore.js";
import type { InfraPlan, Workspace, WorkspaceMode } from "./types";

type FileEntry = {
  path: string;
  size: number;
  updatedAt: string;
};

export async function materializePlanFiles(workspace: Workspace, plan: InfraPlan) {
  const root = workspaceRepoRoot(workspace.id);
  const regionPath = slugPathPart(plan.region);
  const providerPath = `infrastructure/terraform/providers/${plan.provider}/${regionPath}`;
  const modulePath = `infrastructure/terraform/modules/${plan.provider}`;
  const clusterModule = plan.cluster.toLowerCase();
  const argocdModule = `${clusterModule}-argocd`;
  const commonPath = `${providerPath}/common`;
  const clusterPath = `${providerPath}/${clusterModule}`;
  const argocdPath = `${providerPath}/${argocdModule}`;
  const overlayPath = `k8s-cluster-configuration/kustomize/platform/core/overlays/${plan.environment}`;

  const files = new Map<string, string>();
  files.set(".gitignore", workspaceGitignore());
  files.set("README.md", repoReadme(workspace, plan));
  files.set("AGENTS.md", agentContract());
  files.set(`${modulePath}/common/main.tf`, terraformCommon(plan));
  files.set(`${modulePath}/common/variables.tf`, terraformVariables(plan));
  files.set(`${modulePath}/common/outputs.tf`, terraformOutputs("network_intent"));
  files.set(`${modulePath}/${clusterModule}/main.tf`, terraformCluster(plan));
  files.set(`${modulePath}/${clusterModule}/variables.tf`, terraformVariables(plan));
  files.set(`${modulePath}/${clusterModule}/outputs.tf`, terraformOutputs("cluster_intent"));
  files.set(`${modulePath}/${argocdModule}/main.tf`, terraformArgocd(plan));
  files.set(`${modulePath}/${argocdModule}/variables.tf`, terraformVariables(plan));
  files.set(`${modulePath}/${argocdModule}/outputs.tf`, terraformOutputs("argocd_intent"));
  files.set(`${commonPath}/main.tf`, providerCallMain(plan, "common", "network"));
  files.set(`${commonPath}/locals.tf`, providerCallLocals(plan));
  files.set(`${commonPath}/outputs.tf`, providerCallOutputs("network", "network_intent"));
  files.set(`${clusterPath}/main.tf`, providerCallMain(plan, clusterModule, "cluster"));
  files.set(`${clusterPath}/locals.tf`, providerCallLocals(plan));
  files.set(`${clusterPath}/outputs.tf`, providerCallOutputs("cluster", "cluster_intent"));
  files.set(`${argocdPath}/main.tf`, providerCallMain(plan, argocdModule, "argocd"));
  files.set(`${argocdPath}/locals.tf`, providerCallLocals(plan));
  files.set(`${argocdPath}/outputs.tf`, providerCallOutputs("argocd", "argocd_intent"));
  files.set(`${overlayPath}/kustomization.yaml`, kustomization(plan));
  files.set(`${overlayPath}/platform-applications.yaml`, platformApplications(plan));
  files.set(`${overlayPath}/policies.yaml`, policies(plan));
  files.set("sandbox-notes.md", sandboxNotes(plan));

  const written: string[] = [];
  for (const [path, content] of files.entries()) {
    const target = safeJoin(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    written.push(path);
  }

  return written;
}

export async function listWorkspaceFiles(workspaceId: string, mode: WorkspaceMode = "infra"): Promise<FileEntry[]> {
  const root = workspaceRepoRoot(workspaceId, mode);
  const entries: FileEntry[] = [];
  const isIgnored = await workspaceIgnoreMatcher(root);
  await walk(root, root, entries, isIgnored);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readWorkspaceFile(workspaceId: string, path: string, mode: WorkspaceMode = "infra") {
  const root = workspaceRepoRoot(workspaceId, mode);
  const isIgnored = await workspaceIgnoreMatcher(root);
  if (isIgnored(path)) throw new Error("Hidden workspace file.");
  const target = safeJoin(root, path);
  return readFile(target, "utf8");
}

async function walk(root: string, dir: string, entries: FileEntry[], isIgnored: (path: string) => boolean) {
  let children: string[];
  try {
    children = await readdir(dir);
  } catch {
    return;
  }

  for (const child of children) {
    const full = join(dir, child);
    const relativePath = relative(root, full).split(sep).join("/");
    if (isIgnored(relativePath)) continue;
    const info = await stat(full);
    if (info.isDirectory()) {
      await walk(root, full, entries, isIgnored);
      continue;
    }
    entries.push({
      path: relativePath,
      size: info.size,
      updatedAt: info.mtime.toISOString()
    });
  }
}

async function workspaceIgnoreMatcher(root: string): Promise<(path: string) => boolean> {
  try {
    const content = await readFile(join(root, ".gitignore"), "utf8");
    return buildWorkspaceIgnoreMatcher(content);
  } catch {
    return isHiddenWorkspaceFile;
  }
}

function safeJoin(root: string, path: string) {
  const target = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Invalid workspace file path.");
  }
  return target;
}

function repoReadme(workspace: Workspace, plan: InfraPlan) {
  return `# ${workspace.companyName} Infrastructure Workspace

Generated by A2W Infra Agent.

## Current Plan

- Title: ${plan.title}
- Provider: ${plan.providerLabel}
- Cluster: ${plan.cluster}
- Environment: ${plan.environment}
- Region: ${plan.region}
- Risk: ${plan.risk}
- Status: ${plan.status}

## Summary

${plan.summary}

## Boundary

Terraform owns cloud primitives and initial Argo CD bootstrap. GitOps owns ongoing Kubernetes platform configuration and workloads.

This repository follows the DStack-style Terraform boundary:

- Resource implementation lives in \`infrastructure/terraform/modules/<provider>/<module>\`.
- Deployable call directories live in \`infrastructure/terraform/providers/<provider>/<region>/<stack>\`.
- Terraform is initialized and applied from a call directory only.
- Terraform state is scoped to the call directory, not to the whole repository and not to a chat.
`;
}

function agentContract() {
  return `# Agent Contract

- Use Terraform for remote state, networks, managed Kubernetes, identity, and initial Argo CD bootstrap only.
- Use Argo CD and Kustomize for ongoing Kubernetes platform and workload configuration.
- Do not store cloud secrets in this repository.
- Maintain one shared workspace repository. Chats share files and Codex context, but they do not own Terraform state.
- Put resource logic in \`infrastructure/terraform/modules/<provider>/<module>\`.
- Put provider initialization, concrete locals, module calls, and module outputs in \`infrastructure/terraform/providers/<provider>/<region>/<stack>\`.
- Treat each provider stack directory as its own Terraform state boundary.
- Run sandbox validation before approval.
- Production and destructive changes require explicit risk review.
`;
}

function terraformHeader(plan: InfraPlan) {
  return `terraform {
  required_version = ">= 1.5.0"
}

locals {
  provider    = "${plan.provider}"
  environment = var.environment
  region      = var.region
  cluster     = var.cluster
}
`;
}

function terraformCommon(plan: InfraPlan) {
  return `${terraformHeader(plan)}

locals {
  network = {
    name              = "a2w-\${local.environment}-network"
    private_subnets   = true
    managed_nat       = true
    public_workers    = false
    platform_boundary = "terraform-cloud-primitives"
  }
}

resource "terraform_data" "network_intent" {
  input = local.network
}
`;
}

function terraformCluster(plan: InfraPlan) {
  return `${terraformHeader(plan)}

locals {
  cluster_intent = {
    name                 = "a2w-\${local.environment}-\${lower(local.cluster)}"
    managed_kubernetes   = local.cluster
    private_endpoint     = true
    oidc_identity        = true
    system_node_pool     = "system"
    workload_node_pool   = "workload"
    high_availability    = ${plan.environment === "production" ? "true" : "false"}
    platform_boundary    = "terraform-kubernetes-cluster"
  }
}

resource "terraform_data" "cluster_intent" {
  input = local.cluster_intent
}
`;
}

function terraformArgocd(plan: InfraPlan) {
  return `${terraformHeader(plan)}

locals {
  argocd = {
    namespace          = "argocd"
    chart              = "argo-cd"
    bootstrap_only     = true
    ongoing_owner      = "gitops"
    platform_boundary  = "terraform-argocd-bootstrap"
  }
}

resource "terraform_data" "argocd_intent" {
  input = local.argocd
}
`;
}

function terraformVariables(plan: InfraPlan) {
  return `variable "region" {
  type        = string
  description = "Cloud region for ${plan.providerLabel}."
  default     = "${plan.region}"
}

variable "environment" {
  type        = string
  description = "Deployment environment."
  default     = "${plan.environment}"
}

variable "cluster" {
  type        = string
  description = "Cluster or stack family."
  default     = "${plan.cluster}"
}
`;
}

function providerCallMain(plan: InfraPlan, moduleName: string, alias: string) {
  return `terraform {
  required_version = ">= 1.5.0"
}

module "${alias}" {
  source = "../../../../modules/${plan.provider}/${moduleName}"

  region      = local.region
  environment = local.environment
  cluster     = local.cluster
}
`;
}

function providerCallLocals(plan: InfraPlan) {
  return `locals {
  provider    = "${plan.provider}"
  environment = "${plan.environment}"
  region      = "${plan.region}"
  cluster     = "${plan.cluster}"
}
`;
}

function providerCallOutputs(alias: string, outputName: string) {
  return `output "${outputName}" {
  description = "Intent output emitted by the ${alias} module."
  value       = module.${alias}.intent
}
`;
}

function terraformOutputs(resourceName: string) {
  return `output "intent" {
  description = "Safe placeholder intent used by the sandbox validator."
  value       = terraform_data.${resourceName}.output
}
`;
}

function kustomization(plan: InfraPlan) {
  return `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: platform-system
resources:
  - platform-applications.yaml
  - policies.yaml
commonLabels:
  a2w.ai/workspace-plan: ${plan.id}
  a2w.ai/environment: ${plan.environment}
`;
}

function platformApplications(plan: InfraPlan) {
  return `apiVersion: v1
kind: Namespace
metadata:
  name: platform-system
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: platform-core-${plan.environment}
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://example.invalid/customer-platform.git
    targetRevision: HEAD
    path: k8s-cluster-configuration/kustomize/platform/core/overlays/${plan.environment}
  destination:
    server: https://kubernetes.default.svc
    namespace: platform-system
  syncPolicy:
    automated:
      prune: false
      selfHeal: true
`;
}

function policies(plan: InfraPlan) {
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: a2w-platform-policy
  namespace: platform-system
data:
  provider: "${plan.provider}"
  cluster: "${plan.cluster}"
  environment: "${plan.environment}"
  direct_cluster_mutation: "blocked"
  static_cloud_keys: "blocked"
  approval_required: "true"
`;
}

function sandboxNotes(plan: InfraPlan) {
  return `# Sandbox Notes

Run validation inside Podman before approval:

\`\`\`sh
podman run --rm --network=none -v "$PWD:/workspace:Z" -w /workspace a2w-infra-sandbox:latest /sandbox/validate.sh
\`\`\`

The generated Terraform uses DStack-style modules with \`terraform_data\` as safe intent placeholders. Real resources should be added inside \`infrastructure/terraform/modules/<provider>/<module>\`; provider call directories should only initialize Terraform, set concrete locals, call modules, and expose module outputs.
`;
}

function slugPathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default-region";
}

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { workspaceRepoRoot } from "./data";
import type { PolicyCheck } from "./types";

type TerraformFile = {
  path: string;
  content: string;
};

export async function runPolicyChecks(workspaceId: string, rootPath: string): Promise<PolicyCheck[]> {
  const root = workspaceRepoRoot(workspaceId);
  const target = safeJoin(root, rootPath);
  const files = await readTerraformFiles(root, target);
  const combined = files.map((file) => file.content).join("\n");
  const providerRootFiles = files.filter((file) => dirname(file.path).replace(/\\/g, "/") === rootPath);

  return [
    providerLayoutCheck(rootPath, providerRootFiles),
    providerRootResourceCheck(providerRootFiles),
    hardcodedSecretCheck(combined),
    backendCheck(combined),
    tagsCheck(combined),
    destructiveGuardCheck(rootPath)
  ];
}

function providerLayoutCheck(rootPath: string, files: TerraformFile[]): PolicyCheck {
  const valid = /^infrastructure\/terraform\/providers\/[^/]+\/[^/]+\/[^/]+$/.test(rootPath);
  const hasModuleCall = files.some((file) => /module\s+"[^"]+"\s*\{/.test(file.content));
  if (valid && hasModuleCall) {
    return {
      id: "provider-layout",
      label: "Provider root layout",
      severity: "info",
      status: "pass",
      detail: "Root is in the expected providers/<provider>/<region>/<stack> shape and calls at least one module."
    };
  }
  return {
    id: "provider-layout",
    label: "Provider root layout",
    severity: "error",
    status: "fail",
    detail: "Terraform roots should live under infrastructure/terraform/providers/<provider>/<region>/<stack> and call modules from infrastructure/terraform/modules."
  };
}

function providerRootResourceCheck(files: TerraformFile[]): PolicyCheck {
  const directResources = files
    .filter((file) => /(^|\n)\s*resource\s+"[^"]+"\s+"[^"]+"\s*\{/.test(file.content))
    .map((file) => file.path);

  if (!directResources.length) {
    return {
      id: "module-boundary",
      label: "Module boundary",
      severity: "info",
      status: "pass",
      detail: "Provider root does not define direct resources; resource logic stays in reusable modules."
    };
  }

  return {
    id: "module-boundary",
    label: "Module boundary",
    severity: "warning",
    status: "warn",
    detail: `Provider root declares resources directly in ${directResources.join(", ")}. Prefer moving resource logic into a module and calling it from this root.`
  };
}

function hardcodedSecretCheck(content: string): PolicyCheck {
  const suspicious = [
    /client_secret\s*=\s*"[^"$][^"]{8,}"/i,
    /secret_key\s*=\s*"[^"$][^"]{8,}"/i,
    /access_key\s*=\s*"[^"$][^"]{8,}"/i,
    /password\s*=\s*"[^"$][^"]{8,}"/i,
    /private_key\s*=\s*"-----BEGIN/i
  ];
  const failed = suspicious.some((pattern) => pattern.test(content));
  return {
    id: "hardcoded-secrets",
    label: "Hardcoded secrets",
    severity: failed ? "error" : "info",
    status: failed ? "fail" : "pass",
    detail: failed
      ? "A Terraform file appears to contain a static secret value. Move secrets to provider credentials or a secret manager."
      : "No obvious static secret values were found in this root."
  };
}

function backendCheck(content: string): PolicyCheck {
  const hasBackend = /backend\s+"[^"]+"\s*\{/.test(content);
  return {
    id: "remote-backend",
    label: "Remote backend",
    severity: hasBackend ? "info" : "warning",
    status: hasBackend ? "pass" : "warn",
    detail: hasBackend
      ? "A Terraform backend block is configured for this root."
      : "No backend block found. Local state is acceptable for MVP/dev, but teams should use remote state before shared environments."
  };
}

function tagsCheck(content: string): PolicyCheck {
  const hasTags = /tags\s*=\s*\{/.test(content) || /default_tags\s*\{/.test(content);
  return {
    id: "tags",
    label: "Resource tags",
    severity: hasTags ? "info" : "warning",
    status: hasTags ? "pass" : "warn",
    detail: hasTags
      ? "Tag configuration is present in this root or provider."
      : "No tag block found. Company Terraform should tag owner, environment, cost center, and managed-by."
  };
}

function destructiveGuardCheck(rootPath: string): PolicyCheck {
  const productionLike = /(^|\/)(prod|production)(\/|$)/i.test(rootPath);
  return {
    id: "destructive-guard",
    label: "Destructive guard",
    severity: productionLike ? "warning" : "info",
    status: productionLike ? "warn" : "pass",
    detail: productionLike
      ? "This looks production-like. Destroy/apply should require explicit approval and ideally PR review."
      : "This root does not look production-like; UI approval is still required for apply/destroy."
  };
}

async function readTerraformFiles(root: string, dir: string) {
  const files: TerraformFile[] = [];
  await walkTerraform(root, dir, files);
  return files;
}

async function walkTerraform(root: string, dir: string, files: TerraformFile[]) {
  let children: string[];
  try {
    children = await readdir(dir);
  } catch {
    return;
  }

  for (const child of children) {
    if (child === ".terraform") continue;
    const full = join(dir, child);
    const info = await stat(full);
    if (info.isDirectory()) {
      await walkTerraform(root, full, files);
      continue;
    }
    if (!child.endsWith(".tf")) continue;
    files.push({
      path: relative(root, full).split(sep).join("/"),
      content: await readFile(full, "utf8")
    });
  }
}

function safeJoin(root: string, path: string) {
  const target = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Invalid workspace path.");
  }
  return target;
}

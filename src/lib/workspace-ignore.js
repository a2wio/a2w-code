export function workspaceGitignore() {
  return `# Terraform runtime artifacts
.terraform/
**/.terraform/
.terraform.lock.hcl
**/.terraform.lock.hcl
terraform.tfstate
terraform.tfstate.*
*.tfstate
*.tfstate.*
*.tfplan
*.tfvars.local
crash.log
crash.*.log

# Local machine noise
.DS_Store
`;
}

/** @param {string} path */
export function isHiddenWorkspaceFile(path) {
  const parts = path.split("/");
  if (parts.some((part) => part === ".terraform" || part === ".git" || part === "node_modules")) return true;
  const name = parts.at(-1) || path;
  if (name === ".terraform.lock.hcl") return true;
  if (name === "terraform.tfstate" || name.startsWith("terraform.tfstate.")) return true;
  if (name.endsWith(".tfstate") || name.includes(".tfstate.")) return true;
  if (name.endsWith(".tfplan")) return true;
  if (name.endsWith(".tfvars.local")) return true;
  if (name === "crash.log" || /^crash\..+\.log$/.test(name)) return true;
  if (name === ".DS_Store") return true;
  return false;
}

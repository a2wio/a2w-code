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

/** @param {string} content */
export function buildWorkspaceIgnoreMatcher(content = "") {
  const rules = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseIgnoreRule)
    .filter(Boolean);

  /** @param {string} path */
  return function isIgnored(path) {
    if (isHiddenWorkspaceFile(path)) return true;

    let ignored = false;
    for (const rule of rules) {
      if (matchesIgnoreRule(path, rule)) ignored = !rule.negative;
    }
    return ignored;
  };
}

/** @param {string} line */
function parseIgnoreRule(line) {
  let pattern = line;
  const negative = pattern.startsWith("!");
  if (negative) pattern = pattern.slice(1);
  if (!pattern || pattern === "/") return null;

  pattern = pattern.replace(/^\.\//, "");
  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  const hasSlash = pattern.includes("/");
  if (!pattern) return null;

  return {
    pattern,
    negative,
    directoryOnly,
    anchored,
    hasSlash,
    regex: globToRegExp(pattern)
  };
}

function matchesIgnoreRule(path, rule) {
  const normalized = path.replace(/^\/+/, "");
  const parts = normalized.split("/");
  const name = parts.at(-1) || normalized;

  if (!rule.hasSlash) {
    return parts.some((part, index) => {
      if (!rule.regex.test(part)) return false;
      return !rule.directoryOnly || index < parts.length - 1 || normalized === part;
    });
  }

  if (rule.anchored) {
    if (rule.regex.test(normalized)) return true;
    return rule.directoryOnly && normalized.startsWith(`${rule.pattern}/`);
  }

  if (rule.regex.test(normalized) || rule.regex.test(name)) return true;
  return rule.directoryOnly && normalized.includes(`/${rule.pattern}/`);
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { workspaceRepoRoot } from "./data";
import type { GitAuthMethod, GitProvider, GitRepositoryMode, GitWorkspaceStatus, WorkspaceDiffFile } from "./types";

const execFileAsync = promisify(execFile);

type CommandError = NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
  code?: number;
};

export type SetupWorkspaceRepositoryInput = {
  gitProvider?: GitProvider;
  mode: GitRepositoryMode;
  repositoryUrl?: string;
  repositoryName?: string;
  repositoryOwner?: string;
  branch?: string;
  authMethod: GitAuthMethod;
  username?: string;
  token?: string;
  sshPrivateKey?: string;
};

const DSTACK_REPOSITORY_URL = "https://github.com/kubeden/dstack.git";

export async function getGitStatus(workspaceId: string): Promise<GitWorkspaceStatus> {
  const repoRoot = workspaceRepoRoot(workspaceId);
  const localRepositoryName = basename(repoRoot);
  if (!(await gitAvailable())) {
    return { available: false, initialized: false, repositoryName: localRepositoryName, clean: true, files: [], message: "git is not available on PATH." };
  }

  if (!(await isGitRepository(repoRoot))) {
    return {
      available: true,
      initialized: false,
      repositoryName: localRepositoryName,
      clean: true,
      files: [],
      message: "Workspace Git repository is not initialized yet."
    };
  }

  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim() || "detached").catch(() => "unknown");
  const remoteOrigin = await git(repoRoot, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => "");
  const porcelain = await git(repoRoot, ["status", "--short"]).catch(() => "");
  const files = await Promise.all(parseStatus(porcelain).map((item) => diffForFile(repoRoot, item)));

  return {
    available: true,
    initialized: true,
    repositoryName: repositoryName(remoteOrigin) || localRepositoryName,
    remoteUrl: remoteOrigin,
    branch,
    clean: files.length === 0,
    files
  };
}

export async function initializeGit(workspaceId: string) {
  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await gitAvailable())) throw new Error("git is not available on PATH.");
  if (await isGitRepository(repoRoot)) return getGitStatus(workspaceId);
  await git(repoRoot, ["init"]);
  await ensureGitIdentity(repoRoot);
  return getGitStatus(workspaceId);
}

export async function setupWorkspaceRepository(workspaceId: string, input: SetupWorkspaceRepositoryInput) {
  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await gitAvailable())) throw new Error("git is not available on PATH.");
  if (await isGitRepository(repoRoot)) return getGitStatus(workspaceId);

  await assertRepositoryRootIsEmpty(repoRoot);
  if (input.mode === "dstack") {
    await setupDstackRepository(repoRoot, input);
    await ensureGitIdentity(repoRoot);
    return getGitStatus(workspaceId);
  }

  const sourceUrl = cleanRepositoryUrl(input.repositoryUrl);
  const cloneArgs = ["clone", ...(input.branch ? ["--branch", input.branch] : []), sourceUrl, repoRoot];
  await withGitAuth(input, async (env) => {
    await gitGlobal(cloneArgs, env, 120_000);
  });
  await ensureGitIdentity(repoRoot);
  return getGitStatus(workspaceId);
}

export async function commitWorkspace(workspaceId: string, message: string) {
  const cleanMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanMessage) throw new Error("Commit message is required.");

  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await isGitRepository(repoRoot))) await initializeGit(workspaceId);
  await ensureGitIdentity(repoRoot);
  await git(repoRoot, ["add", "-A"]);

  const status = await git(repoRoot, ["status", "--short"]);
  if (!status.trim()) throw new Error("No workspace changes to commit.");

  await git(repoRoot, ["commit", "-m", cleanMessage]);
  return getGitStatus(workspaceId);
}

async function setupDstackRepository(repoRoot: string, input: SetupWorkspaceRepositoryInput) {
  const remoteUrl = await dstackTargetRepositoryUrl(input);
  await gitGlobal(["clone", DSTACK_REPOSITORY_URL, repoRoot], { GIT_TERMINAL_PROMPT: "0" }, 120_000);
  await git(repoRoot, ["remote", "set-url", "origin", remoteUrl]);
  if (input.branch?.trim()) {
    await git(repoRoot, ["checkout", "-B", input.branch.trim()]);
  }
  await ensureGitIdentity(repoRoot);
  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim() || "main").catch(() => "main");
  await withGitAuth(input, async (env) => {
    await gitWithEnv(repoRoot, ["push", "-u", "origin", branch], env, 120_000);
  });
}

async function dstackTargetRepositoryUrl(input: SetupWorkspaceRepositoryInput) {
  const explicitUrl = String(input.repositoryUrl || "").trim();
  if (explicitUrl) return explicitUrl;

  if (input.gitProvider === "github" && input.authMethod === "token") {
    if (!input.token?.trim()) throw new Error("Creating a GitHub repository requires an HTTPS Git token.");
    return createGithubRepository(input.token.trim(), input.repositoryName || "a2w-infrastructure", input.repositoryOwner);
  }

  throw new Error("A remote repository URL is required for A2W best-practice imports unless GitHub token-based repository creation is used.");
}

async function createGithubRepository(token: string, repositoryName: string, repositoryOwner?: string) {
  const cleanName = repositoryName.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(cleanName)) {
    throw new Error("GitHub repository name can contain only letters, numbers, dots, dashes, and underscores.");
  }
  const cleanOwner = String(repositoryOwner || "").trim();
  if (cleanOwner && !/^[A-Za-z0-9_.-]+$/.test(cleanOwner)) {
    throw new Error("GitHub organization can contain only letters, numbers, dots, dashes, and underscores.");
  }

  const response = await fetch(cleanOwner ? `https://api.github.com/orgs/${cleanOwner}/repos` : "https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28"
    },
    body: JSON.stringify({ name: cleanName, private: true, auto_init: false })
  });

  const data = await response.json().catch(() => ({})) as { clone_url?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message || `Could not create GitHub repository. HTTP ${response.status}.`);
  }
  if (!data.clone_url) throw new Error("GitHub repository response did not include a clone URL.");
  return data.clone_url;
}

function cleanRepositoryUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!url) throw new Error("Repository URL is required.");
  return url;
}

async function assertRepositoryRootIsEmpty(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true });
  const entries = (await readdir(repoRoot)).filter((entry) => entry !== ".DS_Store");
  if (entries.length) {
    throw new Error("Workspace repository folder is not empty. Reset the workspace or choose a clean repository folder before cloning.");
  }
}

async function withGitAuth<T>(input: SetupWorkspaceRepositoryInput, callback: (env: Record<string, string>) => Promise<T>) {
  if (input.authMethod === "ssh") return withSshKey(input.sshPrivateKey || "", callback);
  if (input.authMethod === "token") return withHttpsToken(input.username || "x-access-token", input.token || "", callback);
  return callback({ GIT_TERMINAL_PROMPT: "0" });
}

async function withSshKey<T>(privateKey: string, callback: (env: Record<string, string>) => Promise<T>) {
  if (!privateKey.trim()) throw new Error("SSH private key is required for SSH Git auth.");
  const dir = await mkdtemp(join(tmpdir(), "a2w-git-"));
  const keyPath = join(dir, "key");
  await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, "utf8");
  await chmod(keyPath, 0o600);
  try {
    return await callback({
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
    });
  } finally {
    await unlink(keyPath).catch(() => undefined);
  }
}

async function withHttpsToken<T>(username: string, token: string, callback: (env: Record<string, string>) => Promise<T>) {
  if (!token.trim()) throw new Error("Git access token is required for HTTPS token auth.");
  const dir = await mkdtemp(join(tmpdir(), "a2w-git-"));
  const askPassPath = join(dir, "askpass.sh");
  await writeFile(
    askPassPath,
    "#!/bin/sh\ncase \"$1\" in\n*Username*) printf '%s\\n' \"$A2W_GIT_USERNAME\" ;;\n*) printf '%s\\n' \"$A2W_GIT_TOKEN\" ;;\nesac\n",
    "utf8"
  );
  await chmod(askPassPath, 0o700);
  try {
    return await callback({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: askPassPath,
      A2W_GIT_USERNAME: username.trim() || "x-access-token",
      A2W_GIT_TOKEN: token
    });
  } finally {
    await unlink(askPassPath).catch(() => undefined);
  }
}

function repositoryName(remoteUrl: string) {
  if (!remoteUrl) return "";
  const normalized = remoteUrl.replace(/\/$/, "").replace(/\.git$/, "");
  const path = normalized.includes(":") && !normalized.includes("://")
    ? normalized.split(":").at(-1) || normalized
    : normalized;
  return path.split("/").filter(Boolean).at(-1) || "";
}

async function diffForFile(repoRoot: string, item: { path: string; status: string }): Promise<WorkspaceDiffFile> {
  if (item.status.includes("?")) {
    const diff = await git(repoRoot, ["diff", "--no-index", "--", "/dev/null", item.path]).catch((error: CommandError) => {
      const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
      return output;
    });
    return { ...item, diff };
  }

  const diff = await git(repoRoot, ["diff", "--", item.path]).catch(() => "");
  const cached = await git(repoRoot, ["diff", "--cached", "--", item.path]).catch(() => "");
  return { ...item, diff: [diff, cached].filter(Boolean).join("\n") || "No textual diff available." };
}

function parseStatus(output: string) {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) || rawPath : rawPath;
      return { status, path };
    });
}

async function ensureGitIdentity(repoRoot: string) {
  const name = await git(repoRoot, ["config", "--get", "user.name"]).catch(() => "");
  const email = await git(repoRoot, ["config", "--get", "user.email"]).catch(() => "");
  if (!name.trim()) await git(repoRoot, ["config", "user.name", "A2W-Codex-Terraform-v0.0.1"]);
  if (!email.trim()) await git(repoRoot, ["config", "user.email", "terraform-garden@localhost"]);
}

async function isGitRepository(repoRoot: string) {
  try {
    await stat(join(repoRoot, ".git"));
    await git(repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function gitAvailable() {
  try {
    await execFileAsync("git", ["--version"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function git(repoRoot: string, args: string[]) {
  const result = await execFileAsync("git", args, {
    cwd: repoRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function gitWithEnv(repoRoot: string, args: string[], env: Record<string, string> = {}, timeout = 30_000) {
  const result = await execFileAsync("git", args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    timeout,
    maxBuffer: 1024 * 1024 * 4
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

async function gitGlobal(args: string[], env: Record<string, string> = {}, timeout = 30_000) {
  const result = await execFileAsync("git", args, {
    env: { ...process.env, ...env },
    timeout,
    maxBuffer: 1024 * 1024 * 4
  });
  return `${result.stdout || ""}${result.stderr || ""}`;
}

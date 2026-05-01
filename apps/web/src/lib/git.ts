import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { readData, workspaceRepoRoot } from "./data";
import { decryptSecret } from "./secrets";
import type { GitAuthMethod, GitCommit, GitConnection, GitProvider, GitRepositoryMode, GitStashEntry, GitWorkspaceStatus, WorkspaceDiffFile } from "./types";

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
  const upstream = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");
  const [ahead, behind] = upstream ? await aheadBehind(repoRoot) : [0, 0];
  const head = await gitCommit(repoRoot, "HEAD").catch(() => undefined);
  const porcelain = await git(repoRoot, ["status", "--short", "--untracked-files=all"]).catch(() => "");
  const files = await Promise.all(parseStatus(porcelain).map((item) => diffForFile(repoRoot, item)));

  return {
    available: true,
    initialized: true,
    repositoryName: repositoryName(remoteOrigin) || localRepositoryName,
    remoteUrl: remoteOrigin,
    branch,
    upstream,
    ahead,
    behind,
    head,
    clean: files.length === 0,
    files
  };
}

export async function getGitDetails(workspaceId: string) {
  const status = await getGitStatus(workspaceId);
  if (!status.available || !status.initialized) {
    return { git: status, history: [] as GitCommit[], stashes: [] as GitStashEntry[] };
  }

  const repoRoot = workspaceRepoRoot(workspaceId);
  const [history, stashes] = await Promise.all([
    gitHistory(repoRoot, 40).catch(() => []),
    gitStashes(repoRoot).catch(() => [])
  ]);
  return { git: status, history, stashes };
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

export async function stageWorkspace(workspaceId: string, paths: string[] = []) {
  const repoRoot = await requireGitRepository(workspaceId);
  const safePaths = paths.map(cleanRelativePath);
  await git(repoRoot, safePaths.length ? ["add", "--", ...safePaths] : ["add", "-A"]);
  return getGitDetails(workspaceId);
}

export async function unstageWorkspace(workspaceId: string, paths: string[] = []) {
  const repoRoot = await requireGitRepository(workspaceId);
  const safePaths = paths.map(cleanRelativePath);
  await git(repoRoot, safePaths.length ? ["restore", "--staged", "--", ...safePaths] : ["restore", "--staged", "."]);
  return getGitDetails(workspaceId);
}

export async function discardWorkspaceFile(workspaceId: string, path: string, confirm: string) {
  if (confirm !== "DISCARD") throw new Error("Type DISCARD to discard a file.");
  const repoRoot = await requireGitRepository(workspaceId);
  const safePath = cleanRelativePath(path);
  await git(repoRoot, ["restore", "--staged", "--worktree", "--", safePath]).catch(async () => {
    await git(repoRoot, ["clean", "-fd", "--", safePath]);
  });
  return getGitDetails(workspaceId);
}

export async function resetWorkspaceChanges(workspaceId: string, confirm: string) {
  if (confirm !== "RESET") throw new Error("Type RESET to discard all workspace changes.");
  const repoRoot = await requireGitRepository(workspaceId);
  const hasHead = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]).then(() => true).catch(() => false);
  if (hasHead) {
    await git(repoRoot, ["reset", "--hard"]);
  } else {
    await git(repoRoot, ["rm", "-r", "--cached", "."], 30_000).catch(() => undefined);
  }
  await git(repoRoot, ["clean", "-fd"]);
  return getGitDetails(workspaceId);
}

export async function commitWorkspace(workspaceId: string, message: string, mode: "all" | "staged" = "all") {
  const cleanMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanMessage) throw new Error("Commit message is required.");

  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await isGitRepository(repoRoot))) await initializeGit(workspaceId);
  await ensureGitIdentity(repoRoot);
  if (mode === "all") await git(repoRoot, ["add", "-A"]);

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) throw new Error(mode === "staged" ? "No staged changes to commit." : "No workspace changes to commit.");

  await git(repoRoot, ["commit", "-m", cleanMessage]);
  return getGitDetails(workspaceId);
}

export async function pushWorkspace(workspaceId: string) {
  const repoRoot = await requireGitRepository(workspaceId);
  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => "");
  if (!branch) throw new Error("Cannot push from a detached HEAD. Create or checkout a branch first.");
  const upstream = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");
  await withWorkspaceGitAuth(workspaceId, async (env) => {
    await gitWithEnv(repoRoot, upstream ? ["push"] : ["push", "-u", "origin", branch], env, 120_000);
  });
  return getGitDetails(workspaceId);
}

export async function createBranchFromHead(workspaceId: string, branchName: string) {
  const repoRoot = await requireGitRepository(workspaceId);
  const branch = cleanGitBranchName(branchName);
  await git(repoRoot, ["checkout", "-b", branch]);
  return getGitDetails(workspaceId);
}

export async function mergeCurrentBranch(workspaceId: string, input: { targetBranch: string; push?: boolean }) {
  const repoRoot = await requireGitRepository(workspaceId);
  const sourceBranch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => "");
  if (!sourceBranch) throw new Error("Cannot merge from a detached HEAD. Create or checkout a branch first.");
  if (!(await isWorkingTreeClean(repoRoot))) throw new Error("Commit or stash workspace changes before merging.");

  const targetBranch = cleanGitBranchName(input.targetBranch || "main");
  if (sourceBranch === targetBranch) throw new Error("Source and target branch are the same.");

  const remoteOrigin = await git(repoRoot, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => "");
  if (remoteOrigin) {
    await withWorkspaceGitAuth(workspaceId, async (env) => {
      await gitWithEnv(repoRoot, ["fetch", "origin", targetBranch], env, 120_000).catch(() => undefined);
    });
  }

  await git(repoRoot, ["checkout", targetBranch]).catch(async () => {
    if (!remoteOrigin) throw new Error(`Target branch ${targetBranch} does not exist locally.`);
    await git(repoRoot, ["checkout", "-B", targetBranch, `origin/${targetBranch}`]);
  });
  await git(repoRoot, ["merge", "--no-ff", sourceBranch, "-m", `Merge branch '${sourceBranch}' into ${targetBranch}`], 120_000);

  if (input.push) {
    await withWorkspaceGitAuth(workspaceId, async (env) => {
      await gitWithEnv(repoRoot, ["push", "-u", "origin", targetBranch], env, 120_000);
    });
  }

  return getGitDetails(workspaceId);
}

export async function stashWorkspace(workspaceId: string, input: { includeUntracked?: boolean; message?: string } = {}) {
  const repoRoot = await requireGitRepository(workspaceId);
  if (await isWorkingTreeClean(repoRoot)) throw new Error("There are no changes to stash.");
  const message = input.message?.replace(/\s+/g, " ").trim() || "A2W workspace stash";
  await git(repoRoot, ["stash", "push", ...(input.includeUntracked ? ["--include-untracked"] : []), "-m", message]);
  return getGitDetails(workspaceId);
}

export async function applyStash(workspaceId: string, index: number, mode: "apply" | "pop" = "apply") {
  const repoRoot = await requireGitRepository(workspaceId);
  const ref = stashRef(index);
  await git(repoRoot, ["stash", mode, ref]);
  return getGitDetails(workspaceId);
}

export async function dropStash(workspaceId: string, index: number, confirm: string) {
  if (confirm !== "DROP") throw new Error("Type DROP to delete a stash.");
  const repoRoot = await requireGitRepository(workspaceId);
  await git(repoRoot, ["stash", "drop", stashRef(index)]);
  return getGitDetails(workspaceId);
}

export async function checkoutGitRef(workspaceId: string, input: { ref: string; stashBefore?: boolean; createBranch?: string }) {
  const repoRoot = await requireGitRepository(workspaceId);
  const ref = cleanGitRef(input.ref);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  const branch = input.createBranch?.trim();
  if (branch) {
    await git(repoRoot, ["checkout", "-b", cleanGitBranchName(branch), ref]);
  } else {
    await git(repoRoot, ["checkout", ref]);
  }
  return getGitDetails(workspaceId);
}

export async function revertCommit(workspaceId: string, input: { ref: string; stashBefore?: boolean }) {
  const repoRoot = await requireGitRepository(workspaceId);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  await git(repoRoot, ["revert", "--no-edit", cleanGitRef(input.ref)]);
  return getGitDetails(workspaceId);
}

export async function resetToCommit(workspaceId: string, input: { ref: string; confirm: string; stashBefore?: boolean }) {
  if (input.confirm !== "RESET") throw new Error("Type RESET to hard reset the repository.");
  const repoRoot = await requireGitRepository(workspaceId);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  await git(repoRoot, ["reset", "--hard", cleanGitRef(input.ref)]);
  return getGitDetails(workspaceId);
}

async function requireGitRepository(workspaceId: string) {
  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await gitAvailable())) throw new Error("git is not available on PATH.");
  if (!(await isGitRepository(repoRoot))) throw new Error("Workspace Git repository is not initialized yet.");
  return repoRoot;
}

async function ensureCleanOrStash(repoRoot: string, stashBefore = false) {
  if (await isWorkingTreeClean(repoRoot)) return;
  if (!stashBefore) {
    throw new Error("Working tree has uncommitted changes. Stash or commit before changing history.");
  }
  await git(repoRoot, ["stash", "push", "--include-untracked", "-m", "A2W auto-stash before Git history action"]);
}

async function isWorkingTreeClean(repoRoot: string) {
  const status = await git(repoRoot, ["status", "--short", "--untracked-files=all"]).catch(() => "");
  return !status.trim();
}

async function hasStagedChanges(repoRoot: string) {
  try {
    await git(repoRoot, ["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    return true;
  }
}

function cleanRelativePath(path: string) {
  const clean = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean || clean.includes("..") || clean.startsWith(".git/")) throw new Error("Invalid Git path.");
  return clean;
}

function cleanGitRef(ref: string) {
  const clean = String(ref || "").trim();
  if (!/^[A-Za-z0-9._/@{}:-]+$/.test(clean)) throw new Error("Invalid Git ref.");
  return clean;
}

function cleanGitBranchName(branch: string) {
  const clean = String(branch || "").trim();
  if (!clean) throw new Error("Branch name is required.");
  if (
    clean.startsWith("-") ||
    clean.startsWith("/") ||
    clean.endsWith("/") ||
    clean.includes("..") ||
    clean.includes("//") ||
    clean.includes("@{") ||
    /[\s~^:?*[\\]/.test(clean)
  ) {
    throw new Error("Branch name contains unsupported characters.");
  }
  return clean;
}

function stashRef(index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error("Valid stash index is required.");
  return `stash@{${index}}`;
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

async function aheadBehind(repoRoot: string): Promise<[number, number]> {
  const output = await git(repoRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).catch(() => "0\t0");
  const [aheadRaw, behindRaw] = output.trim().split(/\s+/);
  return [Number(aheadRaw || 0), Number(behindRaw || 0)];
}

async function gitHistory(repoRoot: string, limit: number): Promise<GitCommit[]> {
  const output = await git(repoRoot, [
    "log",
    `-${limit}`,
    "--branches",
    "--remotes",
    "--tags",
    "--reflog",
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cr%x1f%D%x1f%s%x1e"
  ]).catch(() => "");
  return parseGitCommitRecords(output);
}

async function gitCommit(repoRoot: string, ref: string): Promise<GitCommit | undefined> {
  const output = await git(repoRoot, [
    "show",
    "-s",
    "--date=iso-strict",
    "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cr%x1f%D%x1f%s%x1e",
    ref
  ]).catch(() => "");
  return parseGitCommitRecords(output)[0];
}

function parseGitCommitRecords(output: string): GitCommit[] {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", shortHash = "", parents = "", authorName = "", authorEmail = "", createdAt = "", relativeTime = "", refs = "", subject = ""] = record.split("\x1f");
      return {
        hash,
        shortHash,
        parents: parents.split(" ").map((item) => item.trim()).filter(Boolean),
        authorName,
        authorEmail,
        createdAt,
        relativeTime,
        refs: refs.split(",").map((item) => item.trim()).filter(Boolean),
        subject
      };
    });
}

async function gitStashes(repoRoot: string): Promise<GitStashEntry[]> {
  const output = await git(repoRoot, ["stash", "list", "--format=%gd%x1f%cr%x1f%gs%x1e"]).catch(() => "");
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [name = "", relativeTime = "", message = ""] = record.split("\x1f");
      const index = Number(name.match(/\{(\d+)\}/)?.[1] || 0);
      return { index, name, relativeTime, message };
    });
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

async function withWorkspaceGitAuth<T>(workspaceId: string, callback: (env: Record<string, string>) => Promise<T>) {
  const data = await readData();
  const connection = data.gitConnections
    .filter((item) => item.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!connection) return callback({ GIT_TERMINAL_PROMPT: "0", ...defaultSshEnv() });
  return withGitConnectionAuth(connection, callback);
}

async function withGitConnectionAuth<T>(connection: GitConnection, callback: (env: Record<string, string>) => Promise<T>) {
  if (connection.authMethod === "ssh" && connection.secrets?.sshPrivateKey) {
    return withSshKey(decryptSecret(connection.secrets.sshPrivateKey), callback);
  }
  if (connection.authMethod === "token" && connection.secrets?.token) {
    return withHttpsToken(connection.details.username || "x-access-token", decryptSecret(connection.secrets.token), callback);
  }
  return callback({ GIT_TERMINAL_PROMPT: "0", ...defaultSshEnv() });
}

async function withSshKey<T>(privateKey: string, callback: (env: Record<string, string>) => Promise<T>) {
  if (!privateKey.trim()) throw new Error("SSH private key is required for SSH Git auth.");
  const dir = await mkdtemp(join(tmpdir(), "a2w-git-"));
  const keyPath = join(dir, "key");
  const knownHostsPath = join(dir, "known_hosts");
  await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : `${privateKey}\n`, "utf8");
  await writeFile(knownHostsPath, "", "utf8");
  await chmod(keyPath, 0o600);
  try {
    return await callback({
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${knownHostsPath}`
    });
  } finally {
    await unlink(keyPath).catch(() => undefined);
    await unlink(knownHostsPath).catch(() => undefined);
  }
}

function defaultSshEnv() {
  return {
    GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new"
  };
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

async function diffForFile(repoRoot: string, item: { path: string; status: string; indexStatus?: string; worktreeStatus?: string }): Promise<WorkspaceDiffFile> {
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
      const rawStatus = line.slice(0, 2);
      const status = rawStatus.trim() || rawStatus;
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) || rawPath : rawPath;
      return {
        status,
        indexStatus: rawStatus[0]?.trim() || "",
        worktreeStatus: rawStatus[1]?.trim() || "",
        path
      };
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

async function git(repoRoot: string, args: string[], timeout = 30_000) {
  const result = await execFileAsync("git", args, {
    cwd: repoRoot,
    timeout,
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

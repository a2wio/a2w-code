import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { workspaceRepoRoot } from "./data";
import type { GitWorkspaceStatus, WorkspaceDiffFile } from "./types";

const execFileAsync = promisify(execFile);

type CommandError = NodeJS.ErrnoException & {
  stdout?: string;
  stderr?: string;
  code?: number;
};

export async function getGitStatus(workspaceId: string): Promise<GitWorkspaceStatus> {
  const repoRoot = workspaceRepoRoot(workspaceId);
  if (!(await gitAvailable())) {
    return { available: false, initialized: false, clean: true, files: [], message: "git is not available on PATH." };
  }

  if (!(await isGitRepository(repoRoot))) {
    return {
      available: true,
      initialized: false,
      clean: true,
      files: [],
      message: "Workspace Git repository is not initialized yet."
    };
  }

  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim() || "detached").catch(() => "unknown");
  const porcelain = await git(repoRoot, ["status", "--short"]).catch(() => "");
  const files = await Promise.all(parseStatus(porcelain).map((item) => diffForFile(repoRoot, item)));

  return {
    available: true,
    initialized: true,
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
  if (!name.trim()) await git(repoRoot, ["config", "user.name", "Terraform Garden"]);
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

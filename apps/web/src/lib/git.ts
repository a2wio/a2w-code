import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { readData, workspaceRepoRoot } from "./data";
import { decryptSecret } from "./secrets";
import type { GitAuthMethod, GitCommit, GitConnection, GitProvider, GitRepositoryMode, GitStashEntry, GitWorkspaceStatus, WorkspaceDiffFile, WorkspaceMode } from "./types";

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
  nextjsAppName?: string;
  nextjsHeroText?: string;
};

const DSTACK_REPOSITORY_URL = "https://github.com/kubeden/dstack.git";

export async function getGitStatus(workspaceId: string, mode: WorkspaceMode = "infra"): Promise<GitWorkspaceStatus> {
  const repoRoot = workspaceRepoRoot(workspaceId, mode);
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

export async function getGitDetails(workspaceId: string, mode: WorkspaceMode = "infra") {
  const status = await getGitStatus(workspaceId, mode);
  if (!status.available || !status.initialized) {
    return { git: status, history: [] as GitCommit[], stashes: [] as GitStashEntry[] };
  }

  const repoRoot = workspaceRepoRoot(workspaceId, mode);
  const [history, stashes] = await Promise.all([
    gitHistory(repoRoot, 40).catch(() => []),
    gitStashes(repoRoot).catch(() => [])
  ]);
  return { git: status, history, stashes };
}

export async function initializeGit(workspaceId: string, mode: WorkspaceMode = "infra") {
  const repoRoot = workspaceRepoRoot(workspaceId, mode);
  if (!(await gitAvailable())) throw new Error("git is not available on PATH.");
  if (await isGitRepository(repoRoot)) return getGitStatus(workspaceId, mode);
  await git(repoRoot, ["init"]);
  await ensureGitIdentity(repoRoot);
  return getGitStatus(workspaceId, mode);
}

export async function setupWorkspaceRepository(workspaceId: string, input: SetupWorkspaceRepositoryInput, mode: WorkspaceMode = "infra") {
  const repoRoot = workspaceRepoRoot(workspaceId, mode);
  if (!(await gitAvailable())) throw new Error("git is not available on PATH.");
  if (await isGitRepository(repoRoot)) return getGitStatus(workspaceId, mode);

  await assertRepositoryRootIsEmpty(repoRoot);
  if (input.mode === "dstack") {
    await setupDstackRepository(repoRoot, input);
    await ensureGitIdentity(repoRoot);
    return getGitStatus(workspaceId, mode);
  }
  if (input.mode === "nextjs") {
    await setupNextjsRepository(repoRoot, input);
    await ensureGitIdentity(repoRoot);
    return getGitStatus(workspaceId, mode);
  }

  const sourceUrl = cleanRepositoryUrl(input.repositoryUrl);
  const cloneArgs = ["clone", ...(input.branch ? ["--branch", input.branch] : []), sourceUrl, repoRoot];
  await withGitAuth(input, async (env) => {
    await gitGlobal(cloneArgs, env, 120_000);
  });
  await ensureGitIdentity(repoRoot);
  return getGitStatus(workspaceId, mode);
}

export async function stageWorkspace(workspaceId: string, paths: string[] = [], mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const safePaths = paths.map(cleanRelativePath);
  await git(repoRoot, safePaths.length ? ["add", "--", ...safePaths] : ["add", "-A"]);
  return getGitDetails(workspaceId, mode);
}

export async function unstageWorkspace(workspaceId: string, paths: string[] = [], mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const safePaths = paths.map(cleanRelativePath);
  await git(repoRoot, safePaths.length ? ["restore", "--staged", "--", ...safePaths] : ["restore", "--staged", "."]);
  return getGitDetails(workspaceId, mode);
}

export async function discardWorkspaceFile(workspaceId: string, path: string, confirm: string, mode: WorkspaceMode = "infra") {
  if (confirm !== "DISCARD") throw new Error("Type DISCARD to discard a file.");
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const safePath = cleanRelativePath(path);
  await git(repoRoot, ["restore", "--staged", "--worktree", "--", safePath]).catch(async () => {
    await git(repoRoot, ["clean", "-fd", "--", safePath]);
  });
  return getGitDetails(workspaceId, mode);
}

export async function resetWorkspaceChanges(workspaceId: string, confirm: string, mode: WorkspaceMode = "infra") {
  if (confirm !== "RESET") throw new Error("Type RESET to discard all workspace changes.");
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const hasHead = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]).then(() => true).catch(() => false);
  if (hasHead) {
    await git(repoRoot, ["reset", "--hard"]);
  } else {
    await git(repoRoot, ["rm", "-r", "--cached", "."], 30_000).catch(() => undefined);
  }
  await git(repoRoot, ["clean", "-fd"]);
  return getGitDetails(workspaceId, mode);
}

export async function commitWorkspace(workspaceId: string, message: string, commitMode: "all" | "staged" = "all", mode: WorkspaceMode = "infra") {
  const cleanMessage = message.replace(/\s+/g, " ").trim();
  if (!cleanMessage) throw new Error("Commit message is required.");

  const repoRoot = workspaceRepoRoot(workspaceId, mode);
  if (!(await isGitRepository(repoRoot))) await initializeGit(workspaceId, mode);
  await ensureGitIdentity(repoRoot);
  if (commitMode === "all") await git(repoRoot, ["add", "-A"]);

  const staged = await hasStagedChanges(repoRoot);
  if (!staged) throw new Error(commitMode === "staged" ? "No staged changes to commit." : "No workspace changes to commit.");

  await git(repoRoot, ["commit", "-m", cleanMessage]);
  return getGitDetails(workspaceId, mode);
}

export async function pushWorkspace(workspaceId: string, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => "");
  if (!branch) throw new Error("Cannot push from a detached HEAD. Create or checkout a branch first.");
  const upstream = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");
  await withWorkspaceGitAuth(workspaceId, mode, async (env) => {
    await gitWithEnv(repoRoot, upstream ? ["push"] : ["push", "-u", "origin", branch], env, 120_000).catch((error: CommandError) => {
      const output = `${error.stdout || ""}${error.stderr || ""}`;
      if (/non-fast-forward|fetch first|rejected/i.test(output)) {
        throw new Error("Remote has commits this workspace does not have. Run Git sync, resolve any conflicts, then push again.");
      }
      throw error;
    });
  });
  return getGitDetails(workspaceId, mode);
}

export async function syncWorkspaceBranch(workspaceId: string, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const branch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => "");
  if (!branch) throw new Error("Cannot sync a detached HEAD. Create or checkout a branch first.");
  const remoteOrigin = await git(repoRoot, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => "");
  if (!remoteOrigin) throw new Error("No Git remote is configured for this workspace.");
  const upstream = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");

  await withWorkspaceGitAuth(workspaceId, mode, async (env) => {
    if (!upstream) {
      await gitWithEnv(repoRoot, ["fetch", "origin", branch], env, 120_000);
      await git(repoRoot, ["branch", "--set-upstream-to", `origin/${branch}`, branch]);
    }
    await gitWithEnv(repoRoot, ["pull", "--rebase", "--autostash"], env, 120_000).catch((error: CommandError) => {
      const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
      if (/conflict|could not apply|resolve all conflicts|fix conflicts/i.test(output)) {
        throw new Error("Git sync hit rebase conflicts. Resolve the conflicted files, then continue or abort the rebase from Git.");
      }
      throw error;
    });
  });

  return getGitDetails(workspaceId, mode);
}

export async function createBranchFromHead(workspaceId: string, branchName: string, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const branch = cleanGitBranchName(branchName);
  await git(repoRoot, ["checkout", "-b", branch]);
  return getGitDetails(workspaceId, mode);
}

export async function mergeCurrentBranch(workspaceId: string, input: { targetBranch: string; push?: boolean }, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const sourceBranch = await git(repoRoot, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => "");
  if (!sourceBranch) throw new Error("Cannot merge from a detached HEAD. Create or checkout a branch first.");
  if (!(await isWorkingTreeClean(repoRoot))) throw new Error("Commit or stash workspace changes before merging.");

  const targetBranch = cleanGitBranchName(input.targetBranch || "main");
  if (sourceBranch === targetBranch) throw new Error("Source and target branch are the same.");

  const remoteOrigin = await git(repoRoot, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => "");
  if (remoteOrigin) {
    await withWorkspaceGitAuth(workspaceId, mode, async (env) => {
      await gitWithEnv(repoRoot, ["fetch", "origin", targetBranch], env, 120_000).catch(() => undefined);
    });
  }

  await git(repoRoot, ["checkout", targetBranch]).catch(async () => {
    if (!remoteOrigin) throw new Error(`Target branch ${targetBranch} does not exist locally.`);
    await git(repoRoot, ["checkout", "-B", targetBranch, `origin/${targetBranch}`]);
  });
  await git(repoRoot, ["merge", "--no-ff", sourceBranch, "-m", `Merge branch '${sourceBranch}' into ${targetBranch}`], 120_000);

  if (input.push) {
    await withWorkspaceGitAuth(workspaceId, mode, async (env) => {
      await gitWithEnv(repoRoot, ["push", "-u", "origin", targetBranch], env, 120_000);
    });
  }

  return getGitDetails(workspaceId, mode);
}

export async function stashWorkspace(workspaceId: string, input: { includeUntracked?: boolean; message?: string } = {}, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  if (await isWorkingTreeClean(repoRoot)) throw new Error("There are no changes to stash.");
  const message = input.message?.replace(/\s+/g, " ").trim() || "A2W workspace stash";
  await git(repoRoot, ["stash", "push", ...(input.includeUntracked ? ["--include-untracked"] : []), "-m", message]);
  return getGitDetails(workspaceId, mode);
}

export async function applyStash(workspaceId: string, index: number, stashMode: "apply" | "pop" = "apply", mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const ref = stashRef(index);
  await git(repoRoot, ["stash", stashMode, ref]);
  return getGitDetails(workspaceId, mode);
}

export async function dropStash(workspaceId: string, index: number, confirm: string, mode: WorkspaceMode = "infra") {
  if (confirm !== "DROP") throw new Error("Type DROP to delete a stash.");
  const repoRoot = await requireGitRepository(workspaceId, mode);
  await git(repoRoot, ["stash", "drop", stashRef(index)]);
  return getGitDetails(workspaceId, mode);
}

export async function checkoutGitRef(workspaceId: string, input: { ref: string; stashBefore?: boolean; createBranch?: string }, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  const ref = cleanGitRef(input.ref);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  const branch = input.createBranch?.trim();
  if (branch) {
    await git(repoRoot, ["checkout", "-b", cleanGitBranchName(branch), ref]);
  } else {
    await git(repoRoot, ["checkout", ref]);
  }
  return getGitDetails(workspaceId, mode);
}

export async function revertCommit(workspaceId: string, input: { ref: string; stashBefore?: boolean }, mode: WorkspaceMode = "infra") {
  const repoRoot = await requireGitRepository(workspaceId, mode);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  await git(repoRoot, ["revert", "--no-edit", cleanGitRef(input.ref)]);
  return getGitDetails(workspaceId, mode);
}

export async function resetToCommit(workspaceId: string, input: { ref: string; confirm: string; stashBefore?: boolean }, mode: WorkspaceMode = "infra") {
  if (input.confirm !== "RESET") throw new Error("Type RESET to hard reset the repository.");
  const repoRoot = await requireGitRepository(workspaceId, mode);
  await ensureCleanOrStash(repoRoot, input.stashBefore);
  await git(repoRoot, ["reset", "--hard", cleanGitRef(input.ref)]);
  return getGitDetails(workspaceId, mode);
}

async function requireGitRepository(workspaceId: string, mode: WorkspaceMode = "infra") {
  const repoRoot = workspaceRepoRoot(workspaceId, mode);
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

async function setupNextjsRepository(repoRoot: string, input: SetupWorkspaceRepositoryInput) {
  const remoteUrl = await templateTargetRepositoryUrl(input, "a2w-web-app");
  const branch = input.branch?.trim() || "main";

  await mkdir(repoRoot, { recursive: true });
  await writeNextjsTemplate(repoRoot, {
    appName: input.nextjsAppName || input.repositoryName || "a2w-web-app",
    heroText: input.nextjsHeroText
  });
  await git(repoRoot, ["init"]);
  await ensureGitIdentity(repoRoot);
  await git(repoRoot, ["checkout", "-B", branch]);
  await git(repoRoot, ["add", "-A"]);
  await git(repoRoot, ["commit", "-m", "Initialize A2W Next.js app"]);
  await git(repoRoot, ["remote", "add", "origin", remoteUrl]);
  await withGitAuth(input, async (env) => {
    await gitWithEnv(repoRoot, ["push", "-u", "origin", branch], env, 120_000);
  });
}

async function templateTargetRepositoryUrl(input: SetupWorkspaceRepositoryInput, fallbackName: string) {
  const explicitUrl = String(input.repositoryUrl || "").trim();
  if (explicitUrl) return explicitUrl;

  if (input.gitProvider === "github" && input.authMethod === "token") {
    if (!input.token?.trim()) throw new Error("Creating a GitHub repository requires an HTTPS Git token.");
    return createGithubRepository(input.token.trim(), input.repositoryName || fallbackName, input.repositoryOwner);
  }

  throw new Error("A remote repository URL is required unless GitHub token-based repository creation is used.");
}

async function writeNextjsTemplate(repoRoot: string, input: { appName?: string; heroText?: string }) {
  const appName = cleanNpmPackageName(input.appName || "a2w-web-app");
  const displayName = titleFromPackageName(appName);
  const heroText = String(input.heroText || "").trim() || "Build from here.";
  const files = new Map<string, string>([
    [".gitignore", [
      "node_modules",
      ".next",
      "out",
      "dist",
      ".env",
      ".env.local",
      ".DS_Store",
      "npm-debug.log*"
    ].join("\n") + "\n"],
    ["package.json", JSON.stringify({
      name: appName,
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "tsc --noEmit",
        test: "node --test"
      },
      dependencies: {
        "@tailwindcss/postcss": "^4.1.0",
        "next": "^16.0.0",
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "tailwindcss": "^4.1.0"
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "typescript": "^5.0.0"
      }
    }, null, 2) + "\n"],
    ["next.config.mjs", "/** @type {import('next').NextConfig} */\nconst nextConfig = {};\n\nexport default nextConfig;\n"],
    ["tsconfig.json", JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        incremental: true,
        plugins: [{ name: "next" }]
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"]
    }, null, 2) + "\n"],
    ["postcss.config.mjs", "const config = { plugins: { \"@tailwindcss/postcss\": {} } };\n\nexport default config;\n"],
    ["next-env.d.ts", "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n\n// This file is generated for Next.js type support.\n"],
    ["src/app/globals.css", "@import \"tailwindcss\";\n\n:root {\n  color-scheme: light;\n}\n\nbody {\n  margin: 0;\n  background: #f8fafc;\n  color: #0f172a;\n  font-family: Arial, Helvetica, sans-serif;\n}\n"],
    ["src/app/layout.tsx", `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(displayName)},
  description: "Generated by A2W-Code."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`],
    ["src/app/page.tsx", `export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-600">A2W-Code</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-slate-950">${escapeJsxText(heroText)}</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">
          This Next.js workspace is ready for Codex-driven edits, NPM checks, and Git review.
        </p>
      </section>
    </main>
  );
}
`],
    ["README.md", `# ${appName}\n\nA Next.js workspace initialized by A2W-Code.\n\n## Commands\n\n- \`npm install\`\n- \`npm run lint\`\n- \`npm test\`\n- \`npm run build\`\n`]
  ]);

  for (const [path, content] of files) {
    const target = join(repoRoot, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

function cleanNpmPackageName(value: string) {
  const clean = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 214);
  return clean || "a2w-web-app";
}

function titleFromPackageName(value: string) {
  return value
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "A2W Web App";
}

function escapeJsxText(value: string) {
  return value.replace(/[<>{}]/g, "");
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

async function withWorkspaceGitAuth<T>(workspaceId: string, mode: WorkspaceMode, callback: (env: Record<string, string>) => Promise<T>) {
  const data = await readData();
  const legacyInfraConnection = data.gitConnections
    .filter((item) => item.workspaceId === workspaceId)
    .filter((item) => !item.mode)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const connection = data.gitConnections
    .filter((item) => item.workspaceId === workspaceId)
    .filter((item) => (item.mode || "infra") === mode)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    || (mode === "infra" ? legacyInfraConnection : undefined);
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
  if (!name.trim()) await git(repoRoot, ["config", "user.name", "A2W-Code"]);
  if (!email.trim()) await git(repoRoot, ["config", "user.email", "a2w-code@localhost"]);
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

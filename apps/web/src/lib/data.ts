import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppData, Workspace, WorkspaceMode } from "./types";

const moduleRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_ROOT = resolveDataRoot();
export const WORKSPACES_ROOT = join(DATA_ROOT, "workspaces");
const dataPath = join(DATA_ROOT, "db.json");

export const EMPTY_DATA: AppData = {
  users: [],
  workspaces: [],
  chats: [],
  providerConnections: [],
  gitConnections: [],
  messages: [],
  plans: [],
  events: [],
  sandboxRuns: [],
  rootLocks: [],
  terraformVariables: []
};

export async function readData(): Promise<AppData> {
  try {
    const raw = await readFile(dataPath, "utf8");
    return { ...EMPTY_DATA, ...JSON.parse(raw) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_DATA);
    throw error;
  }
}

export async function writeData(data: AppData) {
  await mkdir(dirname(dataPath), { recursive: true });
  await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function updateData<T>(mutator: (data: AppData) => T | Promise<T>): Promise<T> {
  const data = await readData();
  const result = await mutator(data);
  await writeData(data);
  return result;
}

export function workspaceRoot(workspaceId: string) {
  return join(WORKSPACES_ROOT, workspaceId);
}

export function workspaceRepoRoot(workspaceId: string, mode: WorkspaceMode = "infra") {
  if (mode === "web") return join(workspaceRoot(workspaceId), "repositories", "web");
  return join(workspaceRoot(workspaceId), "repository");
}

export async function ensureWorkspaceFolders(workspace: Workspace) {
  await mkdir(workspaceRepoRoot(workspace.id, "infra"), { recursive: true });
  await mkdir(workspaceRepoRoot(workspace.id, "web"), { recursive: true });
}

function resolveProjectRoot() {
  if (process.env.A2W_PROJECT_ROOT) return resolve(process.env.A2W_PROJECT_ROOT);

  return detectProjectRoot(process.cwd()) || detectProjectRoot(moduleRoot) || process.cwd();
}

function resolveDataRoot() {
  if (process.env.A2W_DATA_ROOT) return resolve(process.env.A2W_DATA_ROOT);
  return join(PROJECT_ROOT, ".data");
}

function detectProjectRoot(start: string) {
  const root = resolve(start);
  const candidates = [root, resolve(root, "../..")];
  return candidates.find((candidate) => existsSync(join(candidate, "sandbox", "scripts"))) || null;
}

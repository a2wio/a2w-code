import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppData, Workspace } from "./types";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataPath = join(rootDir, ".data", "db.json");

export const DATA_ROOT = join(rootDir, ".data");
export const WORKSPACES_ROOT = join(DATA_ROOT, "workspaces");
export const PROJECT_ROOT = rootDir;

export const EMPTY_DATA: AppData = {
  users: [],
  workspaces: [],
  chats: [],
  providerConnections: [],
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

export function workspaceRepoRoot(workspaceId: string) {
  return join(workspaceRoot(workspaceId), "repository");
}

export async function ensureWorkspaceFolders(workspace: Workspace) {
  await mkdir(workspaceRepoRoot(workspace.id), { recursive: true });
}

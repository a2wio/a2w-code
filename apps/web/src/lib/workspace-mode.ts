import type { Chat, Workspace, WorkspaceMode } from "./types";

export const WORKSPACE_MODES: Array<{
  id: WorkspaceMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
}> = [
  {
    id: "infra",
    label: "Infra",
    shortLabel: "I",
    description: "Terraform, cloud credentials, and provider-backed plans.",
    icon: "fa-diagram-project"
  },
  {
    id: "web",
    label: "Web",
    shortLabel: "W",
    description: "Next.js, package scripts, and application code.",
    icon: "fa-window-maximize"
  }
];

export function normalizeWorkspaceMode(value: unknown): WorkspaceMode {
  return String(value || "").toLowerCase() === "web" ? "web" : "infra";
}

export function workspaceMode(workspace: Pick<Workspace, "mode"> | null | undefined): WorkspaceMode {
  return normalizeWorkspaceMode(workspace?.mode);
}

export function chatMode(chat: Pick<Chat, "mode"> | null | undefined): WorkspaceMode {
  return normalizeWorkspaceMode(chat?.mode);
}

export function workspaceModeLabel(mode: WorkspaceMode) {
  return WORKSPACE_MODES.find((item) => item.id === mode)?.label || "Infra";
}

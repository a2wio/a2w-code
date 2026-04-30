import { randomUUID } from "node:crypto";
import { updateData } from "./data";
import { setupWorkspaceRepository } from "./git";
import { encryptSecret } from "./secrets";
import type { GitAuthMethod, GitConnection, GitProvider, GitRepositoryMode } from "./types";

export type OnboardingGitInput = {
  gitProvider: GitProvider;
  repositoryMode: GitRepositoryMode;
  repositoryUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  repositoryBranch: string;
  gitAuthMethod: GitAuthMethod;
  gitUsername: string;
  gitToken: string;
  gitSshPrivateKey: string;
};

export function parseOnboardingGitInput(body: Record<string, unknown>): OnboardingGitInput {
  return {
    gitProvider: cleanGitProvider(body.gitProvider),
    repositoryMode: cleanRepositoryMode(body.repositoryMode),
    repositoryUrl: String(body.repositoryUrl || "").trim(),
    repositoryName: String(body.repositoryName || "").trim(),
    repositoryOwner: String(body.repositoryOwner || "").trim(),
    repositoryBranch: String(body.repositoryBranch || "").trim(),
    gitAuthMethod: cleanGitAuthMethod(body.gitAuthMethod),
    gitUsername: String(body.gitUsername || "").trim(),
    gitToken: String(body.gitToken || ""),
    gitSshPrivateKey: String(body.gitSshPrivateKey || "")
  };
}

export async function configureOnboardingGit(workspaceId: string, input: OnboardingGitInput) {
  const gitStatus = await setupWorkspaceRepository(workspaceId, {
    gitProvider: input.gitProvider,
    mode: input.repositoryMode,
    repositoryUrl: input.repositoryUrl,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    branch: input.repositoryBranch,
    authMethod: input.gitAuthMethod,
    username: input.gitUsername,
    token: input.gitToken,
    sshPrivateKey: input.gitSshPrivateKey
  });
  const configuredRepositoryUrl = gitStatus.remoteUrl || input.repositoryUrl;
  const createdAt = new Date().toISOString();
  const gitConnection: GitConnection = {
    id: randomUUID(),
    workspaceId,
    gitProvider: input.gitProvider,
    repositoryMode: input.repositoryMode,
    repositoryUrl: configuredRepositoryUrl,
    branch: input.repositoryBranch || gitStatus.branch || undefined,
    authMethod: input.gitAuthMethod,
    details: {
      repositoryUrl: configuredRepositoryUrl,
      ...(input.repositoryName ? { repositoryName: input.repositoryName } : {}),
      ...(input.repositoryOwner ? { repositoryOwner: input.repositoryOwner } : {}),
      gitProvider: input.gitProvider,
      ...(input.repositoryBranch ? { branch: input.repositoryBranch } : {}),
      ...(input.gitUsername ? { username: input.gitUsername } : {}),
      ...(input.gitAuthMethod === "token" && input.gitToken ? { tokenConfigured: "true" } : {}),
      ...(input.gitAuthMethod === "ssh" && input.gitSshPrivateKey ? { sshKeyConfigured: "true" } : {})
    },
    secrets: {
      ...(input.gitAuthMethod === "token" && input.gitToken ? { token: encryptSecret(input.gitToken) } : {}),
      ...(input.gitAuthMethod === "ssh" && input.gitSshPrivateKey ? { sshPrivateKey: encryptSecret(input.gitSshPrivateKey) } : {})
    },
    status: "configured",
    createdAt
  };

  await updateData((data) => {
    const workspace = data.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found.");
    workspace.gitProvider = input.gitProvider;
    workspace.repositoryMode = input.repositoryMode;
    workspace.repositoryUrl = configuredRepositoryUrl;
    workspace.repositoryBranch = input.repositoryBranch || gitStatus.branch || undefined;

    data.gitConnections = data.gitConnections.filter((item) => item.workspaceId !== workspaceId);
    data.gitConnections.push(gitConnection);
    data.events.push({
      id: randomUUID(),
      workspaceId,
      type: "git.repository_configured",
      label: input.repositoryMode === "dstack" ? "DStack repository configured" : "Existing Git repository configured",
      createdAt
    });
  });

  return { git: gitStatus, gitConnection };
}

export function cleanRepositoryMode(value: unknown): GitRepositoryMode {
  return value === "existing" ? "existing" : "dstack";
}

export function cleanGitProvider(value: unknown): GitProvider {
  if (value === "github" || value === "gitlab" || value === "bitbucket" || value === "azure-devops") return value;
  return "generic";
}

export function cleanGitAuthMethod(value: unknown): GitAuthMethod {
  if (value === "ssh" || value === "token") return value;
  return "none";
}

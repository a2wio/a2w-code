import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/lib/auth";
import { getCodexAppLoginStatus } from "@/lib/codex-app-server";
import { sanitizeCodexModel } from "@/lib/codex-models";
import { updateData } from "@/lib/data";
import { createHelloFunctionPlan, materializeHelloFunctionFiles } from "@/lib/first-resource";
import { getGitStatus } from "@/lib/git";
import { errorJson, json } from "@/lib/http";
import { cleanGitProvider, cleanRepositoryMode } from "@/lib/onboarding-git";
import { publicProviderConnection, validateProviderConnection } from "@/lib/provider";
import { encryptSecret } from "@/lib/secrets";
import { terraformRootPathsFromPlan } from "@/lib/terraform-roots";
import { normalizeWorkspaceMode } from "@/lib/workspace-mode";
import type { Chat, ProviderConnection } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);

    const body = await request.json();
    const mode = normalizeWorkspaceMode(body.mode);
    if (mode === "web") {
      const codexEnabled = Boolean(body.codexEnabled);
      const codexModel = sanitizeCodexModel(body.codexModel);
      if (codexEnabled) {
        const codexStatus = await getCodexAppLoginStatus();
        if (!codexStatus.authenticated) {
          return errorJson("Codex is not authenticated in App Server. Start Codex login in onboarding, then verify it.", 400);
        }
      }
      const fallbackGitProvider = cleanGitProvider(body.gitProvider);
      const fallbackRepositoryMode = cleanRepositoryMode(body.repositoryMode);
      const gitConnection = context.data.gitConnections.find((item) => item.workspaceId === context.workspace.id && (item.mode || "infra") === "web");
      const gitStatus = await getGitStatus(context.workspace.id, "web");
      if (!gitConnection || !gitStatus.initialized) {
        return errorJson("Confirm Git settings before opening the workspace.", 400);
      }

      const createdAt = new Date().toISOString();
      const chatId = randomUUID();
      const chat: Chat = {
        id: chatId,
        workspaceId: context.workspace.id,
        mode: "web",
        title: "New chat",
        createdAt,
        updatedAt: createdAt
      };

      await updateData((data) => {
        const workspace = data.workspaces.find((item) => item.id === context.workspace.id);
        if (!workspace) throw new Error("Workspace not found.");
        workspace.mode = "web";
        workspace.gitProvider = gitConnection.gitProvider || fallbackGitProvider;
        workspace.repositoryMode = gitConnection.repositoryMode || fallbackRepositoryMode;
        workspace.repositoryUrl = gitConnection.repositoryUrl || gitStatus.remoteUrl || "";
        workspace.repositoryBranch = gitConnection.branch || gitStatus.branch || undefined;
        workspace.onboardingCompletedAt = createdAt;
        workspace.codexEnabled = codexEnabled;
        workspace.codexModel = codexEnabled && codexModel ? codexModel : undefined;
        data.chats.push(chat);
        data.events.push({
          id: randomUUID(),
          workspaceId: context.workspace.id,
          type: "workspace.onboarding_completed",
          label: "Web workspace onboarding completed",
          createdAt
        });
      });

      return json({ chat }, 201);
    }

    const provider = normalizeProvider(String(body.provider || "aws"));
    if (provider !== "aws" && provider !== "azure") {
      return errorJson("Onboarding currently supports AWS and Azure only.", 400);
    }

    const validation = validateProviderConnection(provider, body);
    if (!validation.ok) return json({ errors: validation.errors }, 400);
    const codexEnabled = Boolean(body.codexEnabled);
    const codexModel = sanitizeCodexModel(body.codexModel);
    if (codexEnabled) {
      const codexStatus = await getCodexAppLoginStatus();
      if (!codexStatus.authenticated) {
        return errorJson("Codex is not authenticated in App Server. Start Codex login in onboarding, then verify it.", 400);
      }
    }
    const fallbackGitProvider = cleanGitProvider(body.gitProvider);
    const fallbackRepositoryMode = cleanRepositoryMode(body.repositoryMode);
    const gitConnection = context.data.gitConnections.find((item) => item.workspaceId === context.workspace.id && (item.mode || "infra") === "infra");
    const gitStatus = await getGitStatus(context.workspace.id, "infra");
    if (!gitConnection || !gitStatus.initialized) {
      return errorJson("Confirm Git settings before creating the first resource.", 400);
    }

    const gitProvider = gitConnection.gitProvider || fallbackGitProvider;
    const repositoryMode = gitConnection.repositoryMode || fallbackRepositoryMode;
    const repositoryBranch = gitConnection.branch || gitStatus.branch || "";
    const configuredRepositoryUrl = gitConnection.repositoryUrl || gitStatus.remoteUrl || "";

    const createdAt = new Date().toISOString();
    const connection: ProviderConnection = {
      id: randomUUID(),
      workspaceId: context.workspace.id,
      provider,
      region: validation.sanitized.region,
      details: {
        ...validation.sanitized,
        ...(provider === "azure" ? { clientSecretConfigured: "true" } : {})
      },
      secrets: provider === "azure" ? { clientSecret: encryptSecret(String(validation.secrets.clientSecret)) } : undefined,
      status: "connected",
      createdAt
    };
    const workspaceForPlan = {
      ...context.workspace,
      cloudPreference: provider
    };
    const plan = createHelloFunctionPlan(workspaceForPlan, provider, connection.region);
    const chatId = randomUUID();
    plan.chatId = chatId;
    const materializedFiles = await materializeHelloFunctionFiles(workspaceForPlan, plan);
    plan.materializedFiles = materializedFiles;
    const selectedTerraformRoot = terraformRootPathsFromPlan(plan)[0];

    await updateData((data) => {
      const workspace = data.workspaces.find((item) => item.id === context.workspace.id);
      if (!workspace) throw new Error("Workspace not found.");
      workspace.cloudPreference = provider;
      workspace.mode = "infra";
      workspace.gitProvider = gitProvider;
      workspace.repositoryMode = repositoryMode;
      workspace.repositoryUrl = configuredRepositoryUrl;
      workspace.repositoryBranch = repositoryBranch || undefined;
      workspace.onboardingCompletedAt = createdAt;
      workspace.firstResourcePlanId = plan.id;
      workspace.selectedTerraformRoot = selectedTerraformRoot;
      workspace.codexEnabled = codexEnabled;
      workspace.codexModel = codexEnabled && codexModel ? codexModel : undefined;

      data.providerConnections = data.providerConnections.filter(
        (item) => !(item.workspaceId === context.workspace.id && item.provider === provider)
      );
      data.providerConnections.push(connection);
      data.chats.push({
        id: chatId,
        workspaceId: context.workspace.id,
        mode: "infra",
        title: plan.title,
        createdAt,
        updatedAt: createdAt
      });
      data.plans.push(plan);
      data.messages.push(
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          mode: "infra",
          chatId,
          role: "user",
          content: `Create my first ${provider === "aws" ? "AWS Lambda" : "Azure Function"} resource.`,
          createdAt
        },
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          mode: "infra",
          chatId,
          role: "assistant",
          content: `${plan.summary}\n\nI wrote the Terraform and function code into your project files. You can review the files, run the sandbox, then approve the plan.`,
          planId: plan.id,
          createdAt
        }
      );
      data.events.push(
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          type: "provider.connected",
          label: `${provider.toUpperCase()} trust configured during onboarding`,
          createdAt
        },
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          type: "plan.created",
          label: plan.title,
          createdAt
        },
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          type: "plan.files_materialized",
          label: `${materializedFiles.length} first-resource files written`,
          createdAt
        },
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          type: "workspace.onboarding_completed",
          label: "Onboarding completed",
          createdAt
        }
      );
    });

    return json({ connection: publicProviderConnection(connection), plan }, 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

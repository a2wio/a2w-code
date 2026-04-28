import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/src/lib/auth";
import { getCodexLoginStatus } from "@/src/lib/codex";
import { sanitizeCodexModel } from "@/src/lib/codex-models";
import { updateData } from "@/src/lib/data";
import { createHelloFunctionPlan, materializeHelloFunctionFiles } from "@/src/lib/first-resource";
import { initializeGit } from "@/src/lib/git";
import { errorJson, json } from "@/src/lib/http";
import { publicProviderConnection, validateProviderConnection } from "@/src/lib/provider";
import { encryptSecret } from "@/src/lib/secrets";
import { terraformRootPathsFromPlan } from "@/src/lib/terraform-roots";
import type { ProviderConnection } from "@/src/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);

    const body = await request.json();
    const provider = normalizeProvider(String(body.provider || "aws"));
    if (provider !== "aws" && provider !== "azure") {
      return errorJson("Onboarding currently supports AWS and Azure only.", 400);
    }

    const validation = validateProviderConnection(provider, body);
    if (!validation.ok) return json({ errors: validation.errors }, 400);
    const codexEnabled = Boolean(body.codexEnabled);
    const codexModel = sanitizeCodexModel(body.codexModel);
    if (codexEnabled) {
      const codexStatus = await getCodexLoginStatus();
      if (!codexStatus.authenticated) {
        return errorJson("Codex is not authenticated on this host. Run `codex login`, then verify Codex in onboarding.", 400);
      }
    }
    await initializeGit(context.workspace.id);

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
        title: plan.title,
        createdAt,
        updatedAt: createdAt
      });
      data.plans.push(plan);
      data.messages.push(
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
          chatId,
          role: "user",
          content: `Create my first ${provider === "aws" ? "AWS Lambda" : "Azure Function"} resource.`,
          createdAt
        },
        {
          id: randomUUID(),
          workspaceId: context.workspace.id,
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

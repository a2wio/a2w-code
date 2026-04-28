import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/src/lib/auth";
import { codexBackendEnabled, runCodexWorkspaceAgent } from "@/src/lib/codex";
import { CODEX_MODEL_OPTIONS, sanitizeCodexModel } from "@/src/lib/codex-models";
import { updateData } from "@/src/lib/data";
import { createHelloFunctionPlan, materializeHelloFunctionFiles } from "@/src/lib/first-resource";
import { errorJson, json } from "@/src/lib/http";
import { materializePlanFiles } from "@/src/lib/materialize";
import { generatePlan } from "@/src/lib/planner";
import { listTerraformRoots, terraformRootPathsFromPlan, validateTerraformRootPath } from "@/src/lib/terraform-roots";
import type { AppData, Chat, InfraPlan, Message } from "@/src/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const message = String(body.message || "").trim();
    if (!message) return errorJson("Message is required.", 400);
    const selectedRootPath = body.rootPath ? validateTerraformRootPath(String(body.rootPath)) : context.workspace.selectedTerraformRoot;
    const chat = await ensureChat(context.workspace.id, String(body.chatId || ""), message);

    const commandResponse = await handleFastChatPath(message, chat, context.workspace.codexModel, context.data);
    if (commandResponse) return json(commandResponse, 201);

    const provider = normalizeProvider(String(body.provider || context.workspace.cloudPreference));
    const providerConnection = [...context.data.providerConnections]
      .reverse()
      .find((item) => item.workspaceId === context.workspace.id && item.provider === provider);

    const createdAt = new Date().toISOString();
    const serverlessIntent = /lambda|function|serverless|hello/i.test(message);
    const supportedServerlessProvider = provider === "azure" ? "azure" : "aws";
    const codexRun = !serverlessIntent && codexBackendEnabled(context.workspace)
      ? await runCodexWorkspaceAgent({
          message,
          workspace: context.workspace,
          providerConnection,
          provider,
          codexThreadId: chat.codexThreadId,
          selectedRootPath
        })
      : null;
    const assistant = codexRun
      ? {
          response: codexRun.finalMessage,
          plan: codexRun.plan
        }
      : serverlessIntent
        ? {
            response: `${
              supportedServerlessProvider === "aws" ? "AWS Lambda" : "Azure Function"
            } plan ready. I wrote the Terraform and function code into your project files.`,
            plan: createHelloFunctionPlan(context.workspace, supportedServerlessProvider, providerConnection?.region)
          }
        : await generatePlan({
            message,
            workspace: context.workspace,
            providerConnection,
            provider
          });

    const plan: InfraPlan = {
      ...assistant.plan,
      workspaceId: context.workspace.id,
      chatId: chat.id,
      createdAt
    };
    const materializedFiles = codexRun
      ? codexRun.changedFiles
      : serverlessIntent
        ? await materializeHelloFunctionFiles(context.workspace, plan)
        : await materializePlanFiles(context.workspace, plan);
    plan.materializedFiles = materializedFiles;

    const userMessage: Message = {
      id: randomUUID(),
      workspaceId: context.workspace.id,
      chatId: chat.id,
      role: "user",
      content: message,
      createdAt
    };
    const assistantMessage: Message = {
      id: randomUUID(),
      workspaceId: context.workspace.id,
      chatId: chat.id,
      role: "assistant",
      content: assistant.response,
      planId: plan.id,
      createdAt
    };

    await updateData((data) => {
      const storedChat = data.chats.find((item) => item.id === chat.id && item.workspaceId === context.workspace.id);
      if (storedChat) {
        storedChat.updatedAt = createdAt;
        if (codexRun?.codexThreadId) storedChat.codexThreadId = codexRun.codexThreadId;
      }
      data.messages.push(userMessage, assistantMessage);
      data.plans.push(plan);
      const roots = terraformRootPathsFromPlan(plan);
      if (roots.length) {
        const workspace = data.workspaces.find((item) => item.id === context.workspace.id);
        if (workspace) workspace.selectedTerraformRoot = selectedRootPath && roots.includes(selectedRootPath) ? selectedRootPath : roots[0];
      }
      data.events.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        type: "plan.created",
        label: plan.title,
        createdAt
      });
      data.events.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        type: "plan.files_materialized",
        label: `${materializedFiles.length} files written for ${plan.title}`,
        createdAt: new Date().toISOString()
      });
    });

    return json({ messages: [userMessage, assistantMessage], plan, chat: { ...chat, codexThreadId: codexRun?.codexThreadId || chat.codexThreadId } }, 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

async function ensureChat(workspaceId: string, chatId: string, message: string): Promise<Chat> {
  const createdAt = new Date().toISOString();
  return updateData((data) => {
    const existing = data.chats.find((item) => item.id === chatId && item.workspaceId === workspaceId);
    if (existing) {
      existing.updatedAt = createdAt;
      return existing;
    }

    const chat: Chat = {
      id: randomUUID(),
      workspaceId,
      title: chatTitle(message),
      createdAt,
      updatedAt: createdAt
    };
    data.chats.push(chat);
    return chat;
  });
}

async function handleFastChatPath(message: string, chat: Chat, currentModel: string | undefined, data: AppData) {
  if (message.startsWith("/model")) {
    const nextModelRaw = message.replace(/^\/model\s*/i, "");
    const nextModel = sanitizeCodexModel(nextModelRaw);
    const createdAt = new Date().toISOString();
    const userMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "user",
      content: message,
      createdAt
    };
    const assistantMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "assistant",
      content: modelResponse(nextModelRaw, nextModel, currentModel),
      createdAt
    };

    await updateData((data) => {
      if (nextModelRaw.trim()) {
        const workspace = data.workspaces.find((item) => item.id === chat.workspaceId);
        if (!workspace) throw new Error("Workspace not found.");
        workspace.codexModel = nextModel || undefined;
      }
      const storedChat = data.chats.find((item) => item.id === chat.id && item.workspaceId === chat.workspaceId);
      if (storedChat) storedChat.updatedAt = createdAt;
      data.messages.push(userMessage, assistantMessage);
    });
    return { messages: [userMessage, assistantMessage], chat };
  }

  if (/^(hey|hi|hello|yo|sup|thanks|thank you|ok|okay)$/i.test(message)) {
    const createdAt = new Date().toISOString();
    const userMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "user",
      content: message,
      createdAt
    };
    const assistantMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "assistant",
      content: "Hey. Send the infrastructure or app change you want implemented, or use `/model` to view/change the Codex model.",
      createdAt
    };

    await updateData((data) => {
      const storedChat = data.chats.find((item) => item.id === chat.id && item.workspaceId === chat.workspaceId);
      if (storedChat) storedChat.updatedAt = createdAt;
      data.messages.push(userMessage, assistantMessage);
    });
    return { messages: [userMessage, assistantMessage], chat };
  }

  const rootRequest = parseRootSwitch(message);
  if (rootRequest) {
    const roots = await listTerraformRoots(chat.workspaceId, data);
    const root = roots.find((item) => item.name.toLowerCase() === rootRequest || item.path.toLowerCase().includes(rootRequest));
    const createdAt = new Date().toISOString();
    const userMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "user",
      content: message,
      createdAt
    };
    const assistantMessage: Message = {
      id: randomUUID(),
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      role: "assistant",
      content: root
        ? `Active Terraform root set to \`${root.name}\`.\n\nFuture actions will target \`${root.path}\` unless you switch roots again.`
        : `I could not find a Terraform root matching \`${rootRequest}\`.\n\nKnown roots:\n${roots.map((item) => `- ${item.name} (${item.path})`).join("\n") || "- No Terraform roots discovered yet."}`,
      createdAt
    };

    await updateData((stored) => {
      const storedChat = stored.chats.find((item) => item.id === chat.id && item.workspaceId === chat.workspaceId);
      if (storedChat) storedChat.updatedAt = createdAt;
      const workspace = stored.workspaces.find((item) => item.id === chat.workspaceId);
      if (workspace && root) workspace.selectedTerraformRoot = root.path;
      stored.messages.push(userMessage, assistantMessage);
    });
    return { messages: [userMessage, assistantMessage], chat };
  }

  return null;
}

function parseRootSwitch(message: string) {
  const clean = message.toLowerCase().replace(/[;,.!?]+$/g, "").trim();
  const match =
    clean.match(/^(?:cd|switch|switch to|go to|go inside|open|use)\s+(?:the\s+)?(.+?)(?:\s+(?:dir|directory|root|stack))?$/) ||
    clean.match(/^(?:can we|please)?\s*(?:go|move)\s+inside\s+(?:the\s+)?(.+?)(?:\s+(?:dir|directory|root|stack))?$/);
  if (!match) return "";
  return match[1].replace(/\s+/g, "-").trim();
}

function chatTitle(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.startsWith("/model")) return "Codex model";
  return clean.length > 54 ? `${clean.slice(0, 51)}...` : clean;
}

function modelResponse(raw: string, nextModel: string, currentModel?: string) {
  if (!raw.trim()) {
    const options = CODEX_MODEL_OPTIONS
      .filter((option) => option.id)
      .map((option) => `- ${option.id} (${option.label})`)
      .join("\n");
    return [
      `Current Codex model: ${currentModel || "Codex CLI default"}.`,
      "",
      "Set it with `/model <model-id>` or reset with `/model default`.",
      "",
      "Suggested model IDs:",
      options
    ].join("\n");
  }

  if (!nextModel) return "Codex model reset. Future Codex runs will use the Codex CLI default.";
  return `Codex model set to ${nextModel}. Future sandboxed Codex runs will pass \`--model ${nextModel}\`.`;
}

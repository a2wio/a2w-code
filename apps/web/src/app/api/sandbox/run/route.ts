import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/auth";
import { readData, updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";
import { runSandbox } from "@/lib/sandbox";
import { validateTerraformRootPath } from "@/lib/terraform-roots";
import { discoverTerraformVariables } from "@/lib/terraform-variables";
import { chatMode, workspaceMode } from "@/lib/workspace-mode";
import type { MessageAction, SandboxRun } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const mode = parseMode(body.mode);
    const planId = String(body.planId || "");
    const rootPath = body.rootPath ? validateTerraformRootPath(String(body.rootPath)) : undefined;
    const chatId = String(body.chatId || "").trim();
    const chat = chatId ? context.data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id) : undefined;
    if (chatId && !chat) {
      return errorJson("Chat not found.", 404);
    }
    const activeMode = chat ? chatMode(chat) : workspaceMode(context.workspace);

    if (mode === "terraform-apply" || mode === "terraform-destroy") {
      const plan = context.data.plans.find((item) => item.id === planId && item.workspaceId === context.workspace.id);
      if (!plan) return errorJson("Plan not found.", 404);
      if (plan.blocked) return errorJson(`Blocked plans cannot be ${mode === "terraform-destroy" ? "destroyed" : "applied"}.`, 409);
      if (!plan.status.includes("approved")) return errorJson(`Approve the plan before ${mode === "terraform-destroy" ? "destroying" : "applying"}.`, 409);
      if (context.workspace.terraformApplyDisabled) {
        await appendSandboxMessage({
          workspaceId: context.workspace.id,
          planId,
          chatId,
          rootPath,
          mode,
          status: "failed",
          output: `Terraform ${mode === "terraform-destroy" ? "destroy" : "apply"} is disabled in workspace settings. Turn it back on from Settings before running cloud-changing Terraform actions.`
        });
        return errorJson("Terraform cloud mutations are disabled in workspace settings.", 409);
      }
      if (process.env.A2W_ENABLE_TERRAFORM_APPLY !== "true") {
        await appendSandboxMessage({
          workspaceId: context.workspace.id,
          planId,
          chatId,
          rootPath,
          mode,
          status: "failed",
          output: `Terraform ${mode === "terraform-destroy" ? "destroy" : "apply"} is disabled on the local server. Restart with A2W_ENABLE_TERRAFORM_APPLY=true before running cloud-changing Terraform actions.`
        });
        return errorJson("Terraform cloud mutations are disabled on the local server.", 409);
      }
      if (mode === "terraform-apply" && body.confirm !== "APPLY") return errorJson("Type APPLY to confirm Terraform apply.", 400);
      if (mode === "terraform-destroy" && body.confirm !== "DESTROY") return errorJson("Type DESTROY to confirm Terraform destroy.", 400);
    }

    const run = await runSandbox({
      workspaceId: context.workspace.id,
      workspaceMode: activeMode,
      chatId: chat?.id,
      planId,
      rootPath,
      mode,
      allowNetwork: mode === "terraform-apply" || mode === "terraform-destroy" ? true : Boolean(body.allowNetwork)
    });
    await appendSandboxMessage({
      workspaceId: context.workspace.id,
      planId,
      chatId,
      rootPath,
      mode,
      status: run.status,
      output: run.output,
      planSummary: run.planSummary,
      missingVariables: rootPath ? await missingVariablePrompts(context.workspace.id, rootPath, run.output) : []
    });
    return json({ run }, run.status === "succeeded" ? 200 : 500);
  } catch (error) {
    return errorJson(error, 400);
  }
}

function parseMode(mode: unknown): SandboxRun["mode"] {
  if (mode === "terraform-fmt" || mode === "validate" || mode === "terraform-plan" || mode === "terraform-apply" || mode === "terraform-destroy") return mode;
  if (mode === "npm-install" || mode === "npm-audit" || mode === "npm-lint" || mode === "npm-test" || mode === "npm-build") return mode;
  return "validate";
}

async function appendSandboxMessage(input: {
  workspaceId: string;
  planId: string;
  chatId?: string;
  rootPath?: string;
  mode: SandboxRun["mode"];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  output: string;
  planSummary?: import("@/lib/types").TerraformPlanSummary;
  missingVariables?: Array<{ name: string; description?: string; sensitive?: boolean }>;
}) {
  const label =
    input.mode === "terraform-apply"
      ? "Terraform apply"
      : input.mode === "terraform-destroy"
        ? "Terraform destroy"
      : input.mode === "terraform-plan"
        ? "Terraform plan"
        : input.mode === "terraform-fmt"
          ? "Terraform fmt"
          : input.mode === "npm-install"
            ? "NPM install"
          : input.mode === "npm-audit"
            ? "NPM audit"
          : input.mode === "npm-lint"
            ? "NPM lint"
          : input.mode === "npm-test"
            ? "NPM test"
          : input.mode === "npm-build"
            ? "NPM build"
          : "Sandbox validation";

  await updateData((data) => {
    const plan = data.plans.find((item) => item.id === input.planId && item.workspaceId === input.workspaceId);
    const chat = input.chatId
      ? data.chats.find((item) => item.id === input.chatId && item.workspaceId === input.workspaceId)
      : undefined;
    const workspace = data.workspaces.find((item) => item.id === input.workspaceId);
    const messageMode = chat ? chatMode(chat) : workspaceMode(workspace);
    const chatId = chat
      ? chat.id
      : plan?.chatId;
    data.messages.push({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      mode: messageMode,
      chatId,
      role: "assistant",
      planId: input.planId || undefined,
      actions: sandboxMessageActions(input),
      content: [
        `${label} ${input.status}.`,
        input.rootPath ? `Root: \`${input.rootPath.split("/").at(-1) || input.rootPath}\`.` : "",
        input.planSummary ? "" : "",
        input.planSummary ? planSummaryText(input.planSummary) : "",
        input.missingVariables?.length ? "" : "",
        input.missingVariables?.length ? missingVariablesText(input.missingVariables) : "",
        "",
        input.status === "succeeded"
          ? input.mode === "terraform-apply"
            ? "The apply command completed. Check the Terraform outputs and your cloud console for the function resource."
            : input.mode === "terraform-destroy"
              ? "The destroy command completed. The Terraform-managed resources for this stack should be removed from your cloud account."
              : input.mode === "terraform-fmt"
                ? "The generated Terraform files were formatted in the workspace."
                : "The sandbox command completed."
          : "The sandbox command failed. Review the output below and fix the issue before continuing.",
        "",
        "Output:",
        input.output || "No output."
      ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n"),
      createdAt: new Date().toISOString()
    });
  });
}

function sandboxMessageActions(input: {
  planId: string;
  rootPath?: string;
  mode: SandboxRun["mode"];
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  missingVariables?: Array<{ name: string }>;
}): MessageAction[] {
  const actions: MessageAction[] = [];
  if (input.missingVariables?.length && input.rootPath) {
    actions.push({
      id: "open-inputs",
      label: "Open inputs",
      kind: "open_inputs",
      rootPath: input.rootPath,
      planId: input.planId || undefined
    });
  }
  if (input.mode === "terraform-plan") {
    actions.push({
      id: "open-runs",
      label: "View run history",
      kind: "open_runs",
      rootPath: input.rootPath,
      planId: input.planId || undefined
    });
  }
  if (input.status === "failed") {
    actions.push({
      id: "open-files",
      label: "Browse files",
      kind: "open_files",
      rootPath: input.rootPath,
      planId: input.planId || undefined
    });
  }
  return actions;
}

async function missingVariablePrompts(workspaceId: string, rootPath: string, output: string) {
  const names = [...output.matchAll(/variable "([^"]+)"/g)].map((match) => match[1]);
  if (!names.length) return [];
  const data = await readData();
  const definitions = await discoverTerraformVariables(workspaceId, rootPath, data);
  return [...new Set(names)].map((name) => {
    const definition = definitions.find((item) => item.name === name);
    return {
      name,
      description: definition?.description,
      sensitive: definition?.sensitive
    };
  });
}

function missingVariablesText(variables: Array<{ name: string; description?: string; sensitive?: boolean }>) {
  return [
    "Terraform needs engineer input before it can continue.",
    "",
    "Missing inputs:",
    ...variables.map((variable) => `- \`${variable.name}\`${variable.description ? `: ${variable.description}` : ""}`),
    "",
    "Open the input prompt in chat, provide the values, then rerun Terraform plan."
  ].join("\n");
}

function planSummaryText(summary: import("@/lib/types").TerraformPlanSummary) {
  return [
    "Plan summary:",
    `- Create: ${summary.adds}`,
    `- Update: ${summary.changes}`,
    `- Destroy: ${summary.destroys}`,
    `- Replace: ${summary.replacements}`,
    summary.resources.length
      ? [
          "",
          "Resources:",
          ...summary.resources.slice(0, 12).map((resource) => `- ${resource.actions.join("+")}: ${resource.address}`)
        ].join("\n")
      : "",
    summary.resources.length > 12 ? `- ...and ${summary.resources.length - 12} more` : "",
    summary.dangerous ? "\nWarning: this plan includes delete or replacement actions." : ""
  ].filter(Boolean).join("\n");
}

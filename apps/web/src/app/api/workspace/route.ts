import { getCurrentContext } from "@/lib/auth";
import { updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";
import { publicProviderConnection } from "@/lib/provider";
import { sanitizeCodexModel } from "@/lib/codex-models";
import { getGitStatus } from "@/lib/git";
import { listTerraformRoots, validateTerraformRootPath } from "@/lib/terraform-roots";
import { chatMode, normalizeWorkspaceMode, workspaceMode } from "@/lib/workspace-mode";

export const runtime = "nodejs";

export async function GET() {
  const context = await getCurrentContext();
  if (!context) return errorJson("Unauthorized", 401);

  const { workspace, data, user } = context;
  const workspaceId = workspace.id;
  const activeMode = workspaceMode(workspace);
  const chats = data.chats.filter((item) => item.workspaceId === workspaceId && chatMode(item) === activeMode);
  const chatIds = new Set(chats.map((chat) => chat.id));
  const terraformRoots = activeMode === "infra" ? await listTerraformRoots(workspaceId, data) : [];
  return json({
    user,
    workspace: { ...workspace, mode: activeMode },
    chats,
    providerConnections: data.providerConnections
      .filter((item) => item.workspaceId === workspaceId)
      .map(publicProviderConnection),
    messages: data.messages.filter((item) => item.workspaceId === workspaceId && (!item.chatId || chatIds.has(item.chatId))),
    plans: activeMode === "infra" ? data.plans.filter((item) => item.workspaceId === workspaceId) : [],
    events: data.events.filter((item) => item.workspaceId === workspaceId),
    sandboxRuns: data.sandboxRuns.filter((item) => item.workspaceId === workspaceId && (activeMode === "web" ? item.mode.startsWith("npm-") : !item.mode.startsWith("npm-"))),
    terraformRoots,
    gitStatus: await getGitStatus(workspaceId, activeMode)
  });
}

export async function PATCH(request: Request) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();

    const workspace = await updateData((data) => {
      const item = data.workspaces.find((candidate) => candidate.id === context.workspace.id);
      if (!item) throw new Error("Workspace not found.");
      if ("terraformApplyDisabled" in body) {
        item.terraformApplyDisabled = Boolean(body.terraformApplyDisabled);
      }
      if ("codexModel" in body) {
        const model = sanitizeCodexModel(body.codexModel);
        item.codexModel = model || undefined;
      }
      if ("mode" in body) {
        item.mode = normalizeWorkspaceMode(body.mode);
      }
      if ("selectedTerraformRoot" in body) {
        item.selectedTerraformRoot = body.selectedTerraformRoot ? validateTerraformRootPath(String(body.selectedTerraformRoot)) : undefined;
      }
      return item;
    });

    return json({ workspace });
  } catch (error) {
    return errorJson(error, 400);
  }
}

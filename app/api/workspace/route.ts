import { getCurrentContext } from "@/src/lib/auth";
import { updateData } from "@/src/lib/data";
import { errorJson, json } from "@/src/lib/http";
import { publicProviderConnection } from "@/src/lib/provider";
import { sanitizeCodexModel } from "@/src/lib/codex-models";
import { getGitStatus } from "@/src/lib/git";
import { listTerraformRoots, validateTerraformRootPath } from "@/src/lib/terraform-roots";

export const runtime = "nodejs";

export async function GET() {
  const context = await getCurrentContext();
  if (!context) return errorJson("Unauthorized", 401);

  const { workspace, data, user } = context;
  const workspaceId = workspace.id;
  const terraformRoots = await listTerraformRoots(workspaceId, data);
  return json({
    user,
    workspace,
    chats: data.chats.filter((item) => item.workspaceId === workspaceId),
    providerConnections: data.providerConnections
      .filter((item) => item.workspaceId === workspaceId)
      .map(publicProviderConnection),
    messages: data.messages.filter((item) => item.workspaceId === workspaceId),
    plans: data.plans.filter((item) => item.workspaceId === workspaceId),
    events: data.events.filter((item) => item.workspaceId === workspaceId),
    sandboxRuns: data.sandboxRuns.filter((item) => item.workspaceId === workspaceId),
    terraformRoots,
    gitStatus: await getGitStatus(workspaceId)
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

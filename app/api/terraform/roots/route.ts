import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import { updateData } from "@/src/lib/data";
import { errorJson, json } from "@/src/lib/http";
import { listTerraformRoots, validateTerraformRootPath } from "@/src/lib/terraform-roots";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const roots = await listTerraformRoots(context.workspace.id, context.data);
    const selectedRoot =
      roots.find((root) => root.path === context.workspace.selectedTerraformRoot) ||
      roots.at(-1) ||
      null;
    return json({ roots, selectedRoot });
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const rootPath = validateTerraformRootPath(String(body.rootPath || ""));
    const roots = await listTerraformRoots(context.workspace.id, context.data);
    if (!roots.some((root) => root.path === rootPath)) return errorJson("Terraform root not found.", 404);

    const workspace = await updateData((data) => {
      const item = data.workspaces.find((workspace) => workspace.id === context.workspace.id);
      if (!item) throw new Error("Workspace not found.");
      item.selectedTerraformRoot = rootPath;
      return item;
    });

    return json({ workspace, selectedRoot: roots.find((root) => root.path === rootPath) });
  } catch (error) {
    return errorJson(error, 400);
  }
}

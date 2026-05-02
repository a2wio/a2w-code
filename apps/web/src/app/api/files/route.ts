import { NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/auth";
import { errorJson, json } from "@/lib/http";
import { listWorkspaceFiles, readWorkspaceFile } from "@/lib/materialize";
import { workspaceMode } from "@/lib/workspace-mode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const path = request.nextUrl.searchParams.get("path");
    const mode = workspaceMode(context.workspace);
    if (path) {
      const content = await readWorkspaceFile(context.workspace.id, path, mode);
      return json({ path, content });
    }
    const files = await listWorkspaceFiles(context.workspace.id, mode);
    return json({ files });
  } catch (error) {
    return errorJson(error, 400);
  }
}

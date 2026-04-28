import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import { errorJson, json } from "@/src/lib/http";
import { listWorkspaceFiles, readWorkspaceFile } from "@/src/lib/materialize";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const path = request.nextUrl.searchParams.get("path");
    if (path) {
      const content = await readWorkspaceFile(context.workspace.id, path);
      return json({ path, content });
    }
    const files = await listWorkspaceFiles(context.workspace.id);
    return json({ files });
  } catch (error) {
    return errorJson(error, 400);
  }
}

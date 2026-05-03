import { getCurrentContext } from "@/lib/auth";
import { getCodexAppLoginStatus } from "@/lib/codex-app-server";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);

    const status = await getCodexAppLoginStatus();
    return json({
      ...status,
      workspaceEnabled: Boolean(context.workspace.codexEnabled)
    });
  } catch (error) {
    return errorJson(error, 400);
  }
}

import { getCurrentContext } from "@/src/lib/auth";
import { getCodexLoginStatus } from "@/src/lib/codex";
import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);

    const status = await getCodexLoginStatus();
    return json({
      ...status,
      workspaceEnabled: Boolean(context.workspace.codexEnabled)
    });
  } catch (error) {
    return errorJson(error, 400);
  }
}

import { getCurrentContext } from "@/lib/auth";
import { getCodexLoginPane, startCodexLoginPane, stopCodexLoginPane } from "@/lib/codex-login-tmux";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await getCodexLoginPane());
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function POST() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await startCodexLoginPane(), 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function DELETE() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await stopCodexLoginPane());
  } catch (error) {
    return errorJson(error, 400);
  }
}

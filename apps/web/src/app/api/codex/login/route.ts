import { getCurrentContext } from "@/lib/auth";
import { getCodexAppLoginPane, startCodexAppLogin, stopCodexAppLogin } from "@/lib/codex-app-server";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await getCodexAppLoginPane());
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function POST() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await startCodexAppLogin(), 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function DELETE() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json(await stopCodexAppLogin());
  } catch (error) {
    return errorJson(error, 400);
  }
}

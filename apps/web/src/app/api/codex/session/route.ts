import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/lib/auth";
import { ensureCodexAppSession, getCodexAppSession, interruptCodexAppSession } from "@/lib/codex-app-server";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const chatId = String(request.nextUrl.searchParams.get("chatId") || "").trim();
    if (!chatId) return errorJson("chatId is required.", 400);
    const chat = context.data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id);
    if (!chat) return errorJson("Chat not found.", 404);

    const session = await getCodexAppSession({ workspace: context.workspace, chat });
    return json({ session });
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const chatId = String(body.chatId || "").trim();
    if (!chatId) return errorJson("chatId is required.", 400);
    const chat = context.data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id);
    if (!chat) return errorJson("Chat not found.", 404);

    if (body.action === "start") {
      const provider = normalizeProvider(String(body.provider || context.workspace.cloudPreference));
      const providerConnection = [...context.data.providerConnections]
        .reverse()
        .find((item) => item.workspaceId === context.workspace.id && item.provider === provider);
      const session = await ensureCodexAppSession({
        workspace: context.workspace,
        chat,
        provider,
        providerConnection,
        selectedRootPath: context.workspace.selectedTerraformRoot
      });
      return json({ session });
    }

    if (body.action === "interrupt") {
      const session = await interruptCodexAppSession({ workspace: context.workspace, chat });
      return json({ session });
    }

    return errorJson("Unsupported Codex session action.", 400);
  } catch (error) {
    return errorJson(error, 400);
  }
}

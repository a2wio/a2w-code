import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/lib/auth";
import { ensureCodexTmuxSession, getCodexTmuxPane, sendCodexTmuxChoice, sendCodexTmuxControl, type CodexTmuxControlKey } from "@/lib/codex-tmux";
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

    const pane = await getCodexTmuxPane({ workspace: context.workspace, chatId });
    return json({ pane });
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
      const pane = await ensureCodexTmuxSession({
        workspace: context.workspace,
        chat,
        provider,
        providerConnection,
        selectedRootPath: context.workspace.selectedTerraformRoot
      });
      return json({ pane });
    }

    if (body.action === "choose") {
      const index = Number(body.index);
      const activeIndex = Number(body.activeIndex);
      if (!Number.isInteger(index) || !Number.isInteger(activeIndex) || index < 0 || activeIndex < 0) {
        return errorJson("Valid index and activeIndex are required.", 400);
      }
      const pane = await sendCodexTmuxChoice({ workspace: context.workspace, chatId, index, activeIndex });
      return json({ pane });
    }

    if (body.action === "key") {
      const key = String(body.key || "");
      if (!isCodexTmuxControlKey(key)) return errorJson("Valid key is required.", 400);
      const pane = await sendCodexTmuxControl({ workspace: context.workspace, chatId, key });
      return json({ pane });
    }

    return errorJson("Unsupported tmux action.", 400);
  } catch (error) {
    return errorJson(error, 400);
  }
}

function isCodexTmuxControlKey(value: string): value is CodexTmuxControlKey {
  return value === "up" || value === "down" || value === "enter" || value === "escape";
}

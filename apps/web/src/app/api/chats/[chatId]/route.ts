import { randomUUID } from "node:crypto";
import { getCurrentContext } from "@/lib/auth";
import { stopCodexTmuxSession } from "@/lib/codex-tmux";
import { updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const { chatId } = await params;
    const body = await request.json();
    const title = String(body.title || "").replace(/\s+/g, " ").trim();
    if (!title) return errorJson("Title is required.", 400);
    if (title.length > 80) return errorJson("Title must be 80 characters or less.", 400);

    const result = await updateData((data) => {
      const chat = data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id);
      if (!chat) return { status: 404 as const };
      chat.title = title;
      chat.updatedAt = new Date().toISOString();
      return { status: 200 as const, chat };
    });

    if (result.status === 404) return errorJson("Chat not found.", 404);
    return json({ chat: result.chat });
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const { chatId } = await params;

    const result = await updateData((data) => {
      const chat = data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id);
      if (!chat) return { status: 404 as const };
      data.chats = data.chats.filter((item) => !(item.id === chatId && item.workspaceId === context.workspace.id));
      data.messages = data.messages.filter((item) => !(item.chatId === chatId && item.workspaceId === context.workspace.id));
      for (const plan of data.plans) {
        if (plan.workspaceId === context.workspace.id && plan.chatId === chatId) plan.chatId = undefined;
      }
      data.events.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        type: "chat.deleted",
        label: chat.title,
        createdAt: new Date().toISOString()
      });
      return { status: 200 as const };
    });

    if (result.status === 404) return errorJson("Chat not found.", 404);
    await stopCodexTmuxSession({ workspace: context.workspace, chatId }).catch(() => undefined);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error, 400);
  }
}

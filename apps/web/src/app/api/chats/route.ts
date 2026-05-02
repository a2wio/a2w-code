import { randomUUID } from "node:crypto";
import { getCurrentContext } from "@/lib/auth";
import { updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";
import { normalizeWorkspaceMode, workspaceMode } from "@/lib/workspace-mode";
import type { Chat } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const title = body.title ? chatTitle(String(body.title)) : "New chat";
    const mode = normalizeWorkspaceMode(body.mode || workspaceMode(context.workspace));
    const createdAt = new Date().toISOString();

    const chat: Chat = await updateData((data) => {
      const nextChat: Chat = {
        id: randomUUID(),
        workspaceId: context.workspace.id,
        mode,
        title,
        createdAt,
        updatedAt: createdAt
      };
      data.chats.push(nextChat);
      return nextChat;
    });

    return json({ chat }, 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

function chatTitle(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  if (clean.startsWith("/model")) return "Codex model";
  return clean.length > 54 ? `${clean.slice(0, 51)}...` : clean;
}

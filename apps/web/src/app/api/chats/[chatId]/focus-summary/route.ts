import { getCurrentContext } from "@/lib/auth";
import { updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const { chatId } = await params;
    const body = await request.json();
    const summary = cleanFocusSummary(body.summary);
    if (!summary) return errorJson("Summary is required.", 400);

    const result = await updateData((data) => {
      const chat = data.chats.find((item) => item.id === chatId && item.workspaceId === context.workspace.id);
      if (!chat) return { status: 404 as const };
      chat.focusSummary = summary;
      chat.focusSummaryUpdatedAt = new Date().toISOString();
      return { status: 200 as const, chat };
    });

    if (result.status === 404) return errorJson("Chat not found.", 404);
    return json({ chat: result.chat });
  } catch (error) {
    return errorJson(error, 400);
  }
}

function cleanFocusSummary(value: unknown) {
  const summary = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
    .slice(0, 220);
  if (!summary) return "";
  if (/^Greeted the (?:user|operator) and asked what (?:they|the user|the operator) want(?:s)? to work on\.?$/i.test(summary)) {
    return "I'm ready. What would you like to work on?";
  }
  if (/^(?:I\s+)?(?:greeted|asked|told|explained|summarized|informed|confirmed|mentioned|noted|answered|responded to|described|outlined|reported)\s+(?:the\s+)?(?:user|operator)\b/i.test(summary)) {
    return "";
  }
  return summary.replace(/[.。!?]*$/, ".");
}

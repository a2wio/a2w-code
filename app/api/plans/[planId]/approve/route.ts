import { randomUUID } from "node:crypto";
import { getCurrentContext } from "@/src/lib/auth";
import { updateData } from "@/src/lib/data";
import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const { planId } = await params;

    const result = await updateData((data) => {
      const plan = data.plans.find((item) => item.id === planId && item.workspaceId === context.workspace.id);
      if (!plan) return { status: 404 as const };
      if (plan.blocked) return { status: 409 as const, error: "Blocked plans cannot be approved." };
      if (plan.status.includes("approved")) return { status: 200 as const, plan };

      const createdAt = new Date().toISOString();
      plan.status = "approved_for_apply";
      plan.approvedAt = createdAt;
      data.events.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        type: "plan.approved",
        label: `${plan.title} approved for sandbox apply flow`,
        createdAt
      });
      data.messages.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        chatId: plan.chatId,
        role: "assistant",
        content: [
          `Approval recorded for ${plan.title}.`,
          "",
          "Progress:",
          "1. Approval is recorded in the workspace.",
          "2. Run terraform fmt and terraform plan from the chat plan controls.",
          "3. Browse files, then apply or destroy only when the server flag and workspace policy allow cloud-changing actions.",
          "",
          "Sandbox responses will appear here in chat."
        ].join("\n"),
        planId: plan.id,
        createdAt
      });
      return { status: 200 as const, plan };
    });

    if (result.status === 404) return errorJson("Plan not found.", 404);
    if (result.status === 409) return errorJson(result.error, 409);
    return json({ plan: result.plan });
  } catch (error) {
    return errorJson(error, 400);
  }
}

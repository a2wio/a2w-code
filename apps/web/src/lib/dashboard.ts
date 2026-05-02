import { redirect } from "next/navigation";
import { getCurrentContext } from "./auth";
import { getGitStatus } from "./git";
import { publicProviderConnection } from "./provider";
import { listTerraformRoots } from "./terraform-roots";
import { chatMode, workspaceMode } from "./workspace-mode";

export async function requireDashboardData() {
  const context = await getCurrentContext();
  if (!context) redirect("/auth");
  if (!context.workspace.onboardingCompletedAt) redirect("/onboarding");
  const workspaceId = context.workspace.id;
  const activeMode = workspaceMode(context.workspace);
  const chats = context.data.chats.filter((item) => item.workspaceId === workspaceId && chatMode(item) === activeMode);
  const chatIds = new Set(chats.map((chat) => chat.id));

  const terraformRoots = activeMode === "infra" ? await listTerraformRoots(workspaceId, context.data) : [];
  const gitStatus = await getGitStatus(workspaceId, activeMode);

  return {
    user: context.user,
    workspace: { ...context.workspace, mode: activeMode },
    chats,
    providerConnections: context.data.providerConnections
      .filter((item) => item.workspaceId === workspaceId)
      .map(publicProviderConnection),
    messages: context.data.messages.filter((item) => item.workspaceId === workspaceId && (!item.chatId || chatIds.has(item.chatId))),
    plans: activeMode === "infra" ? context.data.plans.filter((item) => item.workspaceId === workspaceId) : [],
    events: context.data.events.filter((item) => item.workspaceId === workspaceId),
    sandboxRuns: context.data.sandboxRuns.filter((item) => item.workspaceId === workspaceId && (activeMode === "web" ? item.mode.startsWith("npm-") : !item.mode.startsWith("npm-"))),
    terraformRoots,
    gitStatus
  };
}

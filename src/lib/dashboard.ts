import { redirect } from "next/navigation";
import { getCurrentContext } from "./auth";
import { getGitStatus } from "./git";
import { publicProviderConnection } from "./provider";
import { listTerraformRoots } from "./terraform-roots";

export async function requireDashboardData() {
  const context = await getCurrentContext();
  if (!context) redirect("/auth");
  if (!context.workspace.onboardingCompletedAt) redirect("/onboarding");
  const workspaceId = context.workspace.id;

  const terraformRoots = await listTerraformRoots(workspaceId, context.data);
  const gitStatus = await getGitStatus(workspaceId);

  return {
    user: context.user,
    workspace: context.workspace,
    chats: context.data.chats.filter((item) => item.workspaceId === workspaceId),
    providerConnections: context.data.providerConnections
      .filter((item) => item.workspaceId === workspaceId)
      .map(publicProviderConnection),
    messages: context.data.messages.filter((item) => item.workspaceId === workspaceId),
    plans: context.data.plans.filter((item) => item.workspaceId === workspaceId),
    events: context.data.events.filter((item) => item.workspaceId === workspaceId),
    sandboxRuns: context.data.sandboxRuns.filter((item) => item.workspaceId === workspaceId),
    terraformRoots,
    gitStatus
  };
}

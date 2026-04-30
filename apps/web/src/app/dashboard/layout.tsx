import { DashboardShell } from "@/components/DashboardShell";
import { requireDashboardData } from "@/lib/dashboard";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const data = await requireDashboardData();

  return (
    <DashboardShell
      user={data.user}
      workspace={data.workspace}
      connections={data.providerConnections}
      applyRuntimeEnabled={process.env.A2W_ENABLE_TERRAFORM_APPLY === "true"}
      agentBackend={data.workspace.codexEnabled || process.env.A2W_AGENT_BACKEND === "codex" ? "codex" : "mock"}
      chats={data.chats}
      messages={data.messages}
      plans={data.plans}
    >
      {children}
    </DashboardShell>
  );
}

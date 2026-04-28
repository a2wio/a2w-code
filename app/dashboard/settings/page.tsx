import { SettingsPanel } from "@/components/SettingsPanel";
import { requireDashboardData } from "@/src/lib/dashboard";

export default async function SettingsPage() {
  const data = await requireDashboardData();

  return (
    <SettingsPanel
      user={data.user}
      workspace={data.workspace}
      connections={data.providerConnections}
      applyRuntimeEnabled={process.env.A2W_ENABLE_TERRAFORM_APPLY === "true"}
      agentBackend={data.workspace.codexEnabled || process.env.A2W_AGENT_BACKEND === "codex" ? "codex" : "mock"}
    />
  );
}

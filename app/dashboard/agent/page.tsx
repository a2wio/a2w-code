import { AgentChat } from "@/components/AgentChat";
import { requireDashboardData } from "@/src/lib/dashboard";

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ prompt?: string; chat?: string }> }) {
  const data = await requireDashboardData();
  const params = await searchParams;
  return (
    <AgentChat
      chats={data.chats}
      messages={data.messages}
      plans={data.plans}
      sandboxRuns={data.sandboxRuns}
      terraformRoots={data.terraformRoots}
      gitStatus={data.gitStatus}
      provider={data.workspace.cloudPreference}
      selectedTerraformRoot={data.workspace.selectedTerraformRoot}
      initialPrompt={params.prompt}
      initialChatId={params.chat}
      applyDisabled={Boolean(data.workspace.terraformApplyDisabled)}
      applyRuntimeEnabled={process.env.A2W_ENABLE_TERRAFORM_APPLY === "true"}
    />
  );
}

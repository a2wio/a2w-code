import { AgentChat } from "@/components/AgentChat";
import { requireDashboardData } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ prompt?: string; chat?: string }> }) {
  const data = await requireDashboardData();
  const params = await searchParams;
  const chatParam = params.chat?.trim();
  const latestChat = data.chats.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).at(0);
  const chatExists = chatParam === "new" || data.chats.some((chat) => chat.id === chatParam);
  if ((!chatParam || !chatExists) && latestChat) {
    const query = new URLSearchParams({ chat: latestChat.id });
    if (params.prompt) query.set("prompt", params.prompt);
    redirect(`/dashboard/agent?${query.toString()}`);
  }
  const activeProviderConnection = data.providerConnections.find((connection) => connection.provider === data.workspace.cloudPreference);
  return (
    <AgentChat
      chats={data.chats}
      messages={data.messages}
      plans={data.plans}
      sandboxRuns={data.sandboxRuns}
      terraformRoots={data.terraformRoots}
      gitStatus={data.gitStatus}
      provider={data.workspace.cloudPreference}
      providerConnection={activeProviderConnection}
      selectedTerraformRoot={data.workspace.selectedTerraformRoot}
      initialPrompt={params.prompt}
      initialChatId={chatParam}
      applyDisabled={Boolean(data.workspace.terraformApplyDisabled)}
      applyRuntimeEnabled={process.env.A2W_ENABLE_TERRAFORM_APPLY === "true"}
    />
  );
}

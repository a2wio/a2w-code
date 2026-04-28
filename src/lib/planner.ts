import type { InfraPlan, ProviderConnection, Workspace, CloudProvider } from "./types";

type AgentResult = {
  response: string;
  plan: Omit<InfraPlan, "workspaceId" | "createdAt">;
};

export async function generatePlan(input: {
  message: string;
  workspace: Workspace;
  providerConnection?: ProviderConnection;
  provider: CloudProvider;
}) {
  const agent = (await import("../agent.js")) as {
    generateAgentResponse: (value: unknown) => AgentResult;
  };
  return agent.generateAgentResponse(input) as AgentResult;
}

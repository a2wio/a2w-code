import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/src/lib/auth";
import { updateData } from "@/src/lib/data";
import { errorJson, json } from "@/src/lib/http";
import { publicProviderConnection, validateProviderConnection } from "@/src/lib/provider";
import { encryptSecret } from "@/src/lib/secrets";
import type { ProviderConnection } from "@/src/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const provider = normalizeProvider(String(body.provider || context.workspace.cloudPreference));
    const existing = context.data.providerConnections
      .filter((item) => item.workspaceId === context.workspace.id && item.provider === provider)
      .at(-1);
    const preserveAzureSecret = provider === "azure" && !String(body.clientSecret || "").trim() && Boolean(existing?.secrets?.clientSecret);
    const validationPayload = preserveAzureSecret ? { ...body, clientSecret: "__existing_client_secret__" } : body;
    const validation = validateProviderConnection(provider, validationPayload);
    if (!validation.ok) return json({ errors: validation.errors }, 400);

    const connection = await updateData((data) => {
      const createdAt = new Date().toISOString();
      const connection: ProviderConnection = {
        id: randomUUID(),
        workspaceId: context.workspace.id,
        provider,
        region: validation.sanitized.region,
        details: {
          ...validation.sanitized,
          ...(provider === "azure" ? { clientSecretConfigured: "true" } : {})
        },
        secrets: provider === "azure"
          ? preserveAzureSecret
            ? existing?.secrets
            : { clientSecret: encryptSecret(String(validation.secrets.clientSecret)) }
          : undefined,
        status: "connected",
        createdAt
      };
      data.providerConnections = data.providerConnections.filter(
        (item) => !(item.workspaceId === context.workspace.id && item.provider === provider)
      );
      data.providerConnections.push(connection);
      const workspace = data.workspaces.find((item) => item.id === context.workspace.id);
      if (workspace) workspace.cloudPreference = provider;
      data.events.push({
        id: randomUUID(),
        workspaceId: context.workspace.id,
        type: "provider.connected",
        label: `${provider.toUpperCase()} trust configured`,
        createdAt
      });
      return connection;
    });

    return json({ connection: publicProviderConnection(connection) }, 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

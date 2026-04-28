import { NextRequest } from "next/server";
import { getCurrentContext, normalizeProvider } from "@/src/lib/auth";
import { errorJson, json } from "@/src/lib/http";
import { decryptSecret } from "@/src/lib/secrets";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const provider = normalizeProvider(String(body.provider || context.workspace.cloudPreference));
    const connection = context.data.providerConnections
      .filter((item) => item.workspaceId === context.workspace.id && item.provider === provider)
      .at(-1);
    if (!connection) return errorJson(`${provider.toUpperCase()} credentials are not configured.`, 404);

    if (provider === "azure") {
      const clientSecret = connection.secrets?.clientSecret ? decryptSecret(connection.secrets.clientSecret) : "";
      const result = await testAzureConnection(connection.details, clientSecret);
      return json({ result });
    }

    if (provider === "aws") {
      return json({
        result: {
          status: "configured",
          label: "AWS role trust configured",
          detail: "The workspace has an IAM role ARN and external ID. A live STS assume-role test needs host AWS source credentials, so Terraform plan is still the authoritative provider check."
        }
      });
    }

    return json({
      result: {
        status: "configured",
        label: `${provider.toUpperCase()} trust configured`,
        detail: "Credential shape is configured. Terraform plan is the authoritative provider check."
      }
    });
  } catch (error) {
    return errorJson(error, 400);
  }
}

async function testAzureConnection(details: Record<string, string>, clientSecret: string) {
  if (!clientSecret) {
    return {
      status: "failed",
      label: "Azure client secret missing",
      detail: "Save the Azure client secret before running provider-backed Terraform checks."
    };
  }

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${details.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: details.clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://management.azure.com/.default"
    })
  });

  if (!tokenResponse.ok) {
    return {
      status: "failed",
      label: "Azure authentication failed",
      detail: `Azure AD rejected the service principal credentials with HTTP ${tokenResponse.status}. Check tenant ID, client ID, and client secret.`
    };
  }

  const token = (await tokenResponse.json()) as { access_token?: string };
  const subscriptionResponse = await fetch(`https://management.azure.com/subscriptions/${details.subscriptionId}?api-version=2020-01-01`, {
    headers: { authorization: `Bearer ${token.access_token}` }
  });

  if (!subscriptionResponse.ok) {
    return {
      status: "failed",
      label: "Azure subscription check failed",
      detail: `The service principal authenticated, but subscription access returned HTTP ${subscriptionResponse.status}. Assign at least Contributor at the subscription or target resource group scope.`
    };
  }

  return {
    status: "connected",
    label: "Azure credentials verified",
    detail: "The service principal authenticated and can read the selected subscription."
  };
}

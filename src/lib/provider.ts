import type { CloudProvider } from "./types";

export const PROVIDERS: Record<
  CloudProvider,
  {
    id: CloudProvider;
    label: string;
    cluster: string;
    defaultRegion: string;
    connectFields: string[];
  }
> = {
  aws: {
    id: "aws",
    label: "AWS",
    cluster: "EKS",
    defaultRegion: "eu-central-1",
    connectFields: ["roleArn", "externalId", "region"]
  },
  azure: {
    id: "azure",
    label: "Azure",
    cluster: "AKS",
    defaultRegion: "westeurope",
    connectFields: ["tenantId", "subscriptionId", "clientId", "region"]
  },
  gcp: {
    id: "gcp",
    label: "GCP",
    cluster: "GKE",
    defaultRegion: "europe-west4",
    connectFields: ["projectId", "serviceAccountEmail", "region"]
  }
};

export function validateProviderConnection(provider: CloudProvider, payload: Record<string, unknown>) {
  const errors: string[] = [];

  if (payload.accessKey || payload.secretKey || payload.clientSecret || payload.privateKey) {
    if (provider !== "azure" || !payload.clientSecret || payload.accessKey || payload.secretKey || payload.privateKey) {
      errors.push("Use workload identity or provider-specific service principal details, not static access keys.");
    }
  }

  if (provider === "aws") {
    if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(String(payload.roleArn || ""))) {
      errors.push("AWS connection requires an IAM role ARN.");
    }
    if (!String(payload.externalId || "").trim()) errors.push("AWS connection requires an external ID.");
  }

  if (provider === "azure") {
    if (!isUuidLike(payload.tenantId)) errors.push("Azure connection requires a tenant ID.");
    if (!isUuidLike(payload.subscriptionId)) errors.push("Azure connection requires a subscription ID.");
    if (!isUuidLike(payload.clientId)) errors.push("Azure connection requires an app/client ID.");
    if (!String(payload.clientSecret || "").trim()) errors.push("Azure connection requires a client secret for provider-backed Terraform plan.");
  }

  if (provider === "gcp") {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(payload.projectId || ""))) {
      errors.push("GCP connection requires a project ID.");
    }
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(String(payload.serviceAccountEmail || ""))) {
      errors.push("GCP connection requires a service account email.");
    }
  }

  if (!String(payload.region || "").trim()) errors.push(`${PROVIDERS[provider].label} connection requires a default region.`);

  return {
    ok: errors.length === 0,
    errors,
    sanitized: sanitizeConnection(provider, payload),
    secrets: sanitizeSecrets(provider, payload)
  };
}

function sanitizeConnection(provider: CloudProvider, payload: Record<string, unknown>) {
  const allowed = new Set(PROVIDERS[provider].connectFields);
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, String(value || "").trim()])
  );
}

function sanitizeSecrets(provider: CloudProvider, payload: Record<string, unknown>) {
  if (provider !== "azure") return {};
  return {
    clientSecret: String(payload.clientSecret || "").trim()
  };
}

export function publicProviderConnection<T extends { secrets?: unknown }>(connection: T): Omit<T, "secrets"> {
  const { secrets: _secrets, ...safeConnection } = connection;
  return safeConnection;
}

function isUuidLike(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

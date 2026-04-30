const PROVIDERS = {
  aws: {
    id: "aws",
    label: "AWS",
    cluster: "EKS",
    network: "VPC",
    identity: "IAM OIDC",
    defaultRegion: "eu-central-1",
    terraformStacks: ["common", "eks", "eks-argocd"],
    connectFields: ["roleArn", "externalId", "region"]
  },
  azure: {
    id: "azure",
    label: "Azure",
    cluster: "AKS",
    network: "VNet",
    identity: "Microsoft Entra Workload Identity",
    defaultRegion: "westeurope",
    terraformStacks: ["common", "aks", "aks-argocd"],
    connectFields: ["tenantId", "subscriptionId", "clientId", "region"]
  },
  gcp: {
    id: "gcp",
    label: "GCP",
    cluster: "GKE",
    network: "VPC",
    identity: "Workload Identity Federation",
    defaultRegion: "europe-west4",
    terraformStacks: ["common", "gke", "gke-argocd"],
    connectFields: ["projectId", "serviceAccountEmail", "region"]
  }
};

export const STANDARD_STACK = {
  infrastructure: [
    "Terraform HCL",
    "remote state",
    "private network",
    "managed Kubernetes",
    "managed node pools",
    "OIDC-based cloud identity",
    "Argo CD Helm bootstrap"
  ],
  gitops: [
    "Argo CD Applications",
    "Kustomize overlays",
    "Helm charts through Argo CD",
    "cert-manager",
    "ingress-nginx",
    "External Secrets Operator",
    "kube-prometheus-stack",
    "Kyverno policies"
  ],
  contextRules: [
    "Terraform may provision cloud resources, remote state, networks, Kubernetes clusters, and initial Argo CD bootstrap only.",
    "GitOps owns ongoing Kubernetes platform configuration, cluster policies, and workloads.",
    "Every action starts as a plan; apply requires an explicit approval event.",
    "Provider connections use short-lived trust or workload identity, never static cloud access keys.",
    "Production or destructive changes require a stricter risk gate and rollback notes."
  ]
};

const DESTRUCTIVE_TERMS = [
  "delete",
  "destroy",
  "terminate",
  "remove cluster",
  "nuke",
  "wipe",
  "drop production"
];

const OBSERVABILITY_TERMS = ["observability", "monitoring", "prometheus", "grafana", "metrics", "alerts", "logs"];
const INGRESS_TERMS = ["ingress", "domain", "tls", "certificate", "cert-manager", "load balancer"];
const WORKLOAD_TERMS = ["deploy app", "application", "workload", "service", "namespace"];

export function listProviders() {
  return Object.values(PROVIDERS);
}

export function normalizeProvider(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["amazon", "amazon web services", "eks"].includes(key)) return "aws";
  if (["az", "microsoft azure", "aks"].includes(key)) return "azure";
  if (["google", "google cloud", "gke"].includes(key)) return "gcp";
  return PROVIDERS[key] ? key : "aws";
}

export function inferPlanIntent(message = "") {
  const lower = message.toLowerCase();
  const destructive = DESTRUCTIVE_TERMS.some((term) => lower.includes(term));
  const production = /\b(prod|production)\b/.test(lower);
  const environment = production ? "production" : lower.includes("dev") ? "development" : "staging";
  const wantsObservability = OBSERVABILITY_TERMS.some((term) => lower.includes(term));
  const wantsIngress = INGRESS_TERMS.some((term) => lower.includes(term));
  const wantsWorkload = WORKLOAD_TERMS.some((term) => lower.includes(term));
  const wantsCluster = /cluster|kubernetes|eks|aks|gke|platform/.test(lower) || (!wantsObservability && !wantsIngress && !wantsWorkload);
  const highAvailability = production || /ha|highly available|multi[- ]az|resilien/.test(lower);
  const region = extractRegion(lower);

  return {
    destructive,
    environment,
    highAvailability,
    region,
    wantsCluster,
    wantsIngress,
    wantsObservability,
    wantsWorkload
  };
}

export function generateAgentResponse({ message, workspace = {}, providerConnection = null, provider = null }) {
  const selectedProvider = normalizeProvider(providerConnection?.provider || provider || workspace.cloudPreference || message);
  const cloud = PROVIDERS[selectedProvider];
  const intent = inferPlanIntent(message);
  const region = intent.region || providerConnection?.region || cloud.defaultRegion;
  const hasProvider = Boolean(providerConnection?.id);
  const blocked = intent.destructive || (intent.environment === "production" && !hasProvider);
  const approvalRequired = true;
  const risk = computeRisk(intent, hasProvider);
  const title = `${cloud.label} ${cloud.cluster} ${intent.environment} platform plan`;

  const plan = {
    id: `plan_${Date.now().toString(36)}`,
    title,
    provider: cloud.id,
    providerLabel: cloud.label,
    cluster: cloud.cluster,
    environment: intent.environment,
    region,
    status: blocked ? "blocked" : "ready_for_review",
    risk,
    blocked,
    approvalRequired,
    providerConnected: hasProvider,
    summary: buildSummary(cloud, intent, region, hasProvider),
    assumptions: buildAssumptions(workspace, cloud, intent, region),
    terraformChanges: buildTerraformChanges(cloud, intent, region),
    gitopsChanges: buildGitOpsChanges(intent),
    securityChecks: buildSecurityChecks(cloud, intent, hasProvider),
    executionSteps: buildExecutionSteps(cloud, intent, blocked),
    plannedFiles: buildPlannedFiles(cloud, intent.environment, region),
    contextRules: STANDARD_STACK.contextRules
  };

  return {
    role: "assistant",
    response: formatResponse(plan),
    plan
  };
}

export function validateProviderConnection(provider, payload = {}) {
  const selectedProvider = normalizeProvider(provider);
  const errors = [];

  if (payload.accessKey || payload.secretKey || payload.clientSecret || payload.privateKey) {
    errors.push("Use workload identity or role trust details, not static secrets.");
  }

  if (selectedProvider === "aws") {
    if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/.test(String(payload.roleArn || ""))) {
      errors.push("AWS connection requires an IAM role ARN.");
    }
    if (!String(payload.externalId || "").trim()) errors.push("AWS connection requires an external ID.");
  }

  if (selectedProvider === "azure") {
    if (!isUuidLike(payload.tenantId)) errors.push("Azure connection requires a tenant ID.");
    if (!isUuidLike(payload.subscriptionId)) errors.push("Azure connection requires a subscription ID.");
    if (!isUuidLike(payload.clientId)) errors.push("Azure connection requires an app/client ID.");
  }

  if (selectedProvider === "gcp") {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(payload.projectId || ""))) {
      errors.push("GCP connection requires a project ID.");
    }
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(String(payload.serviceAccountEmail || ""))) {
      errors.push("GCP connection requires a service account email.");
    }
  }

  if (!String(payload.region || "").trim()) errors.push(`${PROVIDERS[selectedProvider].label} connection requires a default region.`);

  return {
    ok: errors.length === 0,
    errors,
    provider: selectedProvider,
    sanitized: sanitizeConnection(selectedProvider, payload)
  };
}

function buildSummary(cloud, intent, region, hasProvider) {
  const pieces = [
    `Target: ${cloud.cluster} in ${region}`,
    `Boundary: Terraform for cloud resources, GitOps for Kubernetes state`,
    `Provider trust: ${hasProvider ? "connected" : "not connected yet"}`
  ];
  if (intent.wantsObservability) pieces.push("Includes observability baseline");
  if (intent.wantsIngress) pieces.push("Includes ingress and TLS baseline");
  if (intent.highAvailability) pieces.push("High availability enabled");
  return pieces.join(". ");
}

function buildAssumptions(workspace, cloud, intent, region) {
  const company = workspace.companyName || "the customer";
  const nodePools = intent.environment === "production" ? "system and workload node pools across at least two zones" : "a small system node pool and one workload node pool";
  return [
    `${company} wants a standardized ${cloud.label} Kubernetes platform rather than bespoke cloud resources.`,
    `${cloud.network} will use private subnets, managed NAT egress, and no public worker nodes.`,
    `${cloud.cluster} runs in ${region} with ${nodePools}.`,
    "Argo CD is bootstrapped by Terraform, then owns ongoing cluster configuration."
  ];
}

function buildTerraformChanges(cloud, intent, region) {
  const changes = [
    `Create or reuse remote state resources for ${cloud.label}.`,
    `Provision ${cloud.network}, private subnets, routing, and least-privilege control-plane access in ${region}.`,
    `Provision ${cloud.cluster} with managed node pools, cluster logging, encryption, and ${cloud.identity}.`,
    "Install initial Argo CD release only enough to hand off to GitOps."
  ];

  if (intent.highAvailability) {
    changes.push("Enable multi-zone node placement and separate system/workload node pools.");
  }

  return changes;
}

function buildGitOpsChanges(intent) {
  const changes = [
    "Register Argo CD self-management Application.",
    "Apply platform/core overlay with namespaces, RBAC, policies, and shared operators.",
    "Apply External Secrets Operator and secret-store placeholders without storing secret values."
  ];

  if (intent.wantsIngress || intent.wantsCluster) {
    changes.push("Apply ingress-nginx and cert-manager overlays for HTTP ingress and TLS issuance.");
  }

  if (intent.wantsObservability || intent.wantsCluster) {
    changes.push("Apply kube-prometheus-stack overlay with default alerts and dashboards.");
  }

  if (intent.wantsWorkload) {
    changes.push("Create an application overlay with namespace, network policy, service, and Argo CD Application.");
  }

  return changes;
}

function buildSecurityChecks(cloud, intent, hasProvider) {
  const checks = [
    `Verify ${cloud.identity} trust before any plan can access the account.`,
    "Run terraform fmt, terraform validate, and a plan diff before approval.",
    "Run kustomize build for platform and application overlays.",
    "Block direct Kubernetes mutations outside GitOps."
  ];

  if (!hasProvider) checks.unshift("Provider connection is required before generating a real cloud plan.");
  if (intent.environment === "production") checks.push("Require rollback notes, maintenance window, and second approval for production.");
  if (intent.destructive) checks.push("Destructive requests are blocked until inventory, dependencies, backups, and explicit break-glass approval are attached.");

  return checks;
}

function buildExecutionSteps(cloud, intent, blocked) {
  if (blocked) {
    return [
      "Collect missing provider and risk context.",
      "Re-plan with account inventory and dependency graph.",
      "Request human approval after the risk gate is satisfied."
    ];
  }

  return [
    `Generate DStack-style Terraform modules and provider call directories for ${cloud.terraformStacks.join(", ")}.`,
    "Open a plan review with Terraform and GitOps diffs.",
    "Wait for approval.",
    "Apply Terraform from each provider call directory in order: common, cluster, argocd.",
    "Sync Argo CD platform and application overlays."
  ];
}

function buildPlannedFiles(cloud, environment, region) {
  const providerPath = `infrastructure/terraform/providers/${cloud.id}/${slugPathPart(region || cloud.defaultRegion)}`;
  const modulePath = `infrastructure/terraform/modules/${cloud.id}`;
  const cluster = cloud.cluster.toLowerCase();
  const overlayPath = `k8s-cluster-configuration/kustomize/platform/core/overlays/${environment}`;
  return [
    `${modulePath}/common/main.tf`,
    `${modulePath}/${cluster}/main.tf`,
    `${modulePath}/${cluster}-argocd/main.tf`,
    `${providerPath}/common/main.tf`,
    `${providerPath}/${cluster}/main.tf`,
    `${providerPath}/${cluster}-argocd/main.tf`,
    `${overlayPath}/kustomization.yaml`,
    `${overlayPath}/platform-applications.yaml`
  ];
}

function slugPathPart(value) {
  return String(value || "default-region")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default-region";
}

function formatResponse(plan) {
  const gate = plan.blocked
    ? "I am blocking execution until the missing safety context is attached."
    : "I can prepare this for review; apply remains gated by explicit approval.";

  return [
    plan.summary,
    gate,
    `Next concrete output: ${plan.plannedFiles[0]} through ${plan.plannedFiles[plan.plannedFiles.length - 1]}.`
  ].join("\n\n");
}

function computeRisk(intent, hasProvider) {
  if (intent.destructive) return "critical";
  if (intent.environment === "production") return hasProvider ? "high" : "critical";
  if (intent.highAvailability || intent.wantsIngress) return "medium";
  return "low";
}

function extractRegion(text) {
  const aws = text.match(/\b(?:us|eu|ap|ca|sa|me|af)-[a-z]+-\d\b/);
  if (aws) return aws[0];
  const azureOrGcp = text.match(/\b(?:eastus|westus|westeurope|northeurope|europe-west\d|us-central\d|asia-east\d)\b/);
  return azureOrGcp ? azureOrGcp[0] : null;
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function sanitizeConnection(provider, payload) {
  const allowed = new Set(PROVIDERS[provider].connectFields);
  return Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, String(value || "").trim()])
  );
}

export type CloudProvider = "aws" | "azure" | "gcp";

export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
};

export type Workspace = {
  id: string;
  userId: string;
  companyName: string;
  cloudPreference: CloudProvider;
  createdAt: string;
  onboardingCompletedAt?: string;
  firstResourcePlanId?: string;
  terraformApplyDisabled?: boolean;
  codexEnabled?: boolean;
  codexModel?: string;
  selectedTerraformRoot?: string;
  gitProvider?: GitProvider;
  repositoryMode?: GitRepositoryMode;
  repositoryUrl?: string;
  repositoryBranch?: string;
};

export type EncryptedSecret = {
  algorithm: "aes-256-gcm";
  iv: string;
  ciphertext: string;
  tag: string;
  createdAt: string;
};

export type ProviderConnection = {
  id: string;
  workspaceId: string;
  provider: CloudProvider;
  region: string;
  details: Record<string, string>;
  secrets?: Record<string, EncryptedSecret>;
  status: "connected" | "connected_mock";
  createdAt: string;
};

export type GitRepositoryMode = "dstack" | "existing";
export type GitAuthMethod = "none" | "ssh" | "token";
export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "generic";

export type GitConnection = {
  id: string;
  workspaceId: string;
  gitProvider?: GitProvider;
  repositoryMode: GitRepositoryMode;
  repositoryUrl: string;
  branch?: string;
  authMethod: GitAuthMethod;
  details: Record<string, string>;
  secrets?: Record<string, EncryptedSecret>;
  status: "configured";
  createdAt: string;
};

export type Chat = {
  id: string;
  workspaceId: string;
  title: string;
  codexThreadId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  workspaceId: string;
  chatId?: string;
  role: "user" | "assistant";
  content: string;
  planId?: string;
  actions?: MessageAction[];
  createdAt: string;
};

export type MessageAction = {
  id: string;
  label: string;
  kind: "open_inputs" | "open_runs" | "open_files" | "open_checks" | "open_plan";
  rootPath?: string;
  planId?: string;
};

export type InfraPlan = {
  id: string;
  workspaceId: string;
  chatId?: string;
  title: string;
  provider: CloudProvider;
  providerLabel: string;
  cluster: string;
  environment: string;
  region: string;
  status: "ready_for_review" | "blocked" | "approved_for_apply" | "approved_mock_apply_queued";
  risk: "low" | "medium" | "high" | "critical";
  blocked: boolean;
  approvalRequired: boolean;
  providerConnected: boolean;
  summary: string;
  assumptions: string[];
  terraformChanges: string[];
  gitopsChanges: string[];
  securityChecks: string[];
  executionSteps: string[];
  plannedFiles: string[];
  materializedFiles?: string[];
  contextRules: string[];
  createdAt: string;
  approvedAt?: string;
};

export type Event = {
  id: string;
  workspaceId: string;
  type:
    | "workspace.registered"
    | "workspace.onboarding_completed"
    | "git.repository_configured"
    | "provider.connected"
    | "plan.created"
    | "plan.files_materialized"
    | "plan.approved"
    | "sandbox.run_started"
    | "sandbox.run_completed"
    | "sandbox.run_failed";
  label: string;
  createdAt: string;
};

export type TerraformPlanResourceChange = {
  address: string;
  type: string;
  name: string;
  providerName?: string;
  actions: string[];
};

export type TerraformPlanSummary = {
  adds: number;
  changes: number;
  destroys: number;
  replacements: number;
  resources: TerraformPlanResourceChange[];
  dangerous: boolean;
  warnings: string[];
};

export type SandboxRun = {
  id: string;
  workspaceId: string;
  planId?: string;
  rootPath?: string;
  mode: "terraform-fmt" | "validate" | "terraform-plan" | "terraform-apply" | "terraform-destroy";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  command: string[];
  exitCode: number | null;
  output: string;
  planSummary?: TerraformPlanSummary;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type RootLock = {
  id: string;
  workspaceId: string;
  rootPath: string;
  runId: string;
  mode: SandboxRun["mode"];
  createdAt: string;
  expiresAt: string;
};

export type TerraformVariableDefinition = {
  name: string;
  description?: string;
  type?: string;
  required: boolean;
  sensitive: boolean;
  value?: string;
};

export type TerraformRootVariableValue = {
  id: string;
  workspaceId: string;
  rootPath: string;
  name: string;
  value?: string;
  secret?: EncryptedSecret;
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PolicyCheck = {
  id: string;
  label: string;
  severity: "info" | "warning" | "error";
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type TerraformRoot = {
  id: string;
  workspaceId: string;
  path: string;
  provider: CloudProvider;
  region: string;
  name: string;
  label: string;
  planId?: string;
  chatId?: string;
  initialized: boolean;
  backend: "local" | "remote" | "unknown";
  applied: boolean;
  resourceCount: number;
  resources: string[];
  lastFmt?: SandboxRun;
  lastValidate?: SandboxRun;
  lastPlan?: SandboxRun;
  lastApply?: SandboxRun;
  lastDestroy?: SandboxRun;
  lastRun?: SandboxRun;
  lock?: RootLock;
  variables: TerraformVariableDefinition[];
  checks: PolicyCheck[];
};

export type WorkspaceDiffFile = {
  path: string;
  status: string;
  diff: string;
};

export type GitWorkspaceStatus = {
  available: boolean;
  initialized: boolean;
  repositoryName?: string;
  remoteUrl?: string;
  branch?: string;
  clean: boolean;
  files: WorkspaceDiffFile[];
  message?: string;
};

export type AppData = {
  users: User[];
  workspaces: Workspace[];
  chats: Chat[];
  providerConnections: ProviderConnection[];
  gitConnections: GitConnection[];
  messages: Message[];
  plans: InfraPlan[];
  events: Event[];
  sandboxRuns: SandboxRun[];
  rootLocks: RootLock[];
  terraformVariables: TerraformRootVariableValue[];
};

export type SessionPayload = {
  userId: string;
  workspaceId: string;
  exp: number;
};

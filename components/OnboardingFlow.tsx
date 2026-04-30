"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CloudProvider, GitAuthMethod, GitProvider, GitRepositoryMode, GitWorkspaceStatus } from "@/src/lib/types";
import { CODEX_MODEL_OPTIONS } from "@/src/lib/codex-models";
import { Icon } from "./Icon";

type OnboardingProvider = Extract<CloudProvider, "aws" | "azure">;
type Field = [string, string, string, ("text" | "password")?];
type CodexStatus = "idle" | "checking" | "ready" | "missing";
type CredentialTestResult = { status: string; label: string; detail: string };
type ProviderMeta = {
  label: string;
  resource: string;
  region: string;
  fields: Field[];
};
type ProviderTheme = {
  card: string;
  accent: string;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  fieldFocus: string;
};

const onboardingSteps = [
  { section: "Cloud", title: "Pick your cloud", description: "Pick AWS or Azure." },
  { section: "Cloud", title: "Account", description: "Prepare cloud trust." },
  { section: "Cloud", title: "Permission", description: "Grant MVP access." },
  { section: "Cloud", title: "Credentials", description: "Save provider details." },
  { section: "Git", title: "Git host", description: "Pick where Git lives." },
  { section: "Git", title: "Repository", description: "Import or clone." },
  { section: "Git", title: "Git access", description: "Configure auth profile." },
  { section: "Codex", title: "Codex", description: "Verify local CLI auth." },
  { section: "Codex", title: "First resource", description: "Generate starter stack." }
];

const providerDetails: Record<OnboardingProvider, ProviderMeta> = {
  aws: {
    label: "AWS",
    resource: "AWS Lambda",
    region: "eu-central-1",
    fields: [
      ["roleArn", "IAM role ARN", "arn:aws:iam::123456789012:role/a2w-infra-agent"],
      ["externalId", "External ID", "a2w-demo-external-id"],
      ["region", "Region", "eu-central-1"]
    ]
  },
  azure: {
    label: "Azure",
    resource: "Azure Function",
    region: "westeurope",
    fields: [
      ["tenantId", "Tenant ID", "11111111-1111-4111-8111-111111111111"],
      ["subscriptionId", "Subscription ID", "22222222-2222-4222-8222-222222222222"],
      ["clientId", "Client ID", "33333333-3333-4333-8333-333333333333"],
      ["clientSecret", "Client secret", "", "password"],
      ["region", "Region", "westeurope"]
    ]
  }
};

const providerThemes = {
  aws: {
    card: "border-[#232f3e] bg-[#232f3e] text-white shadow-[#232f3e]/20",
    accent: "bg-[#ff9900]",
    accentText: "text-[#ff9900]",
    accentBorder: "border-[#ff9900]/35",
    accentBg: "bg-[#fff8ed]",
    fieldFocus: "focus:border-[#ff9900]"
  },
  azure: {
    card: "border-[#0078d4] bg-[#0078d4] text-white shadow-[#0078d4]/20",
    accent: "bg-[#0078d4]",
    accentText: "text-[#0078d4]",
    accentBorder: "border-[#0078d4]/35",
    accentBg: "bg-[#f2f8ff]",
    fieldFocus: "focus:border-[#0078d4]"
  }
} satisfies Record<OnboardingProvider, ProviderTheme>;

const gitProviders: Array<{ id: GitProvider; label: string; icon: string; body: string }> = [
  { id: "github", label: "GitHub", icon: "fa-brands fa-github", body: "Use a GitHub repository or create one with a token." },
  { id: "gitlab", label: "GitLab", icon: "fa-brands fa-gitlab", body: "Use a GitLab project remote." },
  { id: "bitbucket", label: "Bitbucket", icon: "fa-brands fa-bitbucket", body: "Use a Bitbucket repository remote." },
  { id: "azure-devops", label: "Azure DevOps", icon: "fa-brands fa-microsoft", body: "Use an Azure Repos Git remote." },
  { id: "generic", label: "Other Git", icon: "fa-code-branch", body: "Use any SSH or HTTPS Git remote." }
];

export function OnboardingFlow({
  companyName,
  cloudPreference
}: {
  companyName: string;
  cloudPreference: CloudProvider;
}) {
  const router = useRouter();
  const initial = cloudPreference === "azure" ? "azure" : "aws";
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<OnboardingProvider>(initial);
  const [details, setDetails] = useState<Record<string, string>>(() => initialDetails(initial));
  const [codexStatus, setCodexStatus] = useState<CodexStatus>("idle");
  const [codexOutput, setCodexOutput] = useState("");
  const [codexModel, setCodexModel] = useState("");
  const [gitStatus, setGitStatus] = useState<GitWorkspaceStatus | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitProvider, setGitProvider] = useState<GitProvider>("github");
  const [repositoryMode, setRepositoryMode] = useState<GitRepositoryMode>("dstack");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryName, setRepositoryName] = useState("a2w-infrastructure");
  const [repositoryOwner, setRepositoryOwner] = useState("");
  const [repositoryBranch, setRepositoryBranch] = useState("");
  const [gitAuthMethod, setGitAuthMethod] = useState<GitAuthMethod>("none");
  const [gitUsername, setGitUsername] = useState("");
  const [gitToken, setGitToken] = useState("");
  const [gitSshPrivateKey, setGitSshPrivateKey] = useState("");
  const [credentialTesting, setCredentialTesting] = useState(false);
  const [credentialTest, setCredentialTest] = useState<CredentialTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const meta = providerDetails[provider];

  useEffect(() => {
    setDetails(initialDetails(provider));
    setCredentialTest(null);
  }, [provider]);

  async function complete() {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          codexEnabled: codexStatus === "ready",
          codexModel,
          gitProvider,
          repositoryMode,
          repositoryUrl,
          repositoryName,
          repositoryOwner,
          repositoryBranch,
          gitAuthMethod,
          gitUsername,
          gitToken,
          gitSshPrivateKey,
          ...details
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || "Could not complete onboarding.");
      router.push("/dashboard/agent");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function checkCodex() {
    setError(null);
    setCodexStatus("checking");

    try {
      const response = await fetch("/api/codex/status");
      const data = await response.json();
      setCodexOutput(data.output || "");
      if (!response.ok) throw new Error(data.error || "Could not check Codex login.");
      if (!data.authenticated) {
        setCodexStatus("missing");
        throw new Error("Codex is not logged in on this host yet. Run `codex login`, then check again.");
      }
      setCodexStatus("ready");
      return true;
    } catch (err) {
      setCodexStatus("missing");
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function continueFromCodex() {
    if (codexStatus === "ready") {
      setStep(8);
      return;
    }
    const ready = await checkCodex();
    if (ready) setStep(8);
  }

  async function refreshGit() {
    setGitLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/git");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read Git status.");
      setGitStatus(data.git);
      return data.git as GitWorkspaceStatus;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setGitLoading(false);
    }
  }

  async function continueFromGit() {
    setError(null);
    if (repositoryMode === "existing" && !repositoryUrl.trim()) {
      setError("Enter the Git repository URL to clone.");
      return;
    }
    if (repositoryMode === "dstack" && !repositoryName.trim()) {
      setError("Enter the repository name for the A2W best-practices import.");
      return;
    }
    if (repositoryMode === "dstack" && !repositoryUrl.trim() && !(gitProvider === "github" && gitAuthMethod === "token")) {
      setError("Enter an empty remote repository URL, or use a GitHub HTTPS token so A2W can create the repository.");
      return;
    }
    if (gitAuthMethod === "token" && !gitToken.trim()) {
      setError("Enter an HTTPS access token or choose no auth.");
      return;
    }
    if (gitAuthMethod === "ssh" && !gitSshPrivateKey.trim()) {
      setError("Paste the SSH private key or choose no auth.");
      return;
    }
    const current = gitStatus || await refreshGit();
    if (current?.available) {
      setStep(7);
      return;
    }
    setError(current?.message || "Git is not available on this host.");
  }

  async function testCredentials() {
    setCredentialTesting(true);
    setCredentialTest(null);
    setError(null);

    try {
      const response = await fetch("/api/provider-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, ...details })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || "Credential test failed.");
      setCredentialTest(data.result);
    } catch (err) {
      setCredentialTest({
        status: "failed",
        label: "Credential test failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setCredentialTesting(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-hidden bg-paper p-3 text-black">
      <section className="grid h-full min-h-0 w-full grid-cols-12 gap-2">
        <ProgressRail step={step} provider={provider} onStepClick={setStep} />
        <div className="col-span-9 flex min-h-0 flex-col">
        {step === 0 ? (
          <Screen>
            <div className="max-w-2xl">
              <StepLabel step="1" />
              <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                Pick your cloud.
              </h1>
              <p className="mt-4 text-base leading-7 text-gray-600">
                We start with one small serverless function, then move the entire deployment flow into chat.
              </p>
            </div>
            <div className="mt-6 grid min-h-0 gap-4 md:grid-cols-2">
              <ProviderCard
                active={provider === "aws"}
                provider="aws"
                title="AWS"
                body="Create a Lambda function that returns your company greeting."
                onClick={() => setProvider("aws")}
              />
              <ProviderCard
                active={provider === "azure"}
                provider="azure"
                title="Azure"
                body="Create an Azure Function using the same greeting contract."
                onClick={() => setProvider("azure")}
              />
              <ComingSoonProviderCard className="md:col-start-1 md:row-start-2" />
            </div>
            <Footer next={() => setStep(1)} />
          </Screen>
        ) : null}

        {step === 1 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="2" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Create the {meta.label} identity.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Set up the cloud identity A2W will use to run Terraform.
                </p>
              </div>
              <ProviderSetupPanel
                provider={provider}
                title={provider === "azure" ? "Create an app registration" : "Create an IAM role"}
                items={
                  provider === "azure"
                    ? [
                        "Pick the Azure subscription to deploy into.",
                        "Create an app registration named a2w.",
                        "Create a client secret and keep it ready."
                      ]
                    : [
                        "Pick the AWS account to deploy into.",
                        "Create an IAM role named a2w-infra-agent.",
                        "Keep the role ARN and external ID ready."
                      ]
                }
              />
            </div>
            <Footer back={() => setStep(0)} next={() => setStep(2)} />
          </Screen>
        ) : null}

        {step === 2 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="3" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Grant access.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Give the identity enough access to create the first resource.
                </p>
              </div>
              <ProviderPermissionPanel
                provider={provider}
                title={provider === "azure" ? "Assign Owner on the subscription" : "Attach AdministratorAccess"}
                items={
                  provider === "azure"
                    ? [
                        "Open Subscription > Access control IAM.",
                        "Add Owner role assignment to the app registration."
                      ]
                    : [
                        "Attach AdministratorAccess to the a2w-infra-agent role.",
                        "Confirm the trust policy uses your external ID."
                      ]
                }
              />
            </div>
            <Footer back={() => setStep(1)} next={() => setStep(3)} />
          </Screen>
        ) : null}

        {step === 3 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="4" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Enter the credentials.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Paste the values from the cloud console.
                </p>
              </div>
              <CredentialsPanel
                provider={provider}
                meta={meta}
                details={details}
                error={error}
                testing={credentialTesting}
                testResult={credentialTest}
                onTest={testCredentials}
                onFieldChange={(name, value) => {
                  setCredentialTest(null);
                  setDetails((current) => ({ ...current, [name]: value }));
                }}
              />
            </div>
            <Footer back={() => setStep(2)} next={() => setStep(4)} />
          </Screen>
        ) : null}

        {step === 4 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="5" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Choose your Git host.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Pick where the Terraform repository will live.
                </p>
              </div>

              <GitProviderPanel provider={gitProvider} onProviderChange={setGitProvider} />
            </div>
            {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
            <Footer back={() => setStep(3)} next={() => setStep(5)} />
          </Screen>
        ) : null}

        {step === 5 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="6" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Configure the repository.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Import A2W best practices into your own remote, or clone an existing repository.
                </p>
              </div>

              <RepositorySourcePanel
                gitProvider={gitProvider}
                mode={repositoryMode}
                repositoryName={repositoryName}
                repositoryOwner={repositoryOwner}
                repositoryUrl={repositoryUrl}
                repositoryBranch={repositoryBranch}
                onModeChange={setRepositoryMode}
                onRepositoryNameChange={setRepositoryName}
                onRepositoryOwnerChange={setRepositoryOwner}
                onRepositoryUrlChange={setRepositoryUrl}
                onRepositoryBranchChange={setRepositoryBranch}
              />
            </div>
            {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
            <Footer back={() => setStep(4)} next={() => setStep(6)} />
          </Screen>
        ) : null}

        {step === 6 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="7" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Configure Git access.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Add credentials that can clone and push to the selected remote.
                </p>
              </div>

              <GitAccessPanel
                gitProvider={gitProvider}
                mode={repositoryMode}
                authMethod={gitAuthMethod}
                username={gitUsername}
                token={gitToken}
                sshPrivateKey={gitSshPrivateKey}
                gitStatus={gitStatus}
                loading={gitLoading}
                onAuthMethodChange={setGitAuthMethod}
                onUsernameChange={setGitUsername}
                onTokenChange={setGitToken}
                onSshPrivateKeyChange={setGitSshPrivateKey}
                onRefresh={refreshGit}
              />
            </div>
            <div className="mt-auto flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="h-11 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={continueFromGit}
                disabled={gitLoading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={gitLoading ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                Continue to Codex
              </button>
            </div>
          </Screen>
        ) : null}

        {step === 7 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="8" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Connect Codex on this host.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  A2W uses the self-hosted machine's Codex CLI login. Your OpenAI or ChatGPT credentials stay with Codex; this app only checks whether the local CLI is authenticated.
                </p>
              </div>

              <div className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg text-white">
                      <Icon name="fa-terminal" />
                    </span>
                    <div>
                      <p className="font-semibold">Codex CLI</p>
                      <p className="text-sm text-gray-500">Host authentication</p>
                    </div>
                  </div>
                  <StatusPill status={codexStatus} />
                </div>

                <div className="mt-4 grid gap-2">
                  <CommandLine command="codex login" />
                  <CommandLine command="codex login status" />
                </div>

                <label className="mt-4 grid gap-2 text-sm font-medium text-gray-700">
                  Codex model
                  <input
                    list="onboarding-codex-models"
                    value={codexModel}
                    onChange={(event) => setCodexModel(event.target.value)}
                    placeholder="Codex CLI default"
                    className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                  />
                  <datalist id="onboarding-codex-models">
                    {CODEX_MODEL_OPTIONS.filter((option) => option.id).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </label>

                <p className="mt-4 text-sm leading-6 text-gray-600">
                  Run the login command in the same environment where this Next.js server runs, then check the status here. Leave the model empty to use whatever Codex CLI is configured to use.
                </p>

                {codexOutput ? (
                  <pre className="thin-scrollbar mt-4 max-h-20 overflow-auto whitespace-pre-wrap rounded-[1.25rem] bg-black p-3 text-xs leading-5 text-gray-100">
                    {codexOutput}
                  </pre>
                ) : null}

                {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

                <button
                  type="button"
                  onClick={checkCodex}
                  disabled={codexStatus === "checking"}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <Icon name={codexStatus === "checking" ? "fa-circle-notch fa-spin" : "fa-rotate"} />
                  Check Codex login
                </button>
              </div>
            </div>
            <div className="mt-auto flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(6)}
                className="h-11 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={continueFromCodex}
                disabled={codexStatus === "checking"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={codexStatus === "checking" ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                {codexStatus === "ready" ? "Continue" : "Verify and continue"}
              </button>
            </div>
          </Screen>
        ) : null}

        {step === 8 ? (
          <Screen>
            <div className="grid max-w-3xl gap-6">
              <div>
                <StepLabel step="9" />
                <h1 className="mt-3 text-4xl font-semibold leading-[1.02] sm:text-5xl">
                  Create the first resource.
                </h1>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  A2W will write Terraform and function code for a {meta.resource} that returns <span className="font-semibold text-black">hello! {companyName}</span>.
                </p>
              </div>
              <div className="rounded-[2rem] bg-black p-5 text-white shadow-2xl shadow-black/20">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Preview</p>
                <h2 className="mt-4 text-2xl font-semibold">{meta.resource}</h2>
                <div className="mt-5 rounded-[1.25rem] bg-white/10 p-4">
                  <p className="font-mono text-sm text-gray-200">{`{"message":"hello! ${companyName}"}`}</p>
                </div>
                <div className="mt-5 grid gap-3 text-sm text-gray-300">
                  <span>Provider: {meta.label}</span>
                  <span>Region: {details.region || meta.region}</span>
                  <span>Repository: {repositoryMode === "dstack" ? repositoryName : repositoryUrl || "existing repository"}</span>
                  <span>Deployment: Terraform in chat</span>
                </div>
              </div>
            </div>
            <div className="mt-auto flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(7)}
                className="h-11 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={complete}
                disabled={loading}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                Create resource and open chat
              </button>
            </div>
          </Screen>
        ) : null}
        </div>
      </section>
    </main>
  );
}

function initialDetails(provider: OnboardingProvider) {
  return Object.fromEntries(providerDetails[provider].fields.map(([name, , value]) => [name, value]));
}

function ProgressRail({
  step,
  provider,
  onStepClick
}: {
  step: number;
  provider: OnboardingProvider;
  onStepClick: (step: number) => void;
}) {
  const progress = onboardingSteps.length <= 1 ? 100 : (step / (onboardingSteps.length - 1)) * 100;
  const groups = groupedOnboardingSteps();

  return (
    <aside className="col-span-3 flex min-h-0 flex-col rounded-[2rem] border border-gray-200 bg-white/70 p-4 shadow-2xl shadow-black/10 backdrop-blur">
      <div className="shrink-0">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-black text-[11px] font-semibold text-white shadow-sm">
            A2W
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-black">A2W-Codex-Terraform-v0.0.1</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-gray-500">Onboarding</p>
              <p className="shrink-0 text-xs text-gray-500">
                {step + 1} of {onboardingSteps.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="thin-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative grid gap-4">
          <span className="absolute bottom-[22px] left-[22px] top-[22px] w-px rounded-full bg-gray-200" />
          <span
            className="absolute left-[22px] top-[22px] w-px rounded-full bg-black transition-all duration-500"
            style={{ height: `calc((100% - 44px) * ${progress / 100})` }}
          />
          {groups.map((group) => {
            const groupActive = step >= group.start && step <= group.end;
            const groupCompleted = step > group.end;
            const branchProgress = groupCompleted
              ? 1
              : groupActive
                ? group.items.length <= 1
                  ? 1
                  : (step - group.start) / (group.items.length - 1)
                : 0;

            return (
              <div key={group.section} className="relative z-10 grid grid-cols-[44px_1fr] gap-3">
                <span
                  className={`pointer-events-none absolute left-[22px] top-[22px] z-0 h-px w-[34px] transition-colors ${
                    groupActive || groupCompleted ? "bg-black" : "bg-gray-200"
                  }`}
                />
                <SectionLogo section={group.section} provider={provider} active={groupActive} completed={groupCompleted} />
                <div className="min-w-0">
                  <div
                    className={`flex h-11 items-center rounded-[1.1rem] px-3 text-xs font-semibold uppercase transition-colors ${
                      groupActive || groupCompleted ? "text-black" : "text-gray-400"
                    }`}
                  >
                    {group.section}
                  </div>
                  <div className="relative mt-1 grid gap-1">
                    <span className="absolute bottom-[22px] left-4 top-[22px] w-px rounded-full bg-gray-200" />
                    <span
                      className="absolute left-4 top-[22px] w-px rounded-full bg-black transition-all duration-500"
                      style={{ height: `calc((100% - 44px) * ${branchProgress})` }}
                    />
                    {group.items.map(({ item, index }) => {
                      const active = index === step;
                      const completed = index < step;
                      return (
                        <button
                          key={item.title}
                          type="button"
                          onClick={() => onStepClick(index)}
                          className={`group relative grid h-11 grid-cols-[32px_1fr] items-center gap-2 rounded-[1.15rem] pl-0 pr-2 text-left transition ${
                            active ? "bg-black text-white shadow-lg shadow-black/10" : completed ? "bg-white text-gray-900 hover:bg-gray-50" : "text-gray-500 hover:bg-white/70"
                          }`}
                        >
                          <span
                            className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border text-[11px] font-semibold shadow-sm transition ${
                              active
                                ? "border-white bg-white text-black"
                                : completed
                                  ? "border-black bg-black text-white"
                                  : "border-gray-200 bg-white text-gray-500 group-hover:border-gray-300"
                            }`}
                          >
                            {completed ? <Icon name="fa-check" /> : index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{item.title}</span>
                            <span className={`mt-0.5 block truncate text-xs ${active ? "text-white/70" : "text-gray-500"}`}>{item.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function groupedOnboardingSteps() {
  const groups: Array<{ section: string; start: number; end: number; items: Array<{ item: (typeof onboardingSteps)[number]; index: number }> }> = [];
  onboardingSteps.forEach((item, index) => {
    const current = groups.at(-1);
    if (!current || current.section !== item.section) {
      groups.push({ section: item.section, start: index, end: index, items: [{ item, index }] });
      return;
    }
    current.end = index;
    current.items.push({ item, index });
  });
  return groups;
}

function SectionLogo({
  section,
  provider,
  active,
  completed
}: {
  section: string;
  provider: OnboardingProvider;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div className="relative z-10 grid h-11 w-11 place-items-center">
      <span
        className={`grid h-8 w-8 place-items-center rounded-xl ring-1 ${
          active || completed ? "ring-black/25" : "ring-gray-200"
        }`}
      >
        {section === "Cloud" ? (
          <span className="scale-[0.72]">
            <ProviderLogo provider={provider} />
          </span>
        ) : section === "Git" ? (
          <i className="fa-brands fa-git-alt text-base text-[#f05032]" aria-hidden />
        ) : (
          <img src="/codex-logo.png" alt="" className="h-4 w-4 object-contain" />
        )}
      </span>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-enter flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-gray-200 bg-white/75 p-4 shadow-2xl shadow-black/10 backdrop-blur sm:p-6">
      {children}
    </div>
  );
}

function StepLabel({ step }: { step: string }) {
  return <p className="text-xs font-semibold uppercase text-gray-500">Step {step}</p>;
}

function ProviderCard({
  active,
  provider,
  title,
  body,
  onClick
}: {
  active: boolean;
  provider: OnboardingProvider;
  title: string;
  body: string;
  onClick: () => void;
}) {
  const style = provider === "azure"
    ? "border-[#0078d4] bg-[#0078d4] text-white shadow-[#0078d4]/20"
    : "border-[#232f3e] bg-[#232f3e] text-white shadow-[#232f3e]/20";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-[2rem] border p-5 text-left shadow-xl transition hover:-translate-y-0.5 ${style} ${
        active ? "ring-2 ring-black ring-offset-2 ring-offset-[#f7f7f4]" : "opacity-80 hover:opacity-100"
      }`}
    >
      <span className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm shadow-black/10">
        <ProviderLogo provider={provider} />
      </span>
      <h2 className="mt-5 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-white/80">{body}</p>
      <span className={`mt-5 inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ${active ? "bg-white text-black" : "bg-white/15 text-white"}`}>
        {active ? "Selected" : "Select"}
      </span>
    </button>
  );
}

function ComingSoonProviderCard({ className = "" }: { className?: string }) {
  return (
    <div
      aria-disabled="true"
      className={`relative overflow-hidden rounded-[2rem] border border-[#4285f4]/25 bg-white p-5 text-left text-gray-500 opacity-75 shadow-xl shadow-black/5 ${className}`}
    >
      <span className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#4285f4]/10" />
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm shadow-black/10">
        <GoogleCloudLogo />
      </span>
      <h2 className="mt-5 text-2xl font-semibold text-gray-900">GCP</h2>
      <p className="mt-2 text-sm leading-6 text-gray-500">
        Google Cloud support will follow after the AWS and Azure onboarding flow is solid.
      </p>
      <span className="mt-5 inline-flex h-7 items-center rounded-full bg-gray-100 px-3 text-xs font-semibold text-gray-500">
        Coming soon
      </span>
    </div>
  );
}

function GitProviderPanel({
  provider,
  onProviderChange
}: {
  provider: GitProvider;
  onProviderChange: (provider: GitProvider) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {gitProviders.map((item) => {
        const active = item.id === provider;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onProviderChange(item.id)}
            className={`rounded-[2rem] border p-5 text-left shadow-xl transition hover:-translate-y-0.5 ${
              active ? "border-black bg-black text-white shadow-black/10" : "border-gray-200 bg-white text-gray-700 shadow-black/5 hover:border-gray-300"
            }`}
          >
            <span className={`grid h-12 w-12 place-items-center rounded-2xl text-xl ${active ? "bg-white text-black" : "bg-gray-50 text-gray-700"}`}>
              <Icon name={item.icon} />
            </span>
            <h2 className="mt-5 text-2xl font-semibold">{item.label}</h2>
            <p className={`mt-2 text-sm leading-6 ${active ? "text-white/70" : "text-gray-500"}`}>{item.body}</p>
            <span className={`mt-5 inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold ${active ? "bg-white text-black" : "bg-gray-100 text-gray-500"}`}>
              {active ? "Selected" : "Select"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RepositorySourcePanel({
  gitProvider,
  mode,
  repositoryName,
  repositoryOwner,
  repositoryUrl,
  repositoryBranch,
  onModeChange,
  onRepositoryNameChange,
  onRepositoryOwnerChange,
  onRepositoryUrlChange,
  onRepositoryBranchChange
}: {
  gitProvider: GitProvider;
  mode: GitRepositoryMode;
  repositoryName: string;
  repositoryOwner: string;
  repositoryUrl: string;
  repositoryBranch: string;
  onModeChange: (mode: GitRepositoryMode) => void;
  onRepositoryNameChange: (value: string) => void;
  onRepositoryOwnerChange: (value: string) => void;
  onRepositoryUrlChange: (value: string) => void;
  onRepositoryBranchChange: (value: string) => void;
}) {
  const hostLabel = gitProviders.find((item) => item.id === gitProvider)?.label || "Git";
  const dstackUrlHelp = gitProvider === "github"
    ? "Use a GitHub HTTPS token next to create this repo automatically, or paste an existing empty repo URL."
    : "Create an empty repository in your Git host, then paste its SSH or HTTPS URL here.";

  return (
    <div className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg text-white">
          <Icon name="fa-code-branch" />
        </span>
        <div>
          <p className="font-semibold">Repository source</p>
          <p className="text-sm text-gray-500">This becomes the workspace Terraform repo.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <RepositoryChoiceCard
          active={mode === "dstack"}
          title="Start with A2W best practices"
          body="Import the DStack layout into your own remote repository."
          icon="fa-seedling"
          onClick={() => onModeChange("dstack")}
        />
        <RepositoryChoiceCard
          active={mode === "existing"}
          title="Existing repository"
          body="Clone your own Terraform repository and continue from there."
          icon="fa-code-fork"
          onClick={() => onModeChange("existing")}
        />
      </div>

      <div className="mt-5 grid gap-3">
        {mode === "dstack" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-gray-700">
              Repository name
              <input
                value={repositoryName}
                onChange={(event) => onRepositoryNameChange(event.target.value)}
                placeholder="a2w-infrastructure"
                className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
              />
            </label>
            {gitProvider === "github" ? (
              <label className="grid gap-2 text-sm font-medium text-gray-700">
                GitHub org
                <input
                  value={repositoryOwner}
                  onChange={(event) => onRepositoryOwnerChange(event.target.value)}
                  placeholder="optional"
                  className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <label className="grid gap-2 text-sm font-medium text-gray-700">
          {mode === "dstack" ? `${hostLabel} remote URL` : "Repository URL"}
          <input
            value={repositoryUrl}
            onChange={(event) => onRepositoryUrlChange(event.target.value)}
            placeholder={gitRemotePlaceholder(gitProvider, repositoryName)}
            className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
          />
          {mode === "dstack" ? <span className="text-xs font-normal leading-5 text-gray-500">{dstackUrlHelp}</span> : null}
        </label>
        <label className="grid gap-2 text-sm font-medium text-gray-700">
          Branch
          <input
            value={repositoryBranch}
            onChange={(event) => onRepositoryBranchChange(event.target.value)}
            placeholder={mode === "dstack" ? "default branch" : "main"}
            className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
          />
        </label>
      </div>
    </div>
  );
}

function RepositoryChoiceCard({
  active,
  title,
  body,
  icon,
  onClick
}: {
  active: boolean;
  title: string;
  body: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1.5rem] border p-4 text-left transition ${
        active ? "border-black bg-black text-white shadow-lg shadow-black/10" : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300"
      }`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${active ? "bg-white text-black" : "bg-white text-gray-700"}`}>
        <Icon name={icon} />
      </span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className={`mt-1 text-xs leading-5 ${active ? "text-white/70" : "text-gray-500"}`}>{body}</p>
    </button>
  );
}

function gitRemotePlaceholder(provider: GitProvider, repositoryName: string) {
  const name = repositoryName.trim() || "a2w-infrastructure";
  if (provider === "github") return `git@github.com:company/${name}.git`;
  if (provider === "gitlab") return `git@gitlab.com:company/${name}.git`;
  if (provider === "bitbucket") return `git@bitbucket.org:company/${name}.git`;
  if (provider === "azure-devops") return `git@ssh.dev.azure.com:v3/company/project/${name}`;
  return `git@example.com:company/${name}.git`;
}

function GitAccessPanel({
  gitProvider,
  mode,
  authMethod,
  username,
  token,
  sshPrivateKey,
  gitStatus,
  loading,
  onAuthMethodChange,
  onUsernameChange,
  onTokenChange,
  onSshPrivateKeyChange,
  onRefresh
}: {
  gitProvider: GitProvider;
  mode: GitRepositoryMode;
  authMethod: GitAuthMethod;
  username: string;
  token: string;
  sshPrivateKey: string;
  gitStatus: GitWorkspaceStatus | null;
  loading: boolean;
  onAuthMethodChange: (method: GitAuthMethod) => void;
  onUsernameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onSshPrivateKeyChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const canAutoCreateGithubRepo = mode === "dstack" && gitProvider === "github" && authMethod === "token";

  return (
    <div className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg text-white">
            <Icon name="fa-key" />
          </span>
          <div>
            <p className="font-semibold">Git profile</p>
            <p className="text-sm text-gray-500">Credentials for cloning the selected repository.</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gitStatus?.available ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
          {gitStatus?.available ? "git available" : "not checked"}
        </span>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {(["none", "token", "ssh"] as GitAuthMethod[]).map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => onAuthMethodChange(method)}
            className={`h-10 rounded-full px-4 text-sm font-semibold transition ${
              authMethod === method ? "bg-black text-white" : "border border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            {method === "none" ? "Host/public auth" : method === "token" ? "HTTPS token" : "SSH key"}
          </button>
        ))}
      </div>

      {authMethod === "none" ? (
        <p className="mt-3 rounded-[1.25rem] bg-gray-50 p-3 text-sm leading-6 text-gray-600">
          Use host/public auth only when the repository is public or this self-hosted machine already has Git credentials configured.
        </p>
      ) : null}

      {authMethod === "token" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-gray-700">
            Username
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              placeholder="x-access-token"
              className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-gray-700">
            Access token
            <input
              type="password"
              value={token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder="Git provider token"
              className="h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
            />
          </label>
        </div>
      ) : null}

      {authMethod === "ssh" ? (
        <label className="mt-4 grid gap-2 text-sm font-medium text-gray-700">
          SSH private key
          <textarea
            value={sshPrivateKey}
            onChange={(event) => onSshPrivateKeyChange(event.target.value)}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            className="h-28 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 font-mono text-xs text-black outline-none transition focus:border-black"
          />
        </label>
      ) : null}

      {canAutoCreateGithubRepo ? (
        <div className="mt-4 rounded-[1.25rem] bg-gray-50 p-4 text-sm leading-6 text-gray-600">
          If the remote URL is blank, A2W will create a private GitHub repository with the name from the previous step and push the DStack import there.
        </div>
      ) : null}

      {gitStatus ? (
        <div className="mt-4 grid gap-1.5 rounded-[1.5rem] border border-gray-200 p-3 text-sm">
          <SettingLine label="Git binary" value={gitStatus.available ? "available" : "missing"} />
          <SettingLine label="Current workspace" value={gitStatus.initialized ? "initialized" : "not initialized"} />
          <SettingLine label="Branch" value={gitStatus.branch || "-"} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-rotate"} />
        Check local Git
      </button>
    </div>
  );
}

function ProviderSetupPanel({
  provider,
  title,
  items
}: {
  provider: OnboardingProvider;
  title: string;
  items: string[];
}) {
  const theme = providerThemes[provider];
  const label = providerDetails[provider].label;

  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${theme.accent}`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid h-12 w-12 place-items-center rounded-2xl border ${theme.accentBorder} ${theme.accentBg}`}>
            <ProviderLogo provider={provider} />
          </span>
          <div>
            <p className={`text-sm font-semibold ${theme.accentText}`}>{label} setup</p>
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-gray-950">{title}</h2>
          </div>
        </div>
      </div>

      <CloudChecklist provider={provider} items={items} />
    </div>
  );
}

function ProviderPermissionPanel({
  provider,
  title,
  items
}: {
  provider: OnboardingProvider;
  title: string;
  items: string[];
}) {
  const theme = providerThemes[provider];

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${theme.accent}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid h-12 w-12 place-items-center rounded-2xl border ${theme.accentBorder} ${theme.accentBg} ${theme.accentText}`}>
            <Icon name={provider === "azure" ? "fa-key" : "fa-shield-halved"} />
          </span>
          <div>
            <p className={`text-sm font-semibold ${theme.accentText}`}>Permission model</p>
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-gray-950">{title}</h2>
          </div>
        </div>
      </div>

      <CloudChecklist provider={provider} items={items} />
    </div>
  );
}

function CloudChecklist({ provider, items }: { provider: OnboardingProvider; items: string[] }) {
  const theme = providerThemes[provider];
  const checklistKey = `${provider}:${items.join("\u0001")}`;
  const [checked, setChecked] = useState(() => items.map(() => false));

  useEffect(() => {
    setChecked(items.map(() => false));
  }, [checklistKey]);

  const allChecked = items.length > 0 && items.every((_, index) => checked[index]);

  return (
    <div className="mt-5 grid gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setChecked(items.map(() => true))}
          disabled={allChecked}
          className="h-8 rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-600 transition hover:border-gray-300 hover:text-black disabled:cursor-default disabled:border-gray-100 disabled:bg-gray-50 disabled:text-gray-400"
        >
          {allChecked ? "All checked" : "Check all"}
        </button>
      </div>

      {items.map((item, index) => {
        const isChecked = Boolean(checked[index]);

        return (
          <label
            key={item}
            className={`flex cursor-pointer items-start gap-3 rounded-[1.25rem] border p-3 text-sm leading-6 transition ${
              isChecked ? "border-gray-300 bg-white text-gray-900" : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300"
            }`}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(event) => {
                const nextChecked = event.target.checked;
                setChecked((current) => current.map((value, itemIndex) => (itemIndex === index ? nextChecked : value)));
              }}
              className="sr-only"
            />
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] transition ${
                isChecked ? `border-transparent text-white ${theme.accent}` : "border-gray-300 bg-white text-transparent"
              }`}
              aria-hidden
            >
              <Icon name="fa-check" />
            </span>
            <span>{item}</span>
          </label>
        );
      })}
    </div>
  );
}

function CredentialsPanel({
  provider,
  meta,
  details,
  error,
  testing,
  testResult,
  onTest,
  onFieldChange
}: {
  provider: OnboardingProvider;
  meta: ProviderMeta;
  details: Record<string, string>;
  error: string | null;
  testing: boolean;
  testResult: CredentialTestResult | null;
  onTest: () => void;
  onFieldChange: (name: string, value: string) => void;
}) {
  const theme = providerThemes[provider];
  const testButtonTone = !testResult
    ? "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-black"
    : testResult.status === "connected"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : testResult.status === "configured"
        ? "border-gray-200 bg-gray-100 text-gray-700"
        : "border-red-200 bg-red-50 text-red-700";
  const testButtonLabel = testing ? "Testing credentials" : testResult?.label || "Test credentials";

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${theme.accent}`} />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid h-12 w-12 place-items-center rounded-2xl border ${theme.accentBorder} ${theme.accentBg}`}>
            <ProviderLogo provider={provider} />
          </span>
          <div>
            <p className={`text-sm font-semibold ${theme.accentText}`}>{meta.label} credentials</p>
            <p className="text-sm text-gray-500">Required for Terraform</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          title={testResult?.detail}
          className={`inline-flex h-10 max-w-[260px] shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${testButtonTone}`}
        >
          <Icon name={testing ? "fa-circle-notch fa-spin" : "fa-plug-circle-check"} />
          <span className="truncate">{testButtonLabel}</span>
        </button>
      </div>

      <div className="mt-5 grid gap-3">
        {meta.fields.map(([name, label, value, type = "text"]) => (
          <label key={name} className="grid gap-2 text-sm font-medium text-gray-700">
            {label}
            <input
              name={name}
              type={type}
              value={details[name] ?? value}
              onChange={(event) => onFieldChange(name, event.target.value)}
              placeholder={type === "password" ? "Enter secret value" : undefined}
              className={`h-10 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition ${theme.fieldFocus}`}
            />
          </label>
        ))}
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function InstructionPanel({ icon, title, items }: { icon: string; title: string; items: string[] }) {
  return (
    <div className="rounded-[2rem] border border-gray-200 bg-white p-5 shadow-xl shadow-black/5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-black text-lg text-white">
          <Icon name={icon} />
        </span>
        <h2 className="text-2xl font-semibold">{title}</h2>
      </div>
      <div className="mt-5 grid gap-3">
        {items.map((item, index) => (
          <div key={item} className="flex items-start gap-3 rounded-[1.25rem] bg-gray-50 p-3 text-sm leading-6 text-gray-700">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-black text-[11px] font-semibold text-white">
              {index + 1}
            </span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-gray-50 px-4 py-2.5">
      <code className="text-sm font-semibold text-gray-900">{command}</code>
      <Icon name="fa-terminal" />
    </div>
  );
}

function StatusPill({ status }: { status: CodexStatus }) {
  const text = status === "ready" ? "logged in" : status === "checking" ? "checking" : status === "missing" ? "not ready" : "not checked";
  const tone = status === "ready" ? "bg-emerald-50 text-emerald-700" : status === "missing" ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-600";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{text}</span>;
}

function SettingLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="truncate font-medium text-gray-900">{value}</span>
    </div>
  );
}

function Footer({ back, next }: { back?: () => void; next: () => void }) {
  return (
    <div className="mt-auto flex flex-col-reverse gap-3 pt-4 sm:flex-row sm:justify-between">
      {back ? (
        <button type="button" onClick={back} className="h-11 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
          Back
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={next} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800">
        <Icon name="fa-arrow-right" />
        Continue
      </button>
    </div>
  );
}

function ProviderLogo({ provider }: { provider: OnboardingProvider }) {
  if (provider === "azure") return <AzureLogo />;
  return <i className="fa-brands fa-aws text-2xl text-[#ff9900]" aria-hidden />;
}

function GoogleCloudLogo() {
  return <i className="fa-brands fa-google text-2xl text-[#4285f4]" aria-hidden />;
}

function AzureLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden>
      <path fill="#0078d4" d="M8.35 3.08h6.02L8.13 21H2.36L8.35 3.08Z" />
      <path fill="#50a8f2" d="M15.24 3.08 21.64 21h-6.18l-1.08-3.2H7.69l4.48-6.55 3.07-8.17Z" />
      <path fill="#005a9e" d="M7.69 17.8h6.69l-3.48-6.55-3.21 6.55Z" />
    </svg>
  );
}

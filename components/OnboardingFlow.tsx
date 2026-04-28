"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CloudProvider, GitWorkspaceStatus } from "@/src/lib/types";
import { CODEX_MODEL_OPTIONS } from "@/src/lib/codex-models";
import { Brand } from "./Brand";
import { Icon } from "./Icon";

type OnboardingProvider = Extract<CloudProvider, "aws" | "azure">;
type Field = [string, string, string, ("text" | "password")?];
type CodexStatus = "idle" | "checking" | "ready" | "missing";

const providerDetails: Record<
  OnboardingProvider,
  {
    label: string;
    icon: string;
    resource: string;
    region: string;
    fields: Field[];
  }
> = {
  aws: {
    label: "AWS",
    icon: "fa-brands fa-aws",
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
    icon: "fa-brands fa-microsoft",
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const meta = providerDetails[provider];
  const progress = useMemo(() => ((step + 1) / 7) * 100, [step]);

  useEffect(() => {
    setDetails(initialDetails(provider));
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
      setStep(5);
      return;
    }
    const ready = await checkCodex();
    if (ready) setStep(5);
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

  async function initializeGitRepository() {
    setGitLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/git", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "init" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not initialize Git repository.");
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
    const current = gitStatus || await refreshGit();
    if (current?.initialized) {
      setStep(6);
      return;
    }
    const initialized = await initializeGitRepository();
    if (initialized?.initialized) setStep(6);
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-5 text-black">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Brand />
        <div className="hidden items-center gap-3 text-sm text-gray-500 sm:flex">
          <span>Onboarding</span>
          <span className="h-1 w-1 rounded-full bg-gray-300" />
          <span>{step + 1} of 7</span>
        </div>
      </div>

      <section className="mx-auto mt-10 max-w-5xl">
        <div className="mb-8 h-2 overflow-hidden rounded-full bg-white shadow-inner">
          <div className="h-full rounded-full bg-black transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        {step === 0 ? (
          <Screen>
            <div className="max-w-2xl">
              <StepLabel step="1" />
              <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em] sm:text-7xl">
                Pick the cloud for your first resource.
              </h1>
              <p className="mt-6 text-lg leading-8 text-gray-600">
                We start with one small serverless function, then move the entire deployment flow into chat.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <ProviderCard
                active={provider === "aws"}
                icon="fa-brands fa-aws"
                title="AWS"
                body="Create a Lambda function that returns your company greeting."
                onClick={() => setProvider("aws")}
              />
              <ProviderCard
                active={provider === "azure"}
                icon="fa-brands fa-microsoft"
                title="Azure"
                body="Create an Azure Function using the same greeting contract."
                onClick={() => setProvider("azure")}
              />
            </div>
            <Footer next={() => setStep(1)} />
          </Screen>
        ) : null}

        {step === 1 ? (
          <Screen>
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <StepLabel step="2" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Prepare the {meta.label} account.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  This is the cloud-side trust setup A2W needs before Terraform can plan or apply.
                </p>
              </div>
              <InstructionPanel
                icon={meta.icon}
                title={provider === "azure" ? "Create subscription and app registration" : "Create account and IAM role"}
                items={
                  provider === "azure"
                    ? [
                        "Create or pick an Azure subscription for the MVP.",
                        "Open Microsoft Entra ID, then App registrations.",
                        "Create a new app registration for A2W.",
                        "Create a client secret under Certificates & secrets."
                      ]
                    : [
                        "Create or pick an AWS account for the MVP.",
                        "Create an IAM role named a2w-infra-agent.",
                        "Configure an external ID for the role.",
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
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <StepLabel step="3" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Grant the MVP permission.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  We keep this broad for the MVP so provider registration and the first apply are not blocked. Tight least-privilege roles come after the flow is proven.
                </p>
              </div>
              <InstructionPanel
                icon={provider === "azure" ? "fa-key" : "fa-shield-halved"}
                title={provider === "azure" ? "Assign Owner on the subscription" : "Attach broad role permissions"}
                items={
                  provider === "azure"
                    ? [
                        "Go to Subscription > Access control IAM.",
                        "Add role assignment.",
                        "Choose Owner.",
                        "Assign it to the app registration service principal."
                      ]
                    : [
                        "Attach AdministratorAccess to the MVP IAM role.",
                        "Use the external ID in the trust policy.",
                        "Avoid static access keys.",
                        "Reduce permissions after the first deployment flow works."
                      ]
                }
              />
            </div>
            <Footer back={() => setStep(1)} next={() => setStep(3)} />
          </Screen>
        ) : null}

        {step === 3 ? (
          <Screen>
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <StepLabel step="4" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Enter the credentials.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  Secrets are encrypted in local MVP storage and injected into Podman only when Terraform runs.
                </p>
              </div>
              <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-xl shadow-black/5">
                <div className="mb-5 flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black text-xl text-white">
                    <Icon name={meta.icon} />
                  </span>
                  <div>
                    <p className="font-semibold">{meta.label} credentials</p>
                    <p className="text-sm text-gray-500">{meta.resource} onboarding</p>
                  </div>
                </div>
                <div className="grid gap-4">
                  {meta.fields.map(([name, label, value, type = "text"]) => (
                    <label key={name} className="grid gap-2 text-sm font-medium text-gray-700">
                      {label}
                      <input
                        name={name}
                        type={type}
                        value={details[name] ?? value}
                        onChange={(event) => setDetails((current) => ({ ...current, [name]: event.target.value }))}
                        placeholder={type === "password" ? "Enter secret value" : undefined}
                        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                      />
                    </label>
                  ))}
                </div>
                {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
              </div>
            </div>
            <Footer back={() => setStep(2)} next={() => setStep(4)} />
          </Screen>
        ) : null}

        {step === 4 ? (
          <Screen>
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <StepLabel step="5" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Connect Codex on this host.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  A2W uses the self-hosted machine's Codex CLI login. Your OpenAI or ChatGPT credentials stay with Codex; this app only checks whether the local CLI is authenticated.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <Mini title="Local auth" body="No OpenAI password is collected in the browser." icon="fa-lock" />
                  <Mini title="Workspace write" body="Codex edits only the local project repository." icon="fa-folder-tree" />
                  <Mini title="Separate apply" body="Terraform apply remains a gated sandbox action." icon="fa-shield-halved" />
                  <Mini title="Chat backend" body="Verified Codex becomes the agent for chat edits." icon="fa-message" />
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-xl shadow-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black text-xl text-white">
                      <Icon name="fa-terminal" />
                    </span>
                    <div>
                      <p className="font-semibold">Codex CLI</p>
                      <p className="text-sm text-gray-500">Host authentication</p>
                    </div>
                  </div>
                  <StatusPill status={codexStatus} />
                </div>

                <div className="mt-6 grid gap-3">
                  <CommandLine command="codex login" />
                  <CommandLine command="codex login status" />
                </div>

                <label className="mt-5 grid gap-2 text-sm font-medium text-gray-700">
                  Codex model
                  <input
                    list="onboarding-codex-models"
                    value={codexModel}
                    onChange={(event) => setCodexModel(event.target.value)}
                    placeholder="Codex CLI default"
                    className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                  />
                  <datalist id="onboarding-codex-models">
                    {CODEX_MODEL_OPTIONS.filter((option) => option.id).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </datalist>
                </label>

                <p className="mt-5 text-sm leading-7 text-gray-600">
                  Run the login command in the same environment where this Next.js server runs, then check the status here. Leave the model empty to use whatever Codex CLI is configured to use.
                </p>

                {codexOutput ? (
                  <pre className="thin-scrollbar mt-5 max-h-32 overflow-auto whitespace-pre-wrap rounded-[1.25rem] bg-black p-4 text-xs leading-6 text-gray-100">
                    {codexOutput}
                  </pre>
                ) : null}

                {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

                <button
                  type="button"
                  onClick={checkCodex}
                  disabled={codexStatus === "checking"}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <Icon name={codexStatus === "checking" ? "fa-circle-notch fa-spin" : "fa-rotate"} />
                  Check Codex login
                </button>
              </div>
            </div>
            <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="h-12 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={continueFromCodex}
                disabled={codexStatus === "checking"}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={codexStatus === "checking" ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                {codexStatus === "ready" ? "Continue" : "Verify and continue"}
              </button>
            </div>
          </Screen>
        ) : null}

        {step === 5 ? (
          <Screen>
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <StepLabel step="6" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Initialize the infrastructure Git repository.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  Terraform Garden keeps the generated infrastructure in its own workspace repository. That repository is where the DStack-style Terraform layout lives, not inside the Next.js app source.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <Mini title="Repository" body=".data/workspaces/selfhost-workspace/repository" icon="fa-code-branch" />
                  <Mini title="Terraform roots" body="providers/<provider>/<region>/<stack>" icon="fa-terminal" />
                  <Mini title="Modules" body="modules/<provider>/<module>" icon="fa-layer-group" />
                  <Mini title="Review loop" body="Diff, commit, then plan/apply." icon="fa-code-commit" />
                </div>
              </div>

              <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-xl shadow-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black text-xl text-white">
                      <Icon name="fa-code-branch" />
                    </span>
                    <div>
                      <p className="font-semibold">Workspace Git</p>
                      <p className="text-sm text-gray-500">Infrastructure repository</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${gitStatus?.initialized ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                    {gitStatus?.initialized ? "initialized" : "not initialized"}
                  </span>
                </div>

                <div className="mt-6 grid gap-3">
                  <CommandLine command="cd .data/workspaces/selfhost-workspace/repository" />
                  <CommandLine command="git init" />
                  <CommandLine command="git status --short" />
                </div>

                <p className="mt-5 text-sm leading-7 text-gray-600">
                  This lets engineers review generated Terraform as diffs, commit approved changes, and later connect the repository to a normal PR workflow.
                </p>

                {gitStatus ? (
                  <div className="mt-5 grid gap-2 rounded-[1.5rem] border border-gray-200 p-4 text-sm">
                    <SettingLine label="Available" value={gitStatus.available ? "yes" : "no"} />
                    <SettingLine label="Initialized" value={gitStatus.initialized ? "yes" : "no"} />
                    <SettingLine label="Branch" value={gitStatus.branch || "-"} />
                    <SettingLine label="Working tree" value={gitStatus.clean ? "clean" : `${gitStatus.files.length} changed`} />
                  </div>
                ) : null}

                {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={refreshGit}
                    disabled={gitLoading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    <Icon name={gitLoading ? "fa-circle-notch fa-spin" : "fa-rotate"} />
                    Check status
                  </button>
                  <button
                    type="button"
                    onClick={initializeGitRepository}
                    disabled={gitLoading}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    <Icon name={gitLoading ? "fa-circle-notch fa-spin" : "fa-code-branch"} />
                    Initialize Git
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="h-12 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={continueFromGit}
                disabled={gitLoading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={gitLoading ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                Continue with Git repository
              </button>
            </div>
          </Screen>
        ) : null}

        {step === 6 ? (
          <Screen>
            <div className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-start">
              <div>
                <StepLabel step="7" />
                <h1 className="mt-4 text-5xl font-semibold leading-[1] tracking-[-0.05em]">
                  Create the first resource.
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  A2W will write Terraform and function code for a {meta.resource} that returns <span className="font-semibold text-black">hello! {companyName}</span>.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  <Mini title="Chat" body="Land in the command surface." icon="fa-message" />
                  <Mini title="Codex" body="Use your verified local Codex login." icon="fa-wand-magic-sparkles" />
                  <Mini title="Terraform fmt" body="Format files from a modal." icon="fa-code" />
                  <Mini title="Terraform plan" body="Run provider-backed plan." icon="fa-terminal" />
                  <Mini title="Browse files" body="Inspect generated code in chat." icon="fa-folder-tree" />
                  <Mini title="Approve" body="Record human approval." icon="fa-check" />
                  <Mini title="Apply" body="Deploy when settings allow it." icon="fa-rocket" />
                </div>
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
                  <span>Deployment: Terraform in chat</span>
                </div>
              </div>
            </div>
            <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="h-12 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={complete}
                disabled={loading}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
                Create resource and open chat
              </button>
            </div>
          </Screen>
        ) : null}
      </section>
    </main>
  );
}

function initialDetails(provider: OnboardingProvider) {
  return Object.fromEntries(providerDetails[provider].fields.map(([name, , value]) => [name, value]));
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="motion-enter rounded-[2.5rem] border border-gray-200 bg-white/75 p-6 shadow-2xl shadow-black/10 backdrop-blur sm:p-10">{children}</div>;
}

function StepLabel({ step }: { step: string }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Step {step}</p>;
}

function ProviderCard({
  active,
  icon,
  title,
  body,
  onClick
}: {
  active: boolean;
  icon: string;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[2rem] border p-6 text-left transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5 ${
        active ? "border-black bg-black text-white" : "border-gray-200 bg-white text-black"
      }`}
    >
      <span className={`grid h-12 w-12 place-items-center rounded-2xl text-xl ${active ? "bg-white text-black" : "bg-gray-100 text-gray-700"}`}>
        <Icon name={icon} />
      </span>
      <h2 className="mt-6 text-2xl font-semibold">{title}</h2>
      <p className={`mt-3 text-sm leading-7 ${active ? "text-gray-300" : "text-gray-600"}`}>{body}</p>
    </button>
  );
}

function InstructionPanel({ icon, title, items }: { icon: string; title: string; items: string[] }) {
  return (
    <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-xl shadow-black/5">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black text-xl text-white">
          <Icon name={icon} />
        </span>
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">{title}</h2>
      </div>
      <div className="mt-6 grid gap-3">
        {items.map((item, index) => (
          <div key={item} className="flex items-start gap-3 rounded-[1.25rem] bg-gray-50 p-4 text-sm leading-6 text-gray-700">
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
    <div className="flex items-center justify-between gap-3 rounded-[1.25rem] bg-gray-50 px-4 py-3">
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
    <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
      {back ? (
        <button type="button" onClick={back} className="h-12 rounded-full border border-gray-200 bg-white px-6 text-sm font-semibold text-gray-700 transition hover:border-gray-300">
          Back
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={next} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black px-6 text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800">
        <Icon name="fa-arrow-right" />
        Continue
      </button>
    </div>
  );
}

function Mini({ title, body, icon }: { title: string; body: string; icon: string }) {
  return (
    <div className="rounded-[1.5rem] bg-gray-50 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-gray-700 shadow-sm">
        <Icon name={icon} />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 text-gray-600">{body}</p>
    </div>
  );
}

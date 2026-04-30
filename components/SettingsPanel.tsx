"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CloudProvider, ProviderConnection, Workspace } from "@/src/lib/types";
import { CODEX_MODEL_OPTIONS } from "@/src/lib/codex-models";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { Toast } from "./Toast";

type SupportedProvider = Extract<CloudProvider, "aws" | "azure">;
type PublicUser = {
  name: string;
  email: string;
};
type Field = [string, string, string, ("text" | "password")?];

const providerMeta: Record<SupportedProvider, { label: string; icon: string; fields: Field[]; help: string }> = {
  aws: {
    label: "AWS",
    icon: "fa-brands fa-aws",
    help: "For the MVP, use a role that can create the first Lambda and related IAM resources. Static access keys are intentionally not accepted.",
    fields: [
      ["roleArn", "IAM role ARN", "arn:aws:iam::123456789012:role/a2w-infra-agent"],
      ["externalId", "External ID", "a2w-demo-external-id"],
      ["region", "Region", "eu-central-1"]
    ]
  },
  azure: {
    label: "Azure",
    icon: "fa-brands fa-microsoft",
    help: "Use the app registration client ID and client secret. The secret is encrypted locally and injected only into sandbox runs.",
    fields: [
      ["tenantId", "Tenant ID", "11111111-1111-4111-8111-111111111111"],
      ["subscriptionId", "Subscription ID", "22222222-2222-4222-8222-222222222222"],
      ["clientId", "Client ID", "33333333-3333-4333-8333-333333333333"],
      ["clientSecret", "Client secret", "", "password"],
      ["region", "Region", "westeurope"]
    ]
  }
};

export function SettingsPanel({
  user,
  workspace,
  connections,
  applyRuntimeEnabled,
  agentBackend
}: {
  user: PublicUser;
  workspace: Workspace;
  connections: ProviderConnection[];
  applyRuntimeEnabled: boolean;
  agentBackend: "mock" | "codex";
}) {
  const router = useRouter();
  const initialProvider: SupportedProvider = workspace.cloudPreference === "azure" ? "azure" : "aws";
  const [provider, setProvider] = useState<SupportedProvider>(initialProvider);
  const [applyDisabled, setApplyDisabled] = useState(Boolean(workspace.terraformApplyDisabled));
  const [codexModel, setCodexModel] = useState(workspace.codexModel || "");
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [testingCredentials, setTestingCredentials] = useState(false);
  const [credentialTest, setCredentialTest] = useState<{ status: string; label: string; detail: string } | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingCodex, setSavingCodex] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const active = providerMeta[provider];
  const connection = useMemo(() => connections.find((item) => item.provider === provider), [connections, provider]);

  async function saveCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCredentials(true);
    setError(null);

    try {
      const response = await fetch("/api/provider-connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          ...Object.fromEntries(new FormData(event.currentTarget).entries())
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || "Could not save credentials.");
      flash(`${active.label} credentials saved`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCredentials(false);
    }
  }

  async function testCredentials() {
    setTestingCredentials(true);
    setCredentialTest(null);
    setError(null);

    try {
      const response = await fetch("/api/provider-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Credential test failed.");
      setCredentialTest(data.result);
      flash(data.result?.label || "Credential test completed");
    } catch (err) {
      setCredentialTest({
        status: "failed",
        label: "Credential test failed",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setTestingCredentials(false);
    }
  }

  async function updateApplyPolicy(disabled: boolean) {
    setApplyDisabled(disabled);
    setSavingPolicy(true);
    setError(null);

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terraformApplyDisabled: disabled })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update workspace settings.");
      flash(disabled ? "Terraform apply disabled" : "Terraform apply allowed for this workspace");
      router.refresh();
    } catch (err) {
      setApplyDisabled(!disabled);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveCodexSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCodex(true);
    setError(null);

    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codexModel })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update Codex settings.");
      setCodexModel(data.workspace?.codexModel || "");
      flash(data.workspace?.codexModel ? `Codex model set to ${data.workspace.codexModel}` : "Codex model reset to CLI default");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCodex(false);
    }
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSignOutOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <section className="motion-enter mx-auto grid max-w-6xl gap-5">
        <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Settings</p>
          <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.03em]">{workspace.companyName}</h1>
              <p className="mt-2 text-sm leading-7 text-gray-600">
                Cloud credentials, workspace defaults, and local execution controls for this instance.
              </p>
            </div>
            <div className="rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
              {user.email}
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <form key={provider} onSubmit={saveCredentials} className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Cloud credentials</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Provider trust</h2>
              </div>
              <div className="flex rounded-full border border-gray-200 bg-gray-50 p-1">
                {(Object.keys(providerMeta) as SupportedProvider[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setProvider(key)}
                    className={`inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold transition ${
                      provider === key ? "bg-black text-white" : "text-gray-600 hover:text-black"
                    }`}
                  >
                    <Icon name={providerMeta[key].icon} />
                    {providerMeta[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-7 text-gray-600">
              {active.help}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {active.fields.map(([name, label, fallback, type = "text"]) => (
                <label key={name} className={name === "clientSecret" ? "grid gap-2 text-sm font-medium text-gray-700 sm:col-span-2" : "grid gap-2 text-sm font-medium text-gray-700"}>
                  {label}
                  <input
                    name={name}
                    type={type}
                    defaultValue={type === "password" ? "" : connection?.details[name] || fallback}
                    placeholder={type === "password" ? "Enter a new secret when saving" : undefined}
                    className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                  />
                </label>
              ))}
            </div>

            {connection ? (
              <div className="mt-5 grid gap-2 rounded-[1.5rem] border border-gray-200 p-4 text-sm">
                <SettingRow label="Status" value={connection.status === "connected_mock" ? "connected" : connection.status.replaceAll("_", " ")} />
                <SettingRow label="Region" value={connection.region} />
                {provider === "azure" ? <SettingRow label="Client secret" value={connection.details.clientSecretConfigured ? "configured" : "missing"} /> : null}
              </div>
            ) : null}

            {credentialTest ? (
              <div className={`mt-5 rounded-[1.5rem] p-4 text-sm leading-6 ${credentialTest.status === "connected" ? "bg-emerald-50 text-emerald-800" : credentialTest.status === "configured" ? "bg-gray-50 text-gray-700" : "bg-red-50 text-red-700"}`}>
                <p className="font-semibold">{credentialTest.label}</p>
                <p className="mt-1">{credentialTest.detail}</p>
              </div>
            ) : null}

            {error ? <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={testingCredentials || !connection}
                onClick={testCredentials}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <Icon name={testingCredentials ? "fa-circle-notch fa-spin" : "fa-key"} />
                Test credentials
              </button>
              <button
                type="submit"
                disabled={savingCredentials}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300"
              >
                <Icon name={savingCredentials ? "fa-circle-notch fa-spin" : "fa-floppy-disk"} />
                Save credentials
              </button>
            </div>
          </form>

          <aside className="grid gap-5">
            <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Apply control</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Terraform apply</h2>
              <p className="mt-3 text-sm leading-7 text-gray-600">
                Apply and destroy require both the local server flag and this workspace policy to allow them.
              </p>

              <div className="mt-5 grid gap-3">
                <SettingRow label="Local server flag" value={applyRuntimeEnabled ? "enabled" : "disabled"} strong={applyRuntimeEnabled} />
                <SettingRow label="Workspace policy" value={applyDisabled ? "apply/destroy disabled" : "apply/destroy allowed"} strong={!applyDisabled} />
              </div>

              <label className="mt-5 flex cursor-pointer items-center justify-between gap-4 rounded-[1.5rem] bg-gray-50 p-4">
                <span>
                  <span className="block text-sm font-semibold text-gray-900">Allow apply and destroy from chat</span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">Turn this off when you only want fmt and plan.</span>
                </span>
                <input
                  type="checkbox"
                  checked={!applyDisabled}
                  disabled={savingPolicy}
                  onChange={(event) => updateApplyPolicy(!event.target.checked)}
                  className="h-5 w-5 accent-black"
                />
              </label>
            </div>

            <form onSubmit={saveCodexSettings} className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Codex agent</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Model</h2>
              <p className="mt-3 text-sm leading-7 text-gray-600">
                Pick the model passed to sandboxed <code className="rounded bg-gray-50 px-1.5 py-1">codex exec</code>. Leave empty to use the Codex CLI default.
              </p>

              <label className="mt-5 grid gap-2 text-sm font-medium text-gray-700">
                Model ID
                <input
                  list="settings-codex-models"
                  value={codexModel}
                  onChange={(event) => setCodexModel(event.target.value)}
                  placeholder="Codex CLI default"
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                />
                <datalist id="settings-codex-models">
                  {CODEX_MODEL_OPTIONS.filter((option) => option.id).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
              </label>

              <button
                type="submit"
                disabled={savingCodex}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800 disabled:bg-gray-300"
              >
                <Icon name={savingCodex ? "fa-circle-notch fa-spin" : "fa-floppy-disk"} />
                Save Codex model
              </button>
            </form>

            <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Workspace</p>
              <div className="mt-5 grid gap-2 text-sm">
                <SettingRow label="User" value={user.name} />
                <SettingRow label="Agent backend" value={agentBackend === "codex" ? "local Codex CLI" : "deterministic planner"} strong={agentBackend === "codex"} />
                <SettingRow label="Codex model" value={workspace.codexModel || "CLI default"} strong={Boolean(workspace.codexModel)} />
                <SettingRow label="Default cloud" value={workspace.cloudPreference.toUpperCase()} />
                <SettingRow label="Onboarding" value={workspace.onboardingCompletedAt ? "completed" : "pending"} />
              </div>
              <button
                type="button"
                onClick={() => setSignOutOpen(true)}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-red-50 px-5 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              >
                <Icon name="fa-arrow-right-from-bracket" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      </section>

      {signOutOpen ? (
        <Modal
          title="Sign out?"
          description="This clears the local browser session. Workspace files remain on disk."
          icon="fa-arrow-right-from-bracket"
          danger
          onClose={() => setSignOutOpen(false)}
        >
          <div className="mt-5 rounded-[1.5rem] bg-red-50 p-4 text-sm leading-6 text-red-800">
            You will return to the sign-in screen. Sign in again with the same instance username and password to restore the session.
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setSignOutOpen(false)}
              className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-red-700 px-5 text-sm font-semibold text-white transition hover:bg-red-800"
            >
              <Icon name="fa-arrow-right-from-bracket" />
              Sign out
            </button>
          </div>
        </Modal>
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function SettingRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3">
      <span className="text-gray-500">{label}</span>
      <span className={`truncate text-right font-semibold ${strong ? "text-black" : "text-gray-800"}`}>{value}</span>
    </div>
  );
}

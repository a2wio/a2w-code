"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { CloudProvider, ProviderConnection } from "@/src/lib/types";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { Toast } from "./Toast";

type SupportedProvider = Extract<CloudProvider, "aws" | "azure">;
type Field = [string, string, string, ("text" | "password")?];

const providers: Record<SupportedProvider, { label: string; product: string; icon: string; description: string; fields: Field[] }> = {
  aws: {
    label: "AWS",
    product: "EKS",
    icon: "fa-brands fa-aws",
    description: "Assume an IAM role with external ID. Static access keys are rejected.",
    fields: [
      ["roleArn", "IAM role ARN", "arn:aws:iam::123456789012:role/a2w-infra-agent"],
      ["externalId", "External ID", "a2w-demo-external-id"],
      ["region", "Region", "eu-central-1"]
    ]
  },
  azure: {
    label: "Azure",
    product: "AKS",
    icon: "fa-brands fa-microsoft",
    description: "Connect with service principal details. The client secret is encrypted locally and injected only into sandbox runs.",
    fields: [
      ["tenantId", "Tenant ID", "11111111-1111-4111-8111-111111111111"],
      ["subscriptionId", "Subscription ID", "22222222-2222-4222-8222-222222222222"],
      ["clientId", "Client ID", "33333333-3333-4333-8333-333333333333"],
      ["clientSecret", "Client secret", "", "password"],
      ["region", "Region", "westeurope"]
    ]
  }
};

export function CloudConnect({
  initialProvider,
  connections
}: {
  initialProvider: SupportedProvider;
  connections: ProviderConnection[];
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<SupportedProvider>(initialProvider);
  const [modalProvider, setModalProvider] = useState<SupportedProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const active = modalProvider ? providers[modalProvider] : null;
  const supportedConnections = connections.filter((connection): connection is ProviderConnection & { provider: SupportedProvider } =>
    isSupportedProvider(connection.provider)
  );

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modalProvider) return;
    setError(null);

    const response = await fetch("/api/provider-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: modalProvider,
        ...Object.fromEntries(new FormData(event.currentTarget).entries())
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || data.errors?.join(" ") || "Could not connect provider.");
      return;
    }

    setProvider(modalProvider);
    setModalProvider(null);
    setToast(`${providers[modalProvider].label} trust connected`);
    window.setTimeout(() => setToast(null), 2200);
    router.refresh();
  }

  return (
    <>
      <section className="motion-enter grid gap-6">
        <div className="rounded-[2rem] border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Cloud trust</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Connect cloud credentials for planning.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-600">
                Each provider uses the minimum details needed for sandboxed Terraform plan. Secret values stay out of generated files and command logs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModalProvider(provider)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-gray-800"
            >
              <Icon name="fa-plug" />
              Connect selected
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {(Object.keys(providers) as SupportedProvider[]).map((key) => {
            const meta = providers[key];
            const connection = connections.find((item) => item.provider === key);
            const selected = key === provider;
            return (
              <article
                key={key}
                className={`rounded-[2rem] border bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/5 ${
                  selected ? "border-black" : "border-gray-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-black text-xl text-white">
                    <Icon name={meta.icon} />
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection ? "bg-black text-white" : "bg-gray-100 text-gray-600"}`}>
                    {connection ? "connected" : "not connected"}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em]">
                  {meta.label} {meta.product}
                </h3>
                <p className="mt-2 text-sm leading-7 text-gray-600">{meta.description}</p>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setProvider(key)}
                    className="h-10 rounded-full border border-gray-200 px-4 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalProvider(key)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-black px-4 text-sm font-semibold text-white transition hover:bg-gray-800"
                  >
                    <Icon name="fa-plug" />
                    Connect
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="rounded-[2rem] border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Inventory</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Connected accounts</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {supportedConnections.length ? (
              supportedConnections.map((connection) => (
                <article key={connection.id} className="grid gap-4 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex items-start gap-4">
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gray-100 text-gray-700">
                      <Icon name={providers[connection.provider].icon} />
                    </span>
                    <div>
                      <p className="font-semibold">
                        {providers[connection.provider].label} / {connection.region}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">{connection.status === "connected_mock" ? "connected" : connection.status}</p>
                    </div>
                  </div>
                  <span className="w-fit rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600">
                    local trust
                  </span>
                </article>
              ))
            ) : (
              <p className="p-6 text-sm leading-7 text-gray-600">No provider connections yet.</p>
            )}
          </div>
        </div>
      </section>

      {modalProvider && active ? (
        <Modal title={`${active.label} trust`} description="Configure provider trust for planning and future apply workers." icon={active.icon} onClose={() => setModalProvider(null)}>
          <div className="mt-5 rounded-[1.5rem] bg-gray-50 p-4 text-sm leading-6 text-gray-600">{active.description}</div>
          <form onSubmit={connect} className="mt-6 grid gap-4">
            {active.fields.map(([name, label, value, type = "text"]) => (
              <label key={name} className="grid gap-2 text-sm font-medium text-gray-700">
                {label}
                <input
                  name={name}
                  type={type}
                  defaultValue={value}
                  placeholder={type === "password" ? "Enter secret value" : undefined}
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
                />
              </label>
            ))}
            {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setModalProvider(null)}
                className="h-11 rounded-full border border-gray-200 px-5 text-sm font-semibold text-gray-700 transition hover:border-gray-300"
              >
                Cancel
              </button>
              <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-5 text-sm font-semibold text-white transition hover:bg-gray-800">
                <Icon name="fa-plug" />
                Connect {active.label}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      <Toast message={toast} />
    </>
  );
}

function isSupportedProvider(provider: CloudProvider): provider is SupportedProvider {
  return provider === "aws" || provider === "azure";
}

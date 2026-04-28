"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

export function AuthForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      router.push(data.workspace?.onboardingCompletedAt ? "/dashboard/agent" : "/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="motion-enter w-full max-w-[500px] rounded-[2rem] border border-gray-200 bg-white/85 p-6 shadow-2xl shadow-black/10 backdrop-blur sm:p-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Self-hosted console</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em]">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Use the instance admin credentials configured on this self-hosted A2W server.
        </p>
      </div>

      <form className="grid gap-5" onSubmit={submit}>
        <Field name="username" label="Username" defaultValue="admin" autoComplete="username" />
        <Field
          name="password"
          label="Password"
          placeholder="Local dev default: password123"
          type="password"
          autoComplete="current-password"
        />

        {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <button
          disabled={loading}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-black text-sm font-semibold text-white shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          type="submit"
        >
          <Icon name={loading ? "fa-circle-notch fa-spin" : "fa-arrow-right"} />
          Open console
        </button>
      </form>

      <div className="mt-6 rounded-[1.5rem] bg-gray-50 p-4 text-xs leading-6 text-gray-500">
        Configure <code className="rounded bg-white px-1.5 py-1">A2W_ADMIN_USERNAME</code> and{" "}
        <code className="rounded bg-white px-1.5 py-1">A2W_ADMIN_PASSWORD</code> before exposing this UI beyond localhost.
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  type = "text",
  autoComplete
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-gray-700">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 rounded-2xl border border-gray-200 bg-white px-4 text-black outline-none transition focus:border-black"
      />
    </label>
  );
}

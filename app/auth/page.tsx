import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { getCurrentContext } from "@/src/lib/auth";

export default async function AuthPage() {
  const context = await getCurrentContext();
  if (context) redirect("/dashboard");

  return (
    <main className="grid min-h-screen bg-paper p-3 text-black lg:grid-cols-[0.92fr_1.08fr]">
      <section className="hidden overflow-hidden rounded-[2rem] bg-black p-8 text-white shadow-2xl shadow-black/20 lg:flex lg:flex-col lg:justify-between">
        <Brand dark />
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">Self-hosted console</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-[-0.04em]">
            One local admin. One platform workspace. Agent-driven infrastructure.
          </h1>
          <p className="mt-6 text-sm leading-7 text-gray-400">
            A2W is now shaped as a self-hostable UI for platform and DevOps engineers. Authentication is a simple instance username/password configured by environment variables.
          </p>
        </div>
        <div className="grid gap-3">
          <MiniStep number="1" label="Admin sign-in" done />
          <MiniStep number="2" label="Cloud onboarding" />
          <MiniStep number="3" label="Codex + Terraform flow" />
        </div>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <AuthForm />
      </section>
    </main>
  );
}

function MiniStep({ number, label, done }: { number: string; label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${done ? "bg-white text-black" : "bg-white/10 text-gray-400"}`}>
        {done ? "✓" : number}
      </span>
      <span className={`text-sm font-medium ${done ? "text-white" : "text-gray-400"}`}>{label}</span>
    </div>
  );
}

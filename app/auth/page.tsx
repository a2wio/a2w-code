import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppLogo } from "@/components/AppLogo";
import { AuthForm } from "@/components/AuthForm";
import { configuredAdminUsername, getCurrentContext } from "@/src/lib/auth";

export default async function AuthPage() {
  const context = await getCurrentContext();
  if (context) redirect("/dashboard");

  return (
    <main className="grid min-h-[calc(100dvh-16px)] gap-2 bg-[#f7f7f4] p-2 text-black lg:grid-cols-[0.94fr_1.06fr] lg:gap-3 lg:p-2">
      <section className="hidden overflow-hidden rounded-[18px] bg-[#5c4ee5] p-8 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="grid gap-12">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <AppLogo decorative className="h-10 w-10" />
              <span>
                <span className="block text-sm font-semibold">A2W-Codex-Terraform-v0.0.1</span>
                <span className="block text-xs text-white/60">Self-hosted infra workbench</span>
              </span>
            </div>
            <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/75">
              Local only
            </div>
          </div>

          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">Codex-driven Terraform</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-[-0.04em]">
              Sign in to your local infrastructure editor.
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-white/68">
              One admin account protects the local UI. Codex handles code changes, Terraform handles plans, and every action stays visible before apply.
            </p>
          </div>
        </div>

        <AuthLogoStrip />
      </section>
      <section className="flex min-h-[calc(100dvh-32px)] items-center justify-center px-2 py-8 sm:px-6 lg:min-h-[calc(100dvh-32px)]">
        <AuthForm defaultUsername={configuredAdminUsername()} />
      </section>
    </main>
  );
}

function AuthLogoStrip() {
  return (
    <div className="flex w-full items-center justify-start gap-3">
      <LogoMark>
        <CodexLogo />
      </LogoMark>
      <PlusMark />
      <AppLogo decorative className="h-16 w-16" roundedClassName="rounded-[1.15rem]" />
      <PlusMark />
      <LogoMark>
        <TerraformLogo />
      </LogoMark>
    </div>
  );
}

function LogoMark({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-16 w-16 place-items-center rounded-[1.15rem] bg-white shadow-2xl shadow-black/15">
      {children}
    </div>
  );
}

function PlusMark() {
  return <span className="text-lg font-semibold text-white/42">+</span>;
}

function CodexLogo() {
  return <img alt="" aria-hidden="true" className="h-10 w-10 object-contain" src="/codex-logo.png" />;
}

function TerraformLogo() {
  return (
    <svg aria-hidden="true" className="h-10 w-10" viewBox="0 0 48 48" fill="none">
      <path d="M7 8.5 19.7 16v14.8L7 23.4V8.5Z" fill="#5C4EE5" />
      <path d="M21.4 16.1 34.1 8.7v14.8l-12.7 7.4V16.1Z" fill="#5C4EE5" opacity="0.86" />
      <path d="M21.4 32.5 34.1 25v14.7l-12.7 7.4V32.5Z" fill="#5C4EE5" opacity="0.72" />
      <path d="M35.8 8.7 48 15.8v14.8l-12.2-7.1V8.7Z" fill="#5C4EE5" opacity="0.58" />
    </svg>
  );
}

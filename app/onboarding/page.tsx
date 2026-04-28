import { redirect } from "next/navigation";
import { getCurrentContext } from "@/src/lib/auth";
import { OnboardingFlow } from "@/components/OnboardingFlow";

export default async function OnboardingPage() {
  const context = await getCurrentContext();
  if (!context) redirect("/auth");
  if (context.workspace.onboardingCompletedAt) redirect("/dashboard/agent");

  return <OnboardingFlow companyName={context.workspace.companyName} cloudPreference={context.workspace.cloudPreference} />;
}

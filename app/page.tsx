import { redirect } from "next/navigation";
import { getCurrentContext } from "@/src/lib/auth";

export default async function RootPage() {
  const context = await getCurrentContext();
  if (!context) redirect("/auth");
  redirect(context.workspace.onboardingCompletedAt ? "/dashboard/agent" : "/onboarding");
}

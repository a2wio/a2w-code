import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import { errorJson, json } from "@/src/lib/http";
import { configureOnboardingGit, parseOnboardingGitInput } from "@/src/lib/onboarding-git";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);

    const body = await request.json();
    const input = parseOnboardingGitInput(body);
    const result = await configureOnboardingGit(context.workspace.id, input);
    return json({ git: result.git }, 201);
  } catch (error) {
    return errorJson(error, 400);
  }
}

import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import { commitWorkspace, getGitStatus, initializeGit } from "@/src/lib/git";
import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    return json({ git: await getGitStatus(context.workspace.id) });
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "init") {
      return json({ git: await initializeGit(context.workspace.id) });
    }

    if (action === "commit") {
      return json({ git: await commitWorkspace(context.workspace.id, String(body.message || "")) });
    }

    return errorJson("Unsupported Git action.", 400);
  } catch (error) {
    return errorJson(error, 400);
  }
}

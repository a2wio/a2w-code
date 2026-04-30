import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import {
  applyStash,
  checkoutGitRef,
  commitWorkspace,
  discardWorkspaceFile,
  dropStash,
  getGitDetails,
  getGitStatus,
  initializeGit,
  pushWorkspace,
  resetWorkspaceChanges,
  resetToCommit,
  revertCommit,
  stageWorkspace,
  stashWorkspace,
  unstageWorkspace
} from "@/src/lib/git";
import { errorJson, json } from "@/src/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    if (request.nextUrl.searchParams.get("details") === "1") return json(await getGitDetails(context.workspace.id));
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
      await initializeGit(context.workspace.id);
      return json(await getGitDetails(context.workspace.id));
    }

    if (action === "stage") {
      return json(await stageWorkspace(context.workspace.id, pathsFromBody(body)));
    }

    if (action === "unstage") {
      return json(await unstageWorkspace(context.workspace.id, pathsFromBody(body)));
    }

    if (action === "discard-file") {
      return json(await discardWorkspaceFile(context.workspace.id, String(body.path || ""), String(body.confirm || "")));
    }

    if (action === "reset-all") {
      return json(await resetWorkspaceChanges(context.workspace.id, String(body.confirm || "")));
    }

    if (action === "commit") {
      return json(await commitWorkspace(context.workspace.id, String(body.message || ""), body.mode === "staged" ? "staged" : "all"));
    }

    if (action === "push") {
      return json(await pushWorkspace(context.workspace.id));
    }

    if (action === "stash") {
      return json(await stashWorkspace(context.workspace.id, {
        includeUntracked: Boolean(body.includeUntracked),
        message: String(body.message || "")
      }));
    }

    if (action === "stash-apply" || action === "stash-pop") {
      return json(await applyStash(context.workspace.id, Number(body.index), action === "stash-pop" ? "pop" : "apply"));
    }

    if (action === "stash-drop") {
      return json(await dropStash(context.workspace.id, Number(body.index), String(body.confirm || "")));
    }

    if (action === "checkout") {
      return json(await checkoutGitRef(context.workspace.id, {
        ref: String(body.ref || ""),
        stashBefore: Boolean(body.stashBefore),
        createBranch: body.createBranch ? String(body.createBranch) : undefined
      }));
    }

    if (action === "revert") {
      return json(await revertCommit(context.workspace.id, {
        ref: String(body.ref || ""),
        stashBefore: Boolean(body.stashBefore)
      }));
    }

    if (action === "reset") {
      return json(await resetToCommit(context.workspace.id, {
        ref: String(body.ref || ""),
        confirm: String(body.confirm || ""),
        stashBefore: Boolean(body.stashBefore)
      }));
    }

    return errorJson("Unsupported Git action.", 400);
  } catch (error) {
    return errorJson(error, 400);
  }
}

function pathsFromBody(body: { paths?: unknown }) {
  return Array.isArray(body.paths) ? body.paths.map((path) => String(path)) : [];
}

import { NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/auth";
import {
  applyStash,
  checkoutGitRef,
  commitWorkspace,
  createBranchFromHead,
  discardWorkspaceFile,
  dropStash,
  getGitDetails,
  getGitStatus,
  initializeGit,
  mergeCurrentBranch,
  pushWorkspace,
  resetWorkspaceChanges,
  resetToCommit,
  revertCommit,
  stageWorkspace,
  stashWorkspace,
  syncWorkspaceBranch,
  unstageWorkspace
} from "@/lib/git";
import { errorJson, json } from "@/lib/http";
import { workspaceMode } from "@/lib/workspace-mode";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const mode = workspaceMode(context.workspace);
    if (request.nextUrl.searchParams.get("details") === "1") return json(await getGitDetails(context.workspace.id, mode));
    return json({ git: await getGitStatus(context.workspace.id, mode) });
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
    const workspaceGitMode = workspaceMode(context.workspace);

    if (action === "init") {
      await initializeGit(context.workspace.id, workspaceGitMode);
      return json(await getGitDetails(context.workspace.id, workspaceGitMode));
    }

    if (action === "stage") {
      return json(await stageWorkspace(context.workspace.id, pathsFromBody(body), workspaceGitMode));
    }

    if (action === "unstage") {
      return json(await unstageWorkspace(context.workspace.id, pathsFromBody(body), workspaceGitMode));
    }

    if (action === "discard-file") {
      return json(await discardWorkspaceFile(context.workspace.id, String(body.path || ""), String(body.confirm || ""), workspaceGitMode));
    }

    if (action === "reset-all") {
      return json(await resetWorkspaceChanges(context.workspace.id, String(body.confirm || ""), workspaceGitMode));
    }

    if (action === "commit") {
      return json(await commitWorkspace(context.workspace.id, String(body.message || ""), body.mode === "staged" ? "staged" : "all", workspaceGitMode));
    }

    if (action === "push") {
      return json(await pushWorkspace(context.workspace.id, workspaceGitMode));
    }

    if (action === "sync") {
      return json(await syncWorkspaceBranch(context.workspace.id, workspaceGitMode));
    }

    if (action === "branch-current") {
      return json(await createBranchFromHead(context.workspace.id, String(body.branch || ""), workspaceGitMode));
    }

    if (action === "merge-current") {
      return json(await mergeCurrentBranch(context.workspace.id, {
        targetBranch: String(body.targetBranch || ""),
        push: Boolean(body.push)
      }, workspaceGitMode));
    }

    if (action === "stash") {
      return json(await stashWorkspace(context.workspace.id, {
        includeUntracked: Boolean(body.includeUntracked),
        message: String(body.message || "")
      }, workspaceGitMode));
    }

    if (action === "stash-apply" || action === "stash-pop") {
      return json(await applyStash(context.workspace.id, Number(body.index), action === "stash-pop" ? "pop" : "apply", workspaceGitMode));
    }

    if (action === "stash-drop") {
      return json(await dropStash(context.workspace.id, Number(body.index), String(body.confirm || ""), workspaceGitMode));
    }

    if (action === "checkout") {
      return json(await checkoutGitRef(context.workspace.id, {
        ref: String(body.ref || ""),
        stashBefore: Boolean(body.stashBefore),
        createBranch: body.createBranch ? String(body.createBranch) : undefined
      }, workspaceGitMode));
    }

    if (action === "revert") {
      return json(await revertCommit(context.workspace.id, {
        ref: String(body.ref || ""),
        stashBefore: Boolean(body.stashBefore)
      }, workspaceGitMode));
    }

    if (action === "reset") {
      return json(await resetToCommit(context.workspace.id, {
        ref: String(body.ref || ""),
        confirm: String(body.confirm || ""),
        stashBefore: Boolean(body.stashBefore)
      }, workspaceGitMode));
    }

    return errorJson("Unsupported Git action.", 400);
  } catch (error) {
    return errorJson(error, 400);
  }
}

function pathsFromBody(body: { paths?: unknown }) {
  return Array.isArray(body.paths) ? body.paths.map((path) => String(path)) : [];
}

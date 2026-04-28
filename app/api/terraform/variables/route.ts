import { NextRequest } from "next/server";
import { getCurrentContext } from "@/src/lib/auth";
import { updateData } from "@/src/lib/data";
import { errorJson, json } from "@/src/lib/http";
import { discoverTerraformVariables, sanitizeTerraformVariableValue, upsertTerraformVariable } from "@/src/lib/terraform-variables";
import { validateTerraformRootPath } from "@/src/lib/terraform-roots";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const rootPath = validateTerraformRootPath(String(request.nextUrl.searchParams.get("rootPath") || ""));
    return json({ variables: await discoverTerraformVariables(context.workspace.id, rootPath, context.data) });
  } catch (error) {
    return errorJson(error, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentContext();
    if (!context) return errorJson("Unauthorized", 401);
    const body = await request.json();
    const rootPath = validateTerraformRootPath(String(body.rootPath || ""));
    const values = Object.entries(body.values || {}) as Array<[string, unknown]>;
    if (!values.length) return errorJson("At least one Terraform variable value is required.", 400);

    const variables = await updateData((data) => {
      data.terraformVariables ||= [];
      for (const [rawName, rawValue] of values) {
        const clean = sanitizeTerraformVariableValue(rawName, rawValue);
        const existing = data.terraformVariables.find(
          (item) => item.workspaceId === context.workspace.id && item.rootPath === rootPath && item.name === clean.name
        );
        const next = upsertTerraformVariable({
          existing,
          workspaceId: context.workspace.id,
          rootPath,
          name: clean.name,
          value: clean.value,
          sensitive: clean.sensitive
        });
        if (existing) Object.assign(existing, next);
        else data.terraformVariables.push(next);
      }
      return data.terraformVariables.filter((item) => item.workspaceId === context.workspace.id && item.rootPath === rootPath);
    });

    return json({ variables });
  } catch (error) {
    return errorJson(error, 400);
  }
}

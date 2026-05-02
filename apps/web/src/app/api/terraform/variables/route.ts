import { NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/auth";
import { updateData } from "@/lib/data";
import { errorJson, json } from "@/lib/http";
import { discoverTerraformVariables, sanitizeTerraformVariableValue, upsertTerraformVariable } from "@/lib/terraform-variables";
import { validateTerraformRootPath } from "@/lib/terraform-roots";
import type { TerraformRootVariableValue } from "@/lib/types";

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
    const definitions = await discoverTerraformVariables(context.workspace.id, rootPath, context.data);
    const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));

    const variables = await updateData((data) => {
      data.terraformVariables ||= [];
      for (const [rawName, rawValue] of values) {
        const name = String(rawName || "").trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Invalid Terraform variable name.");
        const definition = definitionByName.get(name);
        const existing = data.terraformVariables.find(
          (item) => item.workspaceId === context.workspace.id && item.rootPath === rootPath && item.name === name
        );
        if (!String(rawValue || "").trim()) {
          if (definition?.required && !hasStoredVariableValue(existing)) throw new Error(`${name} is required.`);
          if (!definition?.required && existing) {
            data.terraformVariables = data.terraformVariables.filter((item) => item.id !== existing.id);
          }
          continue;
        }
        const clean = sanitizeTerraformVariableValue(rawName, rawValue);
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

function hasStoredVariableValue(value?: TerraformRootVariableValue) {
  return Boolean(value?.value || value?.secret);
}

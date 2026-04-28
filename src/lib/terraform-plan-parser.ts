import type { TerraformPlanResourceChange, TerraformPlanSummary } from "./types";

const PLAN_JSON_START = "== A2W_TERRAFORM_PLAN_JSON_START ==";
const PLAN_JSON_END = "== A2W_TERRAFORM_PLAN_JSON_END ==";

type TerraformShowJson = {
  resource_changes?: Array<{
    address?: string;
    type?: string;
    name?: string;
    provider_name?: string;
    change?: {
      actions?: string[];
    };
  }>;
  diagnostics?: Array<{
    severity?: string;
    summary?: string;
    detail?: string;
  }>;
};

export function parseTerraformPlanOutput(output: string): TerraformPlanSummary | undefined {
  const jsonBlocks = extractJsonBlocks(output);
  if (!jsonBlocks.length) return undefined;

  const resources: TerraformPlanResourceChange[] = [];
  const warnings: string[] = [];

  for (const block of jsonBlocks) {
    let parsed: TerraformShowJson;
    try {
      parsed = JSON.parse(block) as TerraformShowJson;
    } catch {
      warnings.push("Terraform plan JSON could not be parsed.");
      continue;
    }

    for (const diagnostic of parsed.diagnostics || []) {
      if (diagnostic.severity === "warning") {
        warnings.push([diagnostic.summary, diagnostic.detail].filter(Boolean).join(": "));
      }
    }

    for (const change of parsed.resource_changes || []) {
      const actions = change.change?.actions || [];
      if (!actions.length || actions.includes("no-op") || actions.includes("read")) continue;
      resources.push({
        address: change.address || `${change.type || "resource"}.${change.name || "unknown"}`,
        type: change.type || "unknown",
        name: change.name || "unknown",
        providerName: change.provider_name,
        actions
      });
    }
  }

  const summary: TerraformPlanSummary = {
    adds: resources.filter((item) => sameActions(item.actions, ["create"])).length,
    changes: resources.filter((item) => sameActions(item.actions, ["update"])).length,
    destroys: resources.filter((item) => sameActions(item.actions, ["delete"])).length,
    replacements: resources.filter((item) => item.actions.includes("create") && item.actions.includes("delete")).length,
    resources,
    dangerous: resources.some((item) => item.actions.includes("delete")),
    warnings
  };

  return summary;
}

export function stripTerraformPlanJson(output: string) {
  let cleaned = output;
  while (cleaned.includes(PLAN_JSON_START) && cleaned.includes(PLAN_JSON_END)) {
    const start = cleaned.indexOf(PLAN_JSON_START);
    const end = cleaned.indexOf(PLAN_JSON_END, start);
    if (start === -1 || end === -1) break;
    cleaned = `${cleaned.slice(0, start).trimEnd()}\n${cleaned.slice(end + PLAN_JSON_END.length).trimStart()}`;
  }
  return cleaned.trim();
}

function extractJsonBlocks(output: string) {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < output.length) {
    const start = output.indexOf(PLAN_JSON_START, cursor);
    if (start === -1) break;
    const jsonStart = start + PLAN_JSON_START.length;
    const end = output.indexOf(PLAN_JSON_END, jsonStart);
    if (end === -1) break;
    blocks.push(output.slice(jsonStart, end).trim());
    cursor = end + PLAN_JSON_END.length;
  }

  return blocks;
}

function sameActions(actions: string[], expected: string[]) {
  return actions.length === expected.length && expected.every((action) => actions.includes(action));
}

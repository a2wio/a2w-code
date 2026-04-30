import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { workspaceRepoRoot } from "./data";
import { decryptSecret, encryptSecret } from "./secrets";
import { validateTerraformRootPath } from "./terraform-roots";
import type { AppData, TerraformRootVariableValue, TerraformVariableDefinition } from "./types";

export async function discoverTerraformVariables(workspaceId: string, rootPath: string, data: AppData): Promise<TerraformVariableDefinition[]> {
  const normalizedRoot = validateTerraformRootPath(rootPath);
  const repoRoot = workspaceRepoRoot(workspaceId);
  const files = await terraformFiles(join(repoRoot, normalizedRoot));
  const stored = (data.terraformVariables || []).filter((item) => item.workspaceId === workspaceId && item.rootPath === normalizedRoot);
  const definitions = new Map<string, TerraformVariableDefinition>();

  for (const file of files) {
    const content = await readFile(join(repoRoot, normalizedRoot, file), "utf8");
    for (const block of variableBlocks(content)) {
      const existing = definitions.get(block.name);
      definitions.set(block.name, {
        ...block,
        required: block.required || existing?.required || false,
        sensitive: block.sensitive || existing?.sensitive || looksSensitive(block.name)
      });
    }
  }

  return [...definitions.values()]
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
    .map((definition) => {
      const value = stored.find((item) => item.name === definition.name);
      return {
        ...definition,
        value: value ? maskOrPlainValue(value) : undefined
      };
    });
}

export function terraformVariableEnv(values: TerraformRootVariableValue[]) {
  const env: Record<string, string> = {};
  for (const value of values) {
    const raw = value.sensitive && value.secret ? decryptSecret(value.secret) : value.value;
    if (raw) env[`TF_VAR_${value.name}`] = raw;
  }
  return env;
}

export function sanitizeTerraformVariableValue(name: string, value: unknown) {
  const cleanName = String(name || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanName)) throw new Error("Invalid Terraform variable name.");
  const cleanValue = String(value || "").trim();
  if (!cleanValue) throw new Error(`${cleanName} is required.`);
  if (cleanName.toLowerCase().includes("private_key") || /PRIVATE KEY/.test(cleanValue)) {
    throw new Error("Private keys must not be stored in A2W-Codex-Terraform-v0.0.1. Provide public keys or external secret references only.");
  }
  return { name: cleanName, value: cleanValue, sensitive: looksSensitive(cleanName) };
}

export function upsertTerraformVariable(input: {
  existing?: TerraformRootVariableValue;
  workspaceId: string;
  rootPath: string;
  name: string;
  value: string;
  sensitive: boolean;
}) {
  const now = new Date().toISOString();
  return {
    id: input.existing?.id || randomUUID(),
    workspaceId: input.workspaceId,
    rootPath: validateTerraformRootPath(input.rootPath),
    name: input.name,
    value: input.sensitive ? undefined : input.value,
    secret: input.sensitive ? encryptSecret(input.value) : undefined,
    sensitive: input.sensitive,
    createdAt: input.existing?.createdAt || now,
    updatedAt: now
  } satisfies TerraformRootVariableValue;
}

function maskOrPlainValue(value: TerraformRootVariableValue) {
  if (value.sensitive) return value.secret ? "configured" : undefined;
  return value.value;
}

async function terraformFiles(dir: string) {
  try {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith(".tf"));
  } catch {
    return [];
  }
}

function variableBlocks(content: string) {
  const blocks: TerraformVariableDefinition[] = [];
  const pattern = /variable\s+"([^"]+)"\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content))) {
    const name = match[1];
    const start = pattern.lastIndex;
    const end = findBlockEnd(content, start);
    const body = content.slice(start, end);
    blocks.push({
      name,
      description: attrString(body, "description"),
      type: attrExpression(body, "type"),
      required: !/(^|\n)\s*default\s*=/.test(body),
      sensitive: /(^|\n)\s*sensitive\s*=\s*true/.test(body) || looksSensitive(name)
    });
  }

  return blocks;
}

function findBlockEnd(content: string, start: number) {
  let depth = 1;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return index;
  }
  return content.length;
}

function attrString(body: string, name: string) {
  const match = body.match(new RegExp(`(^|\\n)\\s*${name}\\s*=\\s*"([^"]*)"`, "m"));
  return match?.[2];
}

function attrExpression(body: string, name: string) {
  const match = body.match(new RegExp(`(^|\\n)\\s*${name}\\s*=\\s*([^\\n]+)`, "m"));
  return match?.[2]?.trim();
}

function looksSensitive(name: string) {
  return /secret|password|token|private|credential/i.test(name);
}

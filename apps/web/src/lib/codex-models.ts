export const CODEX_MODEL_OPTIONS = [
  { id: "", label: "Codex CLI default" },
  { id: "gpt-5.3-codex-spark", label: "Codex Spark" },
  { id: "gpt-5.3-codex", label: "Codex" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.5", label: "GPT-5.5" }
];

export function sanitizeCodexModel(value: unknown) {
  const model = String(value || "").trim();
  if (!model || model === "default" || model === "cli" || model === "reset") return "";
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
    throw new Error("Codex model can contain only letters, numbers, dots, dashes, underscores, and colons.");
  }
  if (model.length > 96) throw new Error("Codex model name is too long.");
  return model;
}

export type CodexDeviceAuth = {
  verificationUrl?: string;
  userCode?: string;
};

export function parseCodexDeviceAuth(output: string): CodexDeviceAuth | undefined {
  const cleaned = stripAnsi(output);
  const urls = cleaned.match(/https:\/\/[^\s<>"')]+/g) || [];
  const verificationUrl = urls
    .map(normalizeUrl)
    .find((url) => !url.includes("localhost") && /(?:auth\.openai\.com|chatgpt\.com|openai\.com)/i.test(url));
  const userCode = extractUserCode(cleaned);
  if (!verificationUrl && !userCode) return undefined;
  return { verificationUrl, userCode };
}

function extractUserCode(output: string) {
  const labeled = output.match(/(?:user|device|verification)?\s*code\s*(?:is|:|=)?\s*([A-Z0-9][A-Z0-9-]{4,24})/i);
  if (labeled?.[1]) return normalizeCode(labeled[1]);

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/https?:\/\//i.test(line)) continue;
    const standalone = line.match(/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{3,})+\b/);
    if (standalone?.[0]) return normalizeCode(standalone[0]);
  }

  return undefined;
}

function normalizeCode(value: string) {
  return value.trim().replace(/[.,;:]+$/, "").toUpperCase();
}

function normalizeUrl(value: string) {
  return value.trim().replace(/[.,;:]+$/, "");
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

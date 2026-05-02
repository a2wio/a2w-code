export type CodexPromptState = {
  ready: boolean;
  stagedInput: string;
  viewingTranscript?: boolean;
};

export function codexPromptState(output: string): CodexPromptState {
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  if (codexChoicePickerActive(output)) return { ready: false, stagedInput: "" };
  if (codexInterruptActive(lines)) return { ready: false, stagedInput: "" };
  if (codexPlanSuggestionActive(lines)) return { ready: true, stagedInput: "" };
  const prompt = lines.slice(-16).reverse().find((line) => line.startsWith("›"));
  if (prompt) {
    const stagedInput = prompt.replace(/^›\s*/, "").trim();
    if (codexFooterReady(lines)) return { ready: true, stagedInput: "" };
    const placeholder = isCodexPlaceholder(stagedInput);
    if (stagedInput && !placeholder) return { ready: false, stagedInput };
    return {
      ready: !stagedInput || placeholder,
      stagedInput: placeholder ? "" : stagedInput
    };
  }
  if (codexTranscriptViewerActive(lines)) return { ready: false, stagedInput: "", viewingTranscript: true };
  return { ready: false, stagedInput: "" };
}

export function codexPlanSuggestionActive(lines: string[]) {
  const tail = lines.slice(-16).join(" ");
  return /create\s+a\s+plan\?/i.test(tail)
    && /shift\s*\+\s*tab/i.test(tail)
    && /plan\s+mode/i.test(tail)
    && /esc\s+dismiss/i.test(tail);
}

export function isCodexPlaceholder(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return true;
  if (clean === "explain this codebase") return true;
  if (clean === "review my changes") return true;
  if (clean === "find and fix a bug") return true;
  if (clean === "implement {feature}") return true;
  if (/^implement\s+\{[^}]+\}$/.test(clean)) return true;
  if (clean === "use /skills to list available skills") return true;
  if (/^use\s+\/skills\b/.test(clean)) return true;
  if (/^create\s+a\s+plan\?/.test(clean) && /plan\s+mode|esc\s+dismiss/.test(clean)) return true;
  if (clean.includes("@filename")) return true;
  if (/^type\s+(a\s+)?message/.test(clean)) return true;
  if (/^(ask|message)\s+codex\b/.test(clean)) return true;
  return /^(find and fix|write tests|explain|review)\b/.test(clean) && clean.includes("@filename");
}

function codexTranscriptViewerActive(lines: string[]) {
  const tail = lines.slice(-30).join(" ");
  return /q to quit/i.test(tail) && /(?:↑\/↓|pgup\/pgdn|home\/end|to scroll|to page|to jump|edit prev|edit next)/i.test(tail);
}

function codexFooterReady(lines: string[]) {
  return lines.slice(-8).some((line) => /gpt-[\w.-]+.*·.*\//i.test(line));
}

function codexInterruptActive(lines: string[]) {
  return lines.slice(-16).some((line) => /(?:esc|ctrl-c|control-c)\s+to\s+interrupt/i.test(line));
}

function codexChoicePickerActive(output: string) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .some((line) => /^›?\s*\d+\.\s+/.test(line));
}

import assert from "node:assert/strict";
import test from "node:test";
import { codexPromptState } from "../src/lib/codex-prompt-state.ts";

test("treats Codex plan suggestion as a ready prompt state", () => {
  const state = codexPromptState([
    "›",
    "Create a plan? shift + tab use Plan mode esc dismiss"
  ].join("\n"));

  assert.deepEqual(state, {
    ready: true,
    stagedInput: ""
  });
});

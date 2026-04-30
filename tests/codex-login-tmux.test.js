import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexDeviceAuth } from "../src/lib/codex-login-parser.ts";

test("parses Codex device auth URL and user code", () => {
  const parsed = parseCodexDeviceAuth([
    "Open the following URL to authenticate:",
    "https://auth.openai.com/activate",
    "",
    "User code: abcd-efgh"
  ].join("\n"));

  assert.deepEqual(parsed, {
    verificationUrl: "https://auth.openai.com/activate",
    userCode: "ABCD-EFGH"
  });
});

test("ignores localhost browser login URLs", () => {
  const parsed = parseCodexDeviceAuth([
    "Starting local login server on http://localhost:1455.",
    "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
    "Use `codex login --device-auth` instead."
  ].join("\n"));

  assert.equal(parsed?.userCode, undefined);
  assert.equal(parsed?.verificationUrl, undefined);
});

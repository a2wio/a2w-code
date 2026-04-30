import test from "node:test";
import assert from "node:assert/strict";
import { isHiddenWorkspaceFile, workspaceGitignore } from "../src/lib/workspace-ignore.js";

test("hides Terraform runtime files from workspace browsing", () => {
  const hidden = [
    ".terraform.lock.hcl",
    "infrastructure/terraform/providers/azure/hello-function/.terraform/providers/registry.terraform.io/hashicorp/azurerm",
    "infrastructure/terraform/providers/azure/hello-function/terraform.tfstate",
    "infrastructure/terraform/providers/azure/hello-function/terraform.tfstate.backup",
    "infrastructure/terraform/providers/azure/hello-function/plan.tfplan",
    "infrastructure/terraform/providers/azure/hello-function/dev.tfvars.local"
  ];

  for (const path of hidden) {
    assert.equal(isHiddenWorkspaceFile(path), true, path);
  }

  assert.equal(isHiddenWorkspaceFile("infrastructure/terraform/providers/azure/hello-function/main.tf"), false);
  assert.match(workspaceGitignore(), /\.terraform\/\n/);
  assert.match(workspaceGitignore(), /terraform\.tfstate\.\*/);
});

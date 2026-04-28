import assert from "node:assert/strict";
import test from "node:test";
import { parseTerraformPlanOutput, stripTerraformPlanJson } from "../src/lib/terraform-plan-parser.ts";

test("parses terraform show json between sandbox delimiters", () => {
  const output = [
    "human plan output",
    "== A2W_TERRAFORM_PLAN_JSON_START ==",
    JSON.stringify({
      resource_changes: [
        { address: "azurerm_resource_group.main", type: "azurerm_resource_group", name: "main", change: { actions: ["create"] } },
        { address: "azurerm_linux_virtual_machine.vm", type: "azurerm_linux_virtual_machine", name: "vm", change: { actions: ["update"] } },
        { address: "azurerm_storage_account.old", type: "azurerm_storage_account", name: "old", change: { actions: ["delete", "create"] } },
        { address: "data.azurerm_client_config.current", type: "azurerm_client_config", name: "current", change: { actions: ["read"] } }
      ]
    }),
    "== A2W_TERRAFORM_PLAN_JSON_END =="
  ].join("\n");

  const summary = parseTerraformPlanOutput(output);
  assert.equal(summary?.adds, 1);
  assert.equal(summary?.changes, 1);
  assert.equal(summary?.destroys, 0);
  assert.equal(summary?.replacements, 1);
  assert.equal(summary?.dangerous, true);
  assert.equal(summary?.resources.length, 3);
});

test("strips embedded terraform plan json from human output", () => {
  const output = [
    "before",
    "== A2W_TERRAFORM_PLAN_JSON_START ==",
    "{\"resource_changes\":[]}",
    "== A2W_TERRAFORM_PLAN_JSON_END ==",
    "after"
  ].join("\n");

  assert.equal(stripTerraformPlanJson(output), "before\nafter");
});

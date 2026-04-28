import test from "node:test";
import assert from "node:assert/strict";
import { generateAgentResponse, inferPlanIntent, validateProviderConnection } from "../src/agent.js";

test("generates an AWS DStack-style platform plan", () => {
  const result = generateAgentResponse({
    message: "Create a staging EKS platform in eu-central-1 with Argo CD, ingress, TLS, and observability.",
    workspace: { companyName: "Acme", cloudPreference: "aws" },
    providerConnection: {
      id: "conn_1",
      provider: "aws",
      region: "eu-central-1"
    }
  });

  assert.equal(result.plan.provider, "aws");
  assert.equal(result.plan.cluster, "EKS");
  assert.equal(result.plan.environment, "staging");
  assert.equal(result.plan.blocked, false);
  assert.ok(result.plan.terraformChanges.some((item) => item.includes("Argo CD")));
  assert.ok(result.plan.plannedFiles.includes("infrastructure/terraform/modules/aws/eks/main.tf"));
  assert.ok(result.plan.plannedFiles.includes("infrastructure/terraform/providers/aws/eu-central-1/eks/main.tf"));
  assert.ok(result.plan.gitopsChanges.some((item) => item.includes("kube-prometheus-stack")));
  assert.ok(result.plan.contextRules.some((item) => item.includes("Terraform may provision")));
});

test("blocks destructive production requests", () => {
  const result = generateAgentResponse({
    message: "Destroy the production cluster immediately.",
    workspace: { companyName: "Acme", cloudPreference: "aws" }
  });

  assert.equal(result.plan.blocked, true);
  assert.equal(result.plan.risk, "critical");
  assert.ok(result.plan.securityChecks.some((item) => item.includes("Destructive requests are blocked")));
});

test("rejects static provider secrets", () => {
  const validation = validateProviderConnection("aws", {
    roleArn: "arn:aws:iam::123456789012:role/a2w-infra-agent",
    externalId: "demo",
    region: "eu-central-1",
    accessKey: "AKIA..."
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.includes("not static secrets")));
});

test("detects Azure AKS intent", () => {
  const result = generateAgentResponse({
    message: "Create a production AKS platform in westeurope.",
    workspace: { companyName: "Acme", cloudPreference: "azure" },
    providerConnection: {
      id: "conn_2",
      provider: "azure",
      region: "westeurope"
    }
  });

  assert.equal(result.plan.provider, "azure");
  assert.equal(result.plan.cluster, "AKS");
  assert.equal(result.plan.environment, "production");
  assert.equal(result.plan.risk, "high");
});

test("infers observability-only requests", () => {
  const intent = inferPlanIntent("Add Prometheus metrics and Grafana alerts.");

  assert.equal(intent.wantsObservability, true);
  assert.equal(intent.wantsCluster, false);
});

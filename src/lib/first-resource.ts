import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { workspaceRepoRoot } from "./data";
import { workspaceGitignore } from "./workspace-ignore.js";
import type { CloudProvider, InfraPlan, Workspace } from "./types";

export function createHelloFunctionPlan(
  workspace: Workspace,
  provider: Extract<CloudProvider, "aws" | "azure">,
  region?: string
): InfraPlan {
  const createdAt = new Date().toISOString();
  const providerLabel = provider === "aws" ? "AWS" : "Azure";
  const cluster = provider === "aws" ? "Lambda" : "Azure Function";
  const selectedRegion = region || (provider === "aws" ? "eu-central-1" : "westeurope");
  const hello = `hello! ${workspace.companyName}`;
  const base = provider === "aws" ? "apps/hello-lambda" : "apps/hello-azure-function";
  const moduleName = provider === "aws" ? "hello-lambda" : "hello-function";
  const modulePath = terraformModulePath(provider, moduleName);
  const infra = terraformProviderCallPath(provider, selectedRegion, moduleName);

  return {
    id: `plan_${Date.now().toString(36)}`,
    workspaceId: workspace.id,
    title: provider === "aws" ? "First AWS Lambda function" : "First Azure Function",
    provider,
    providerLabel,
    cluster,
    environment: "development",
    region: selectedRegion,
    status: "ready_for_review",
    risk: "low",
    blocked: false,
    approvalRequired: true,
    providerConnected: true,
    summary: `${providerLabel} first resource: a serverless function that returns "${hello}".`,
    assumptions: [
      "This is the onboarding resource and should stay intentionally small.",
      "Cloud credentials are supplied through the local sandbox or operator environment, not committed to files.",
      "Terraform owns the function resource and supporting identity/storage primitives."
    ],
    terraformChanges:
      provider === "aws"
        ? [
            "Create a reusable AWS hello-lambda Terraform module.",
            "Create a provider call directory that initializes AWS and calls the module.",
            "Package the Python handler as a zip archive inside the module.",
            "Expose outputs from the call directory for function name and ARN."
          ]
        : [
            "Create a reusable Azure hello-function Terraform module.",
            "Create a provider call directory that initializes AzureRM and calls the module.",
            "Create storage, app service plan, and Linux Function App inside the module.",
            "Expose outputs from the call directory for function app name and hostname."
          ],
    gitopsChanges: ["No Kubernetes GitOps changes are needed for the first serverless resource."],
    securityChecks: [
      "No cloud secrets are written to the repository.",
      "Sandbox validation should run before approval.",
      "Terraform apply remains disabled unless explicitly enabled locally."
    ],
    executionSteps: [
      "Review generated Terraform and function code.",
      "Run sandbox validation.",
      "Approve the plan.",
      "Run a local Terraform plan with your own cloud environment configured."
    ],
    plannedFiles:
      provider === "aws"
        ? [
            `${base}/handler.py`,
            `${modulePath}/main.tf`,
            `${modulePath}/variables.tf`,
            `${modulePath}/outputs.tf`,
            `${infra}/main.tf`,
            `${infra}/locals.tf`,
            `${infra}/outputs.tf`
          ]
        : [
            `${base}/host.json`,
            `${base}/hello/function.json`,
            `${base}/hello/__init__.py`,
            `${modulePath}/main.tf`,
            `${modulePath}/variables.tf`,
            `${modulePath}/outputs.tf`,
            `${infra}/main.tf`,
            `${infra}/locals.tf`,
            `${infra}/outputs.tf`
          ],
    contextRules: [
      "First resource onboarding creates one small serverless function only.",
      "Terraform implementation lives in infrastructure/terraform/modules/<provider>/<module>.",
      "Terraform provider call directories live under infrastructure/terraform/providers/<provider>/<region>/<stack> and own their own local state.",
      "Provider credentials are passed through the operator environment.",
      "Every deployment starts as generated files and a reviewable plan.",
      "Apply requires explicit approval."
    ],
    createdAt
  };
}

export async function materializeHelloFunctionFiles(workspace: Workspace, plan: InfraPlan) {
  const root = workspaceRepoRoot(workspace.id);
  const files = plan.provider === "aws" ? awsFiles(workspace, plan) : azureFiles(workspace, plan);
  const written: string[] = [];

  for (const [path, content] of Object.entries(files)) {
    const target = safeJoin(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
    written.push(path);
  }

  return written;
}

function awsFiles(workspace: Workspace, plan: InfraPlan) {
  const message = `hello! ${workspace.companyName}`;
  const modulePath = terraformModulePath("aws", "hello-lambda");
  const callPath = terraformProviderCallPath("aws", plan.region, "hello-lambda");
  return {
    "README.md": readme(workspace, plan),
    ".gitignore": workspaceGitignore(),
    "AGENTS.md": agentNotes(),
    "apps/hello-lambda/handler.py": `import json


def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"message": "${message}"})
    }
`,
    [`${callPath}/main.tf`]: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = local.region
}

module "hello_lambda" {
  source = "../../../../modules/aws/hello-lambda"

  project_slug = local.project_slug
}
`,
    [`${callPath}/locals.tf`]: `locals {
  region       = "${plan.region}"
  project_slug = "a2w-onboarding"
}
`,
    [`${callPath}/outputs.tf`]: `output "function_name" {
  value = module.hello_lambda.function_name
}

output "function_arn" {
  value = module.hello_lambda.function_arn
}
`,
    [`${modulePath}/main.tf`]: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.5"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "archive_file" "function" {
  type        = "zip"
  source_file = "\${path.module}/../../../../../apps/hello-lambda/handler.py"
  output_path = "\${path.module}/build/hello-lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name = "\${var.project_slug}-hello-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "hello" {
  function_name    = "\${var.project_slug}-hello"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.function.output_path
  source_code_hash = data.archive_file.function.output_base64sha256
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 10
}
`,
    [`${modulePath}/variables.tf`]: `variable "project_slug" {
  type        = string
  description = "Lowercase project slug used for AWS resource names."
  default     = "a2w-onboarding"
}
`,
    [`${modulePath}/outputs.tf`]: `output "function_name" {
  value = aws_lambda_function.hello.function_name
}

output "function_arn" {
  value = aws_lambda_function.hello.arn
}
`
  };
}

function azureFiles(workspace: Workspace, plan: InfraPlan) {
  const message = `hello! ${workspace.companyName}`;
  const modulePath = terraformModulePath("azure", "hello-function");
  const callPath = terraformProviderCallPath("azure", plan.region, "hello-function");
  return {
    "README.md": readme(workspace, plan),
    ".gitignore": workspaceGitignore(),
    "AGENTS.md": agentNotes(),
    "apps/hello-azure-function/host.json": `{
  "version": "2.0"
}
`,
    "apps/hello-azure-function/hello/function.json": `{
  "scriptFile": "__init__.py",
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "$return"
    }
  ]
}
`,
    "apps/hello-azure-function/hello/__init__.py": `import json
import azure.functions as func


def main(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"message": "${message}"}),
        mimetype="application/json",
        status_code=200,
    )
`,
    [`${callPath}/main.tf`]: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  resource_provider_registrations = "none"
  resource_providers_to_register = [
    "Microsoft.Storage",
    "Microsoft.Web"
  ]

  features {}
}

module "hello_function" {
  source = "../../../../modules/azure/hello-function"

  project_slug = local.project_slug
  region       = local.region
}
`,
    [`${callPath}/locals.tf`]: `locals {
  region       = "${plan.region}"
  project_slug = "a2w-onboarding"
}
`,
    [`${callPath}/outputs.tf`]: `output "function_app_name" {
  value = module.hello_function.function_app_name
}

output "default_hostname" {
  value = module.hello_function.default_hostname
}
`,
    [`${modulePath}/main.tf`]: `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_resource_group" "hello" {
  name     = "\${var.project_slug}-hello-rg"
  location = var.region
}

resource "azurerm_storage_account" "hello" {
  name                     = replace("\${var.project_slug}\${random_string.suffix.result}", "-", "")
  resource_group_name      = azurerm_resource_group.hello.name
  location                 = azurerm_resource_group.hello.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "hello" {
  name                = "\${var.project_slug}-hello-plan"
  resource_group_name = azurerm_resource_group.hello.name
  location            = azurerm_resource_group.hello.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "hello" {
  name                       = "\${var.project_slug}-hello-\${random_string.suffix.result}"
  resource_group_name        = azurerm_resource_group.hello.name
  location                   = azurerm_resource_group.hello.location
  service_plan_id            = azurerm_service_plan.hello.id
  storage_account_name       = azurerm_storage_account.hello.name
  storage_account_access_key = azurerm_storage_account.hello.primary_access_key

  site_config {
    application_stack {
      python_version = "3.11"
    }
  }
}
`,
    [`${modulePath}/variables.tf`]: variables(plan),
    [`${modulePath}/outputs.tf`]: `output "function_app_name" {
  value = azurerm_linux_function_app.hello.name
}

output "default_hostname" {
  value = azurerm_linux_function_app.hello.default_hostname
}
`
  };
}

function variables(plan: InfraPlan) {
  return `variable "region" {
  type        = string
  description = "Cloud region."
  default     = "${plan.region}"
}

variable "project_slug" {
  type        = string
  description = "Lowercase project slug used for resource names."
  default     = "a2w-onboarding"
}
`;
}

function readme(workspace: Workspace, plan: InfraPlan) {
  return `# ${workspace.companyName} First Resource

${plan.summary}

## Plan

- Provider: ${plan.providerLabel}
- Resource: ${plan.cluster}
- Region: ${plan.region}
- Status: ${plan.status}

## Deploy Locally

Configure your cloud credentials in your shell, then run Terraform from the matching directory under \`infrastructure/terraform/providers\`.

## Terraform Layout

This repository follows the DStack-style Terraform boundary:

- Reusable implementation lives under \`infrastructure/terraform/modules/<provider>/<module>\`.
- Deployable call directories live under \`infrastructure/terraform/providers/<provider>/<region>/<stack>\`.
- Terraform is initialized and applied only from a provider call directory.
- Local Terraform state belongs to that call directory, not to the whole repository and not to a chat.
`;
}

function agentNotes() {
  return `# Agent Contract

- This onboarding repository contains one first serverless resource.
- This repository is the shared workspace for the local A2W instance. Chats share files, but Terraform state is scoped per provider call directory.
- Put resource logic in \`infrastructure/terraform/modules/<provider>/<module>\`.
- Put provider initialization, concrete locals, module calls, and module outputs in \`infrastructure/terraform/providers/<provider>/<region>/<stack>\`.
- Do not put cloud resource blocks directly in provider call directories except provider/bootstrap boilerplate.
- Do not commit static cloud secrets.
- Use the Podman sandbox to validate files before approval.
- Terraform apply is only allowed through an explicit local operator action.
`;
}

function terraformModulePath(provider: Extract<CloudProvider, "aws" | "azure">, moduleName: string) {
  return `infrastructure/terraform/modules/${provider}/${moduleName}`;
}

function terraformProviderCallPath(provider: Extract<CloudProvider, "aws" | "azure">, region: string, stackName: string) {
  return `infrastructure/terraform/providers/${provider}/${slugPathPart(region)}/${stackName}`;
}

function slugPathPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default-region";
}

function safeJoin(root: string, path: string) {
  const target = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error("Invalid workspace file path.");
  }
  return target;
}

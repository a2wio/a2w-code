# A2W Infra Agent Console

Self-hosted infrastructure editor for platform engineers. A2W combines a Codex-backed chat, a Terraform repository browser, Git controls, and gated sandbox actions for `fmt`, `plan`, `apply`, and `destroy`.

The MVP is single-admin and single-instance. Credentials are stored locally in `.data/db.json`, encrypted with the instance secret, and injected only into sandbox runs.

## Stack

- Next.js, React, TypeScript, Tailwind CSS
- Local JSON state in `.data/`
- Codex CLI for chat-driven repository edits
- Terraform sandbox via local Podman or Kubernetes Jobs
- DStack-style Terraform layout:
  - modules: `infrastructure/terraform/modules/<provider>/<module>`
  - roots: `infrastructure/terraform/providers/<provider>/<region>/<stack>`

## Local Run

```sh
cp .env.example .env.local
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

For production-style local run:

```sh
npm run build
npm start
```

## Required Env

Set strong values before exposing the app:

```sh
A2W_ADMIN_USERNAME=admin
A2W_ADMIN_PASSWORD=change-me
AUTH_SECRET=replace-me
A2W_ENCRYPTION_KEY=replace-me
A2W_AGENT_BACKEND=codex
A2W_ENABLE_TERRAFORM_APPLY=false
```

Codex auth is handled during onboarding with:

```sh
codex login --device-auth
```

For Kubernetes deployments where Codex's internal Linux sandbox cannot run:

```sh
A2W_CODEX_BYPASS_SANDBOX=true
```

Keep that disabled for local host-first use.

## Terraform Sandbox

Local Podman:

```sh
podman build -t a2w-infra-sandbox:latest -f sandbox/Containerfile sandbox
A2W_SANDBOX_BACKEND=podman
A2W_SANDBOX_IMAGE=a2w-infra-sandbox:latest
```

Kubernetes:

```sh
A2W_SANDBOX_BACKEND=kubernetes
A2W_SANDBOX_IMAGE=registry.k6nis.dev/a2w/infra-sandbox:v0.0.1
A2W_K8S_NAMESPACE=a2w-codex-terraform
A2W_K8S_DATA_PVC=a2w-codex-terraform-data
A2W_CODEX_BYPASS_SANDBOX=true
```

In Kubernetes mode, A2W creates short-lived Jobs, mounts the workspace PVC, injects credentials through temporary Secrets, captures logs, and cleans up the run resources.

## Build Images

GitHub Actions workflow:

```text
.github/workflows/container-images.yml
```

Required repository secrets:

```text
A2W_REGISTRY_USERNAME
A2W_REGISTRY_PASSWORD
```

Images pushed:

```text
registry.k6nis.dev/a2w/codex-terraform:v0.0.1
registry.k6nis.dev/a2w/infra-sandbox:v0.0.1
```

Local equivalent:

```sh
podman build --platform linux/amd64 -t registry.k6nis.dev/a2w/codex-terraform:v0.0.1 -f Dockerfile .
podman build --platform linux/amd64 -t registry.k6nis.dev/a2w/infra-sandbox:v0.0.1 -f sandbox/Containerfile sandbox
```

## Checks

```sh
npm test
npm run build
```

Release helper:

```sh
npm run release:check
```

## Safety

Terraform apply and destroy require:

- server env: `A2W_ENABLE_TERRAFORM_APPLY=true`
- workspace setting enabled
- explicit UI approval
- typed confirmation

Treat `.data/` as sensitive. It contains app state, workspace files, and encrypted provider credentials.

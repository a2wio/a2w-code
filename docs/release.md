# Release Guide

This release is packaged for self-hosted operation. The image includes the Codex CLI, Git, tmux, and Podman tooling. The host-first path still requires those tools on the host. Kubernetes deployments can run Terraform through short-lived in-cluster Jobs instead of a host Podman socket.

## Runtime Requirements

- Node.js 20 or newer
- npm
- Git
- tmux
- Podman with a working Linux machine/socket for host-first sandbox runs
- Codex CLI for host-first deployment. The container image already includes it.
- A private network or reverse proxy with authentication/TLS if exposed beyond localhost

## Host Deployment

```sh
cp .env.example .env.local
```

Set strong values for:

- `A2W_ADMIN_PASSWORD`
- `AUTH_SECRET`
- `A2W_ENCRYPTION_KEY`

Build the Terraform sandbox image:

```sh
npm run sandbox:build
```

Authenticate Codex through onboarding, or run it directly on the host:

```sh
codex login
```

The onboarding UI can start `codex login` inside tmux and show the device-code output from the same runtime that will later run chat.

Build and start the UI:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:5173`.

## Container Image

The app image includes the Next.js server, Codex CLI, Git, SSH client, tmux, and Podman tooling. It is useful for a Linux self-host where the app container can reach the host Podman socket. The app still executes Terraform through the separate `a2w-infra-sandbox:latest` image.

```sh
npm run container:build
```

Then configure `.env.local` and run:

```sh
podman compose up -d
```

In the container path, mount persistent Codex auth at `/home/node/.codex`. The included compose file mounts `${HOME}/.codex` there so onboarding can populate or reuse the same Codex login.

`compose.yaml` mounts `.data`, `~/.codex`, and the rootless Podman socket. It also sets:

- `A2W_CONTAINER_PROJECT_ROOT=/app`
- `A2W_HOST_PROJECT_ROOT=${PWD}`

Those are required so sandbox volume paths generated inside the app container are translated back to the host checkout path before `podman run` starts the Terraform sandbox.

## Kubernetes Sandbox Backend

When deployed inside Kubernetes, set `A2W_SANDBOX_BACKEND=kubernetes`. The app service account must be able to create/delete Jobs, ConfigMaps, Secrets, and NetworkPolicies in its namespace, and read Pods plus Pod logs.

The Kubernetes backend uses the same `A2W_SANDBOX_IMAGE` Terraform runner image, mounts the app data PVC into each Job with `subPath=workspaces/<workspace-id>/repository`, injects cloud credentials through a temporary Secret, captures logs, then deletes the temporary resources.

Minimum runtime variables:

```sh
A2W_SANDBOX_BACKEND=kubernetes
A2W_SANDBOX_IMAGE=registry.example.com/a2w/infra-sandbox:v0.0.1
A2W_K8S_NAMESPACE=a2w-codex-terraform
A2W_K8S_DATA_PVC=a2w-codex-terraform-data
```

## Release Check

```sh
npm run release:check
```

The check runs unit tests, a production Next build, and a sandbox image build when Podman is available.

To skip the sandbox image build in CI:

```sh
A2W_RELEASE_SKIP_SANDBOX=1 npm run release:check
```

## GitHub Actions Image Build

The repository includes `.github/workflows/container-images.yml` to build and push both release images on GitHub-hosted `linux/amd64` runners.

Configure these repository secrets:

- `A2W_REGISTRY_USERNAME`
- `A2W_REGISTRY_PASSWORD`

The workflow pushes:

- `registry.k6nis.dev/a2w/codex-terraform:v<package.json version>`
- `registry.k6nis.dev/a2w/codex-terraform:latest`
- `registry.k6nis.dev/a2w/codex-terraform:sha-<short-sha>`
- `registry.k6nis.dev/a2w/infra-sandbox:v<package.json version>`
- `registry.k6nis.dev/a2w/infra-sandbox:latest`
- `registry.k6nis.dev/a2w/infra-sandbox:sha-<short-sha>`

Run it from GitHub Actions with **Container Images > Run workflow**, or push to `main` / a `v*` tag.

## Release Archive

```sh
npm run release:archive
```

This creates `dist/a2w-codex-terraform-v0.0.1.tar.gz` from tracked files plus untracked release files, while respecting `.gitignore`.

## Publishing Checklist

- Pick and add the project license before publishing publicly.
- Keep `.data/`, `.env.local`, `.next/`, and `node_modules/` out of the release.
- Confirm `A2W_ENABLE_TERRAFORM_APPLY=false` in the default environment.
- Tag the release as `v0.0.1`.
- Include the sandbox image build command in release notes.

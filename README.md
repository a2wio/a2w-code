# A2W Infra Agent Console

A2W is a self-hostable Next.js console for DevOps and platform engineers. It gives a local operator a ChatGPT-style infrastructure agent, onboarding for AWS/Azure trust setup, a native project file browser, and Podman-isolated Terraform workflows.

The current MVP is intentionally single-instance and single-admin. There is no public registration flow, no SaaS tenant model, and no hosted credential custody. Cloud credentials are stored in local `.data/db.json`, encrypted with the instance secret, and injected only into sandbox runs.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Instance username/password auth with signed HTTP-only cookies
- Local JSON persistence in `.data/db.json`
- Workspace repository files in `.data/workspaces/selfhost-workspace/repository`
- Optional local Codex CLI backend through the host operator's `codex login`
- Podman sandbox execution for `terraform fmt`, `plan`, `apply`, and `destroy`

## Configure

Copy `.env.example` to `.env.local` and change the secrets before exposing the UI beyond localhost.

```sh
cp .env.example .env.local
```

Important variables:

- `A2W_ADMIN_USERNAME` and `A2W_ADMIN_PASSWORD` control the only login.
- `A2W_WORKSPACE_NAME` is used for the local workspace and generated "hello" function.
- `AUTH_SECRET` signs browser sessions.
- `A2W_ENCRYPTION_KEY` encrypts provider secrets at rest.
- `A2W_AGENT_BACKEND=codex` forces the host Codex CLI for chat-driven workspace edits. Onboarding can also enable Codex per workspace after `codex login`.
- `A2W_CODEX_MODEL` sets an instance default model for `codex exec`. Settings or `/model <model-id>` can override it per workspace.
- `A2W_ENABLE_TERRAFORM_APPLY=true` allows apply/destroy routes to run after explicit UI approval.

In local development only, the app accepts `admin` / `password123` when no admin env vars are set. Production requires `A2W_ADMIN_PASSWORD`.

To use your Codex subscription, authenticate on the self-hosted machine and switch the backend:

```sh
codex login
A2W_AGENT_BACKEND=codex npm run dev
```

You can also leave `A2W_AGENT_BACKEND=mock`, run `codex login`, and verify Codex during onboarding. Codex runs against `.data/workspaces/selfhost-workspace/repository` with workspace-write sandboxing. Terraform apply/destroy remains a separate A2W sandbox action.

Each A2W chat stores its own Codex thread id after the first Codex run, then uses `codex exec resume` for follow-up prompts. Inside chat, use `/model` to see the current model and suggested IDs, `/model gpt-5.3-codex-spark` for faster runs, or `/model default` to return to the Codex CLI default.

Terraform follows a DStack-style repository layout:

- Reusable implementation lives in `infrastructure/terraform/modules/<provider>/<module>`.
- Deployable call directories live in `infrastructure/terraform/providers/<provider>/<region>/<stack>`.
- Provider call directories initialize Terraform/providers, set concrete locals, call modules, and expose module outputs.
- Terraform state is per provider call directory. Chats are conversations over the same workspace files; they do not own Terraform state.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

For a built self-hosted instance:

```sh
npm run build
npm start
```

The bundled scripts bind to `127.0.0.1:5173` by default. Put a private reverse proxy in front of it if you expose it beyond the local machine.

## Routes

- `/` console entrypoint. Operators are redirected to sign-in, onboarding, or chat.
- `/auth` instance admin sign-in.
- `/onboarding` first-run cloud setup, Codex login verification, and first resource creation.
- `/dashboard/agent` chat-first infra agent with plan, files, fmt, plan, apply, and destroy modals.
- `/dashboard/files` local workspace file browser.
- `/dashboard/settings` cloud credentials, apply policy, and sign out.

Older dashboard routes redirect into the reduced chat/files/settings surface.

## Sandbox Image

The app expects a local Podman image named `a2w-infra-sandbox:latest`.

```sh
podman build -t a2w-infra-sandbox:latest -f sandbox/Containerfile sandbox
```

Validation and `terraform fmt` can run without cloud credentials. Terraform `plan`, `apply`, and `destroy` need network-enabled sandbox runs and valid provider credentials from onboarding/settings.

The sandbox discovers Terraform call directories below `infrastructure/terraform/providers` and runs each one independently. It does not run Terraform from the repository root or from reusable module directories.

## Manual Test

1. Start the app and open `/auth`.
2. Sign in with the configured instance admin credentials.
3. Complete onboarding: choose AWS or Azure, follow the provider trust instructions, and enter credentials.
4. Run `codex login` on the host and verify Codex in the onboarding step.
5. Land in `/dashboard/agent`.
6. Open the generated files modal or `/dashboard/files`.
7. Run `terraform fmt`, then `terraform plan`.
8. Approve the plan in chat.
9. Enable `A2W_ENABLE_TERRAFORM_APPLY=true` and allow apply/destroy in Settings before running cloud-changing actions.

## Test And Build

```sh
npm test
npm run build
```

## Safety Notes

Terraform apply and destroy are gated twice: by the local server env var and by the workspace policy in Settings. The UI also requires an explicit typed confirmation before mutation.

This is still an MVP. Run it on a trusted machine or private network, use least-privilege cloud credentials where possible, and treat `.data/` as sensitive because it contains workspace state and encrypted provider secrets.
# terraform-codex

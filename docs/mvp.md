# MVP Strategy

## Thesis

Traditional SaaS gives a user dashboards and forms, then expects the user to perform the work. A2W is now shaped as a self-hosted agent console: a platform operator runs it locally, describes the infrastructure state they want, and the agent plans, changes, verifies, and reports the work through a governed execution path.

For infrastructure, the wedge is strong because customers already want standardization. Most teams should not invent bespoke cloud platforms. They need a reliable Kubernetes platform, secure networking, observability, ingress, secrets, policies, GitOps, and a repeatable way to evolve it.

## Product Wedge

The first operator is a DevOps or platform engineer who wants a controlled UI around local Codex, workspace files, Podman, and Terraform. The first job is:

> "Create and operate my cloud Kubernetes platform using boring, standardized tools, and let me request changes in natural language."

The dashboard is not the product. The agent's operating discipline is the product.

## Standard Contract

The MVP standardizes on the same split as DStack:

- Terraform owns cloud primitives: remote state, networks, managed Kubernetes, node pools, identity, and initial Argo CD bootstrap.
- GitOps owns cluster state: Argo CD Applications, platform components, policies, and workloads.

This split matters because it gives the agent a stable context boundary. Without that boundary, the agent will mix cloud provisioning, Kubernetes mutations, and application changes in ways that are hard to review.

## Implemented MVP Loop

1. Operator signs in with the instance username and password.
2. Operator completes onboarding for AWS or Azure.
3. Operator configures provider trust and local secrets.
4. Onboarding writes the first Lambda or Azure Function files.
5. Chat becomes the primary interface for plan review and actions.
6. The operator can run `terraform fmt`, `plan`, `apply`, and `destroy` through Podman.
7. Apply and destroy require explicit approval, typed confirmation, the instance env flag, and the workspace policy.
8. Every generated plan writes files into `.data/workspaces/selfhost-workspace/repository`.

## Non-Goals

- No public registration or hosted SaaS tenant model.
- No static access keys.
- No one-off infrastructure patterns per customer.
- No free-form shell execution.
- No hidden mutations outside review and approval.

## Next Build Step

The next valuable backend capability is local Codex-backed editing with a strict tool boundary:

- Let the operator authenticate Codex on the host.
- Invoke `codex exec` from the server against the workspace repository.
- Constrain writes to the workspace repository.
- Stream the Codex reasoning summary and file diff back into chat.
- Keep Terraform apply/destroy as separate, human-approved sandbox actions.

That creates a safe bridge between chat-driven code generation and real infrastructure execution.

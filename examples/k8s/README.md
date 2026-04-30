# Kubernetes Example

Reference Kubernetes deployment for A2W.

This example assumes:

- Gateway API
- cert-manager with a `letsencrypt-prod` ClusterIssuer
- a registry containing both A2W images
- one persistent volume for app/workspace data
- one persistent volume for Codex auth

Edit before applying:

- `infra.example.com`
- `registry.example.com/a2w/codex-terraform:v0.0.1`
- `registry.example.com/a2w/infra-sandbox:v0.0.1`
- admin password and instance secrets

## Render

```sh
kubectl kustomize examples/k8s
```

## Secret

Create a normal Secret for testing:

```sh
kubectl -n a2w-codex-terraform create secret generic a2w-codex-terraform-secrets \
  --from-literal=A2W_ADMIN_USERNAME='admin' \
  --from-literal=A2W_ADMIN_PASSWORD='<change-me>' \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=A2W_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

Or generate a SealedSecret:

```sh
kubectl -n a2w-codex-terraform create secret generic a2w-codex-terraform-secrets \
  --from-literal=A2W_ADMIN_USERNAME='admin' \
  --from-literal=A2W_ADMIN_PASSWORD='<change-me>' \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=A2W_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml \
| kubeseal --format=yaml \
> examples/k8s/secrets-sealed.yml
```

Then add `secrets-sealed.yml` to `kustomization.yml`.

## Notes

- `A2W_CODEX_BYPASS_SANDBOX=true` is set because Codex's internal Linux sandbox often cannot run inside restricted pods.
- Terraform still runs in separate Kubernetes Jobs.
- `A2W_ENABLE_TERRAFORM_APPLY=false` is the safe default.

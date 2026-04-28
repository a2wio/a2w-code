#!/usr/bin/env sh
set -eu

cd /workspace

echo "== A2W sandbox validate =="
echo "workspace: $(pwd)"

terraform_call_dirs() {
  if [ -n "${A2W_TERRAFORM_DIRS:-}" ]; then
    printf '%s\n' "$A2W_TERRAFORM_DIRS" | tr ':' '\n' | sort -u | while read -r dir; do
      if [ -n "$dir" ] && [ -d "$dir" ] && ls "$dir"/*.tf >/dev/null 2>&1; then
        echo "$dir"
      fi
    done
    return
  fi

  if [ -d infrastructure/terraform/providers ]; then
    find infrastructure/terraform/providers -type f -name '*.tf' -exec dirname {} \; | sort -u
  fi
}

if [ -d infrastructure/terraform ]; then
  echo ""
  echo "== terraform fmt =="
  terraform fmt -check -recursive infrastructure/terraform

  echo ""
  echo "== terraform provider call directories =="
  echo "Each directory below infrastructure/terraform/providers is initialized independently; reusable modules are not run directly."
  terraform_call_dirs | while read -r dir; do
    echo "-- $dir"
    if [ "${A2W_SANDBOX_NETWORK:-0}" = "1" ]; then
      (cd "$dir" && terraform init -backend=false -input=false >/tmp/a2w-terraform-init.log && terraform validate)
    else
      (cd "$dir" && terraform providers >/tmp/a2w-terraform-providers.log)
      echo "   skipped terraform validate; enable sandbox network to download provider schemas"
    fi
  done
else
  echo "No infrastructure/terraform directory found."
fi

if [ -d k8s-cluster-configuration/kustomize ]; then
  echo ""
  echo "== kustomize build overlays =="
  find k8s-cluster-configuration/kustomize -name kustomization.yaml -exec dirname {} \; | sort -u | while read -r dir; do
    echo "-- $dir"
    kustomize build "$dir" >/tmp/a2w-kustomize-build.yaml
  done
else
  echo "No k8s-cluster-configuration/kustomize directory found."
fi

echo ""
echo "Sandbox validation completed."

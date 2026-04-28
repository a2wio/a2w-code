#!/usr/bin/env sh
set -eu

cd /workspace

echo "== A2W terraform apply sandbox =="
echo "This script can create or update real cloud resources."
echo "Terraform apply only runs after explicit approval and local apply enablement."
echo "Each provider call directory owns its own local Terraform state boundary."
echo "Cloud provider credentials must be available inside the sandbox environment."

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

terraform_call_dirs | while read -r dir; do
  echo ""
  echo "-- $dir"
  (cd "$dir" && terraform init -backend=false -input=false && terraform apply -input=false -auto-approve -lock-timeout=5m -no-color)
done

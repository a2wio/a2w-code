#!/usr/bin/env sh
set -eu

cd /workspace

echo "== A2W terraform destroy sandbox =="
echo "This script can destroy real cloud resources managed by the generated Terraform state."
echo "Terraform destroy only runs after explicit approval, typed confirmation, and local apply enablement."
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
  (cd "$dir" && terraform init -backend=false -input=false && terraform destroy -input=false -auto-approve -lock-timeout=5m -no-color)
done

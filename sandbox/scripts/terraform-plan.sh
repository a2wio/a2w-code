#!/usr/bin/env sh
set -eu

cd /workspace

echo "== A2W terraform plan sandbox =="
echo "This script runs terraform plan for generated stacks."
echo "It does not run terraform apply."
echo "State locking is disabled for plan-only checks."
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
  (
    cd "$dir"
    terraform init -backend=false -input=false
    terraform plan -input=false -lock=false -no-color -refresh=false -out=/tmp/a2w.tfplan
    echo "== A2W_TERRAFORM_PLAN_JSON_START =="
    terraform show -json /tmp/a2w.tfplan
    echo "== A2W_TERRAFORM_PLAN_JSON_END =="
  )
done

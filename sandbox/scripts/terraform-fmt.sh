#!/usr/bin/env sh
set -eu

cd /workspace

echo "== A2W terraform fmt sandbox =="
echo "This script formats generated Terraform files."
echo "It can update files inside the mounted workspace repository."

if [ -d infrastructure/terraform ]; then
  terraform fmt -recursive infrastructure/terraform
else
  echo "No infrastructure/terraform directory found."
fi

echo ""
echo "Terraform formatting completed."

#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "== A2W release check =="

required_files="
README.md
.env.example
Dockerfile
Containerfile
compose.yaml
sandbox/Containerfile
sandbox/scripts/terraform-fmt.sh
sandbox/scripts/terraform-plan.sh
sandbox/scripts/terraform-apply.sh
sandbox/scripts/terraform-destroy.sh
"

for file in $required_files; do
  if [ ! -f "$file" ]; then
    echo "Missing required release file: $file" >&2
    exit 1
  fi
done

npm test
npm run build

if [ "${A2W_RELEASE_SKIP_SANDBOX:-}" = "1" ]; then
  echo "Skipping sandbox image build because A2W_RELEASE_SKIP_SANDBOX=1."
elif command -v podman >/dev/null 2>&1; then
  podman build -t a2w-infra-sandbox:latest -f sandbox/Containerfile sandbox
else
  echo "Skipping sandbox image build because podman is not on PATH."
fi

echo "Release check passed."

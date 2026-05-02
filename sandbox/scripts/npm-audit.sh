#!/usr/bin/env sh
set -eu

cd "/workspace/${A2W_PROJECT_DIR:-.}"

echo "== A2W npm audit sandbox =="
echo "This script audits package dependencies for known vulnerabilities."
echo "Network access must be enabled for npm registry checks."

if [ ! -f package.json ]; then
  echo "No package.json found in $(pwd)."
  exit 1
fi

if [ ! -f package-lock.json ]; then
  echo "No package-lock.json found."
  echo "Generating one with npm install --package-lock-only before audit."
  npm install --package-lock-only
  echo ""
fi

chmod 0644 package-lock.json 2>/dev/null || true

set +e
npm audit
audit_status=$?
set -e

echo ""
if [ "$audit_status" -eq 0 ]; then
  echo "NPM audit completed with no known vulnerabilities."
  exit 0
fi

if [ "$audit_status" -eq 1 ]; then
  echo "NPM audit completed with vulnerability findings."
  echo "Review the report above. This is not a sandbox execution failure."
  exit 0
fi

echo "NPM audit could not complete."
exit "$audit_status"

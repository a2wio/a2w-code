#!/usr/bin/env sh
set -eu

cd "/workspace/${A2W_PROJECT_DIR:-.}"

echo "== A2W npm test sandbox =="
echo "This script runs the package test script when present."

if [ ! -f package.json ]; then
  echo "No package.json found in $(pwd)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Node dependencies are not installed."
  echo "Run NPM install from the Web action menu first, then rerun NPM test."
  exit 1
fi

npm test --if-present

echo ""
echo "NPM test completed."

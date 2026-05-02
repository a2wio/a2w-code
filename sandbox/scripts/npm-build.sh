#!/usr/bin/env sh
set -eu

cd "/workspace/${A2W_PROJECT_DIR:-.}"

echo "== A2W npm build sandbox =="
echo "This script runs the package build script when present."

if [ ! -f package.json ]; then
  echo "No package.json found in $(pwd)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Node dependencies are not installed."
  echo "Run NPM install from the Web action menu first, then rerun NPM build."
  exit 1
fi

npm run build --if-present

echo ""
echo "NPM build completed."

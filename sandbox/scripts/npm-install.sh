#!/usr/bin/env sh
set -eu

cd "/workspace/${A2W_PROJECT_DIR:-.}"

echo "== A2W npm install sandbox =="
echo "This script installs Node dependencies for the active web workspace."

if [ ! -f package.json ]; then
  echo "No package.json found in $(pwd)."
  exit 1
fi

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo ""
echo "NPM dependencies installed."

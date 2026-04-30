#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -p "require('./package.json').version")"
NAME="a2w-codex-terraform-v$VERSION"
OUT_DIR="$ROOT_DIR/dist"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"
TMP_DIR="${TMPDIR:-/tmp}/$NAME-$$"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR/$NAME" "$OUT_DIR"

git ls-files --cached --others --exclude-standard | while IFS= read -r file; do
  if [ -d "$file" ]; then
    continue
  fi
  mkdir -p "$TMP_DIR/$NAME/$(dirname "$file")"
  cp "$file" "$TMP_DIR/$NAME/$file"
done

tar -czf "$ARCHIVE" -C "$TMP_DIR" "$NAME"
rm -rf "$TMP_DIR"

echo "$ARCHIVE"

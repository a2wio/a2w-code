#!/usr/bin/env bash
set -euo pipefail
ROOT=/Users/kuberdenis/Developer/a2w/a2w-code/apps/web
SESSION=prenpm_fix_web__20260518_172238
PROMPT_FILE=/Users/kuberdenis/Developer/a2w/a2w-code/apps/web/.prenpm/prenpm-fix-prompt-20260518_172238.md
LOG_FILE=/Users/kuberdenis/Developer/a2w/a2w-code/apps/web/.prenpm/prenpm-fix-20260518_172238.log
DONE_FILE=/Users/kuberdenis/Developer/a2w/a2w-code/apps/web/.prenpm/prenpm-fix-20260518_172238.status

cd "$ROOT"
{
  echo "prenpm fix session: $SESSION"
  echo "project: $ROOT"
  echo "started: $(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo
} | tee "$LOG_FILE"

set +e
codex exec --dangerously-bypass-approvals-and-sandbox -C "$ROOT" - < "$PROMPT_FILE" 2>&1 | tee -a "$LOG_FILE"
status=${PIPESTATUS[0]}
set -e

{
  echo
  echo "finished: $(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo "codex exit: $status"
} | tee -a "$LOG_FILE"
printf '%s\n' "$status" > "$DONE_FILE"
exit "$status"

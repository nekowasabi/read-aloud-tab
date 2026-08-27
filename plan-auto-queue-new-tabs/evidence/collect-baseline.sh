#!/usr/bin/env bash
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
out=${EVIDENCE_DIR:-"$root/plan-auto-queue-new-tabs/evidence/results"}
mkdir -p "$out"
env_file="$out/baseline.env"
{
  printf 'git_commit='; git -C "$root" rev-parse HEAD
  printf 'node='; node --version
  printf 'npm='; npm --version
  printf 'platform='; uname -srm
} | sed -E 's/(api[_-]?key|token|secret|password)([=:][^[:space:]]+)/\1=***MASKED***/Ig' > "$env_file"
sha256sum "$env_file" > "$env_file.sha256"
printf '%s\n' "$env_file"

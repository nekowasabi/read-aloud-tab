#!/usr/bin/env bash
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
expected="$dir/expected-gates.tsv"
[[ -r "$expected" ]] || { echo 'missing expected-gates.tsv' >&2; exit 1; }
command -v timeout >/dev/null
command -v sha256sum >/dev/null
command -v awk >/dev/null
command -v rg >/dev/null
awk -F '\t' 'NR == 1 { if ($1 != "gate_id" || $2 != "required") exit 2; next } NF != 5 { exit 3 } $1 !~ /^(P01|P02|P03|P100)-VG-[0-9]+$/ { exit 4 }' "$expected"
plan="$dir/../../PLAN-auto-queue-new-tabs.md"
while IFS=$'\t' read -r gate required phase command criteria; do
  [[ "$gate" == gate_id ]] && continue
  rg -q --fixed-strings "$gate" "$plan"
done < "$expected"
if [[ -d "$dir/results" ]]; then
  while IFS= read -r file; do
    [[ -f "$file" ]] || exit 1
    sha256sum -c "$file.sha256" >/dev/null
  done < <(find "$dir/results" -maxdepth 1 -type f -name '*.log' | sort)
fi
echo 'evidence preflight: pass'

#!/usr/bin/env bash
set -u

if [[ $# -lt 2 ]]; then
  echo 'usage: run-gate.sh GATE_ID COMMAND...' >&2
  exit 2
fi
gate_id=$1
shift
timeout_seconds=${GATE_TIMEOUT_SECONDS:-300}
artifact_dir=${EVIDENCE_DIR:-plan-auto-queue-new-tabs/evidence/results}
mkdir -p "$artifact_dir"
output="$artifact_dir/${gate_id}.log"
mask_secrets() { sed -E 's/(api[_-]?key|token|secret|password)([=:][^[:space:]]+)/\1=***MASKED***/Ig'; }
set +e
timeout --foreground "${timeout_seconds}s" "$@" 2>&1 | mask_secrets | tee "$output"
pipeline_status=(${PIPESTATUS[@]})
set -e
exit_code=${pipeline_status[0]}
mask_code=${pipeline_status[1]}
tee_code=${pipeline_status[2]}
sha256sum "$output" > "$output.sha256"
printf 'gate_id=%s\nexit_code=%s\ntimeout_seconds=%s\nmask_exit=%s\ntee_exit=%s\n' "$gate_id" "$exit_code" "$timeout_seconds" "$mask_code" "$tee_code" > "$output.meta"
[[ "$mask_code" -eq 0 && "$tee_code" -eq 0 ]] || exit 1
exit "$exit_code"

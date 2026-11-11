#!/usr/bin/env bash
# AI Denoise feasibility spike (docs/AI_DENOISE_SPIKE.md): the stages the "AI models" workflow's denoise-spike task runs
# on GitHub's runner (which can reach Google Drive, the UCLouvain Dataverse and raw.pixls.us). Read-only: nothing is
# committed or published. $P is the Python of the job's virtual environment, $RUNNER_TEMP/res becomes the artifact.
set -euo pipefail
STAGE="${1:-probe}"
D=web/scripts/denoise
T="${RUNNER_TEMP}"
RES="$T/res"
mkdir -p "$RES"
S="$RES/summary.txt"

case "$STAGE" in
  probe*)
    "$P" -I $D/fetch.py probe --grep "${STAGE#probe:}" --max-files 400 --out "$RES/dataverse-files.json" 2>&1 | tee -a "$S"
    ;;
  *)
    echo "unknown stage $STAGE"; exit 1 ;;
esac

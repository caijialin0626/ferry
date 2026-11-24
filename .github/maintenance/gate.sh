#!/usr/bin/env bash
set -euo pipefail
# Both the test driver and package manifests come from the trusted base checkout.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git archive "$CANDIDATE" | tar -x -C "$work"
docker build --quiet --tag ferry-checks - < .github/maintenance/checks.Dockerfile
docker run --rm --user "$(id -u):$(id -g)" -e npm_config_cache=/tmp/npm \
  -v "$work:/work" ferry-checks npm ci --ignore-scripts --no-audit --no-fund
# Candidate code has no credentials, checkout metadata, external network or Docker socket.
isolated=(docker run --rm --init --network none --cap-drop ALL --security-opt no-new-privileges
  --memory 4g --pids-limit 1024 --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/work:ro")
# A candidate that edits tests must also pass the original suite unchanged.
if ! git diff --quiet HEAD "$CANDIDATE" -- test; then
  "${isolated[@]}" -v "$PWD/test:/work/test:ro" ferry-checks npm test
fi
"${isolated[@]}" -v "$PWD/.github/maintenance/browser.cjs:/opt/ferry-checks/browser.cjs:ro" \
  ferry-checks sh -ec 'npm run check && npm test && node /opt/ferry-checks/browser.cjs'

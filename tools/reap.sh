#!/usr/bin/env bash
# Derived from PGSimCity tools/reap.sh @ 6d2c854 (Apache-2.0,
# © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: the CDP gate
# path is env-overridable.
set -Eeuo pipefail

# Reap what the screenshot work leaves behind. Run every loop iteration.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
k=0
for pid in $(pgrep -f "remote-debugging-port" 2>/dev/null); do
  el=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
  [ -n "$el" ] && [ "$el" -gt 900 ] && kill -9 "$pid" 2>/dev/null && k=$((k+1))
done
# Gate slots outlive a killed driver; mkdir is atomic but rmdir needs an owner.
GATE="${CDP_GATE:-/tmp/kubetropolis-cdp-gate}"
if [[ -d "$GATE" ]]; then
  find "$GATE" -maxdepth 1 -type d -name 'slot*' -mmin +10 -exec rmdir {} \; 2>/dev/null
fi
node "$script_dir/reap-cdp-profiles.mjs"
echo "reaped $k chrome"

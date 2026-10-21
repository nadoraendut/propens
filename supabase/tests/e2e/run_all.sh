#!/usr/bin/env bash
# Full browser test: builds the database from the migrations, starts PostgREST + the auth stand-in + Vite, then drives the
# real app in headless Chromium as the admin, the Head and several lecturers. See README.md for the one-time setup.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export E2E_OUT=${E2E_OUT:-/tmp/propens-e2e}
python3 "$HERE/make_lecturers.py"
bash "$HERE/up.sh" > "$E2E_OUT/up.log" 2>&1 || { cat "$E2E_OUT/up.log"; exit 1; }
python3 "$HERE/flow_a.py" | tee "$E2E_OUT/flow_a.log"
python3 "$HERE/flow_b.py" | tee "$E2E_OUT/flow_b.log"
python3 "$HERE/phone.py"  | tee "$E2E_OUT/phone.log"
! grep -h "^FAIL\|Traceback" "$E2E_OUT"/*.log && echo "E2E: all checks passed"

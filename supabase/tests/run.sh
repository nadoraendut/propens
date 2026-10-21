#!/usr/bin/env bash
# Runs the migrations and the scenario test on a scratch Postgres 16 (NOT your Supabase project).
#   PGHOST=/tmp PGPORT=5544 PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-propens_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stubs.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f supabase/tests/workflow_test.sql
echo "SQL scenario tests passed"

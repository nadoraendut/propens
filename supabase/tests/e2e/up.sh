#!/usr/bin/env bash
# (re)creates the e2e database + services. Usage: bash up.sh
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$HERE/../../.."; OUT=${E2E_OUT:-/tmp/propens-e2e}; mkdir -p "$OUT"
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5544} PGUSER=${PGUSER:-postgres}
[ -d "$HERE/node_modules" ] || (cd "$HERE" && npm install --silent --no-audit --no-fund)
[ -x /var/tmp/pgrst/postgrest ] || { echo "PostgREST binary missing: see README.md in this folder"; exit 1; }
for f in pgrst shim vite; do [ -f $OUT/$f.pid ] && kill $(cat $OUT/$f.pid) 2>/dev/null; done; sleep 1
psql -q -d postgres -c "drop database if exists propens_e2e" -c "create database propens_e2e"
psql -q -v ON_ERROR_STOP=1 -d propens_e2e -f "$REPO/supabase/tests/stubs.sql"
for f in "$REPO"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d propens_e2e -f $f; done
psql -q -d postgres -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end \$\$"
psql -q -d propens_e2e -c "grant anon, authenticated, service_role to authenticator" -c "grant all on schema public to authenticator"
psql -q -d propens_e2e <<'SQL'
create table if not exists auth.passwords (user_id uuid primary key, pw text not null);
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1', 'admin@uitm.test', '{"role":"admin"}', '{"full_name":"Dr Admin","staff_id":"ADM00001","grade":"DS54","bidang":"Pentadbiran","start_date":"1995-01-01","email":"admin@uitm.test"}'),
 ('00000000-0000-0000-0000-0000000000b1', 'head@uitm.test', '{"role":"head"}', '{"full_name":"Prof Head","staff_id":"HOF00001","grade":"DS56","bidang":"Pentadbiran","start_date":"1990-01-01","email":"head@uitm.test"}');
insert into auth.passwords values ('00000000-0000-0000-0000-0000000000a1','Admin-pass-1'), ('00000000-0000-0000-0000-0000000000b1','Head-pass-1');
SQL
cat > /var/tmp/pgrst/pgrst.conf <<'CONF'
db-uri = "postgresql:///propens_e2e?host=/tmp&port=5544&user=authenticator"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "e2e-secret-e2e-secret-e2e-secret-1234"
server-port = 3001
CONF
cd /var/tmp/pgrst && (nohup ./postgrest pgrst.conf > pgrst.log 2>&1 & echo $! > $OUT/pgrst.pid)
cd "$HERE" && (DB=propens_e2e nohup node shim.mjs > shim.log 2>&1 & echo $! > $OUT/shim.pid)
sleep 2
ANON=$(cd "$HERE" && node shim.mjs anon)
cd "$REPO" && (VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=$ANON nohup node node_modules/vite/bin/vite.js --port 5173 --host 127.0.0.1 > $OUT/vite.log 2>&1 & echo $! > $OUT/vite.pid)
sleep 4
curl -s -o /dev/null -w "vite %{http_code}\n" http://127.0.0.1:5173/
curl -s -w " <- rest %{http_code}\n" -H "apikey: $ANON" http://127.0.0.1:54321/rest/v1/semesters | head -c 200

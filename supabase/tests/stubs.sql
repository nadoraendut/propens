-- Minimal stand-ins for what Supabase provides, so the migrations can be tested on a plain Postgres 16.
-- NOT for production: Supabase already has all of this.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb not null default '{}',
  raw_user_meta_data jsonb not null default '{}'
);
-- the SQL test harness sets  set_config('test.uid', '<uuid>', false)  to act as a user; PostgREST sets the JWT claims
-- (this is how Supabase's own auth.uid() reads the signed-in user)
create or replace function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('test.uid', true), ''), nullif(current_setting('request.jwt.claim.sub', true), ''),
                     (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'))::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;

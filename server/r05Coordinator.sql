-- Dedicated Perch R05 database ONLY. This is a small CAS store, not flight history.
-- RPC callers need a server-only 256-bit credential in addition to the API key.
create schema if not exists perch_r05;
revoke all on schema perch_r05 from public, anon, authenticated;
create table if not exists perch_r05.control (
  singleton boolean primary key default true check (singleton),
  credential_hash text not null check (length(credential_hash)=64)
);
create table if not exists perch_r05.budget (
  scope text primary key check (scope in ('live','verification')),
  revision bigint not null default 0 check (revision>=0),
  state jsonb not null check (jsonb_typeof(state)='object' and octet_length(state::text)<131072)
);
create table if not exists perch_r05.cache (
  scope text not null references perch_r05.budget(scope),
  key text not null check (key ~ '^[a-f0-9]{64}$'),
  payload text not null check (length(payload)<8192),
  expires_at_ms bigint not null,
  primary key (scope,key)
);
alter table perch_r05.control enable row level security;
alter table perch_r05.budget enable row level security;
alter table perch_r05.cache enable row level security;
revoke all on all tables in schema perch_r05 from public, anon, authenticated;
create index if not exists r05_cache_expiry on perch_r05.cache(expires_at_ms);

-- SECURITY DEFINER is necessary to keep the tables inaccessible to Data API
-- roles. The explicit server credential authenticates this single-purpose RPC;
-- no Supabase end-user Auth is introduced or substituted for Aero Pane PIN.
create or replace function public.perch_r05_exchange(
  p_secret text,
  p_scope text,
  p_key text,
  p_expected bigint default null,
  p_state jsonb default null,
  p_payload text default null,
  p_expires bigint default null
) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='1s' as $$
declare
  b perch_r05.budget%rowtype;
  c perch_r05.cache%rowtype;
  wall bigint;
begin
  if p_secret is null or length(p_secret)<>64 or
     not exists(select 1 from perch_r05.control where
       credential_hash=encode(extensions.digest(p_secret,'sha256'),'hex')) then
    raise exception 'unauthorized' using errcode='28000';
  end if;
  if p_scope is null or p_key is null or p_scope not in ('live','verification') or p_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid request' using errcode='22023';
  end if;
  select * into b from perch_r05.budget where scope=p_scope for update;
  if not found then raise exception 'coordinator unavailable'; end if;
  wall:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  delete from perch_r05.cache where expires_at_ms<=wall;
  if p_state is not null then
    if p_expected is null or p_expected<>b.revision then
      return jsonb_build_object('ok',false,'conflict',true,'nowMs',wall);
    end if;
    if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text)>=131072 or
       p_state->'schemaVersion' is distinct from '1'::jsonb or
       jsonb_typeof(p_state->'updatedAtMs') is distinct from 'number' or
       jsonb_typeof(p_state->'dailyLimit') is distinct from 'number' or
       jsonb_typeof(p_state->'tokens') is distinct from 'number' or
       (p_state->>'tokens')::numeric<0 or (p_state->>'tokens')::numeric>3 or
       jsonb_typeof(p_state->'charges') is distinct from 'array' or
       jsonb_array_length(p_state->'charges')>2881 or
       (p_state->>'updatedAtMs')::bigint<(b.state->>'updatedAtMs')::bigint or
       (p_state->>'updatedAtMs')::bigint>wall or
       (p_state->>'dailyLimit')::int<>(b.state->>'dailyLimit')::int then
      raise exception 'invalid state' using errcode='22023';
    end if;
    update perch_r05.budget set state=p_state,revision=revision+1
      where scope=p_scope returning * into b;
    if p_payload is not null then
      if length(p_payload)>=8192 or p_expires is null or p_expires<=wall or
         p_expires>wall+1800000 then raise exception 'invalid cache'; end if;
      insert into perch_r05.cache(scope,key,payload,expires_at_ms)
        values(p_scope,p_key,p_payload,p_expires)
        on conflict(scope,key) do update set payload=excluded.payload,
          expires_at_ms=excluded.expires_at_ms;
      delete from perch_r05.cache where scope=p_scope and key in
        (select key from perch_r05.cache where scope=p_scope
          order by expires_at_ms desc,key offset 128);
    end if;
  elsif p_expected is not null or p_payload is not null or p_expires is not null then
    raise exception 'invalid request' using errcode='22023';
  end if;
  select * into c from perch_r05.cache where scope=p_scope and key=p_key;
  return jsonb_build_object('ok',true,'revision',b.revision,'state',b.state,
    'nowMs',wall,'cache',case when c.key is null then null else
      jsonb_build_object('payload',c.payload,'expiresAtMs',c.expires_at_ms) end);
end; $$;
revoke all on function public.perch_r05_exchange(text,text,text,bigint,jsonb,text,bigint) from public, authenticated;
grant execute on function public.perch_r05_exchange(text,text,text,bigint,jsonb,text,bigint) to anon;

-- Research Studio MVP. Run in your OWN approved Supabase project (SQL editor).
-- Never store secrets or identifiable real taxpayer data in GitHub Pages.
-- Re-run carefully in staging first; intended for first-time installation.

create table if not exists public.studies (
    id text primary key check (id ~ '^[a-z0-9-]{3,64}$'),
    owner_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(title) between 1 and 150),
    published boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists public.study_events (
    id uuid primary key default gen_random_uuid(),
    study_id text not null references public.studies(id) on delete cascade,
    session_id uuid not null,
    kind text not null check(kind in ('session_started','session_completed','task_started','task_ended','answers','interaction_batch','method_event')),
    task_id text,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint payload_size check(octet_length(payload::text) <= 25000),
    constraint task_id_length check(task_id is null or char_length(task_id) <= 64)
);
create index if not exists study_events_study_timestamp_idx on public.study_events(study_id, created_at);
create index if not exists study_events_session_idx on public.study_events(session_id, created_at);

alter table public.studies enable row level security;
alter table public.study_events enable row level security;

-- Revoke broad default grants and explicitly allow only the needed operations.
revoke all on public.studies from public, anon, authenticated;
revoke all on public.study_events from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert on public.studies to authenticated;
grant select (id, published) on public.studies to anon;
grant select on public.study_events to authenticated;
grant insert on public.study_events to anon;

-- For public participants, only published study metadata is visible. Owners can
-- read their own draft/published studies and create records tied to their UID.
create policy "studies anon sees published" on public.studies
    for select to anon using (published = true);
create policy "studies researcher sees owned" on public.studies
    for select to authenticated using (owner_id = (select auth.uid()));
create policy "studies researcher inserts owned" on public.studies
    for insert to authenticated with check (owner_id = (select auth.uid()));

-- Participants can append data ONLY to studies published by a researcher.
-- No anon SELECT / UPDATE / DELETE policy exists for participant responses.
create policy "events participant submits to published study" on public.study_events
    for insert to anon with check (
       exists(select 1 from public.studies s where s.id = study_id and s.published = true)
    );

-- Only the owner of a study can retrieve its response events.
create policy "events researcher reads owned study" on public.study_events
    for select to authenticated using (
       exists(select 1 from public.studies s where s.id = study_id and s.owner_id = (select auth.uid()))
    );

-- Harden before real deployment: load testing, rate limiting, bot protection,
-- data retention, deletion process, monitoring and penetration/security review.

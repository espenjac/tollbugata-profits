-- Per-user Web Push subscriptions for background simulator buy notifications.

create table if not exists public.sim_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists sim_push_subscriptions_user_idx
  on public.sim_push_subscriptions (user_id);

alter table public.sim_push_subscriptions enable row level security;

drop policy if exists "users manage own simulator push subscriptions"
  on public.sim_push_subscriptions;
create policy "users manage own simulator push subscriptions"
  on public.sim_push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.sim_push_subscriptions from anon, authenticated;
grant select, insert, update, delete
  on public.sim_push_subscriptions to authenticated;
grant all on public.sim_push_subscriptions to service_role;

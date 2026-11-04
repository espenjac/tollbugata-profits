drop policy if exists "update own reports" on public.reports;
create policy "update own reports" on public.reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Conversas de Investidores — definições partilhadas do jogo.
-- Corre isto UMA vez no SQL Editor da Supabase (Dashboard → SQL Editor).
-- Guarda o estado de abrir/fechar submissões e as datas, partilhado por todos.

create table if not exists public.game_settings (
  id               integer primary key default 1,
  submissions_open boolean not null default true,
  game_start_date  text,
  game_end_date    text,
  constraint game_settings_singleton check (id = 1)
);

-- Linha única inicial
insert into public.game_settings (id, submissions_open)
values (1, true)
on conflict (id) do nothing;

-- Mesmo modelo de acesso do resto da app (anon key)
alter table public.game_settings enable row level security;

drop policy if exists "game_settings read"  on public.game_settings;
create policy "game_settings read"  on public.game_settings
  for select using (true);

drop policy if exists "game_settings write" on public.game_settings;
create policy "game_settings write" on public.game_settings
  for all using (true) with check (true);

grant select, insert, update on public.game_settings to anon;

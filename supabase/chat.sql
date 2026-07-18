-- ============================================================================
-- Chat geral (sala única) — todos os membros enviam/recebem em tempo real.
-- ----------------------------------------------------------------------------
-- Leitura PÚBLICA (mural comum aos membros); escrita só via service_role
-- (rotas /api/chat/*, com name+pin -> authOwner). Realtime ativado no fim.
-- user_id = dono (auth de editar/apagar). author_name = nome congelado
-- (display + payload de realtime sem precisar de join a users). Idempotente.
-- ============================================================================

create table if not exists public.chat_messages (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  author_name text        not null,
  content     text        not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index if not exists chat_messages_created_idx on public.chat_messages (created_at);

alter table public.chat_messages enable row level security;
drop policy if exists "public_read_chat" on public.chat_messages;
create policy "public_read_chat"
  on public.chat_messages for select using (true);
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to anon, authenticated;
grant all privileges on public.chat_messages to service_role;

-- Realtime: publica INSERT/UPDATE/DELETE desta tabela para o cliente (anon) subscrever.
-- (idempotente: só adiciona se ainda não estiver na publicação)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

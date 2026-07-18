-- ============================================================================
-- Reações às mensagens do chat — ❤️ 🔥 😂 (1 por pessoa por emoji por mensagem).
-- Espelha comment_reactions, mas com `user_name` desnormalizado (para o "quem reagiu"
-- funcionar em Realtime sem join). Leitura pública; escrita só via service_role
-- (/api/chat/react, name+pin -> authOwner). Realtime ativado no fim. Idempotente.
-- ============================================================================

create table if not exists public.chat_message_reactions (
  message_id uuid        not null references public.chat_messages(id) on delete cascade,
  user_id    uuid        not null references public.users(id)         on delete cascade,
  user_name  text        not null,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists chat_message_reactions_msg_idx
  on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;
drop policy if exists "public_read_chat_reactions" on public.chat_message_reactions;
create policy "public_read_chat_reactions"
  on public.chat_message_reactions for select using (true);
revoke all on public.chat_message_reactions from anon, authenticated;
grant select on public.chat_message_reactions to anon, authenticated;
grant all privileges on public.chat_message_reactions to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;

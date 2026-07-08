-- ============================================================================
-- Reações aos comentários — ❤️ 🔥 😂 (1 por pessoa por emoji por comentário)
-- ----------------------------------------------------------------------------
-- Leitura PÚBLICA (as contagens veem-se no mural); escrita só via service_role
-- (rota /api/comments/react, com name+pin → authOwner). Idempotente.
-- ============================================================================

create table if not exists public.comment_reactions (
  comment_id uuid        not null references public.portfolio_comments(id) on delete cascade,
  user_id    uuid        not null references public.users(id)             on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);
create index if not exists comment_reactions_cmt_idx
  on public.comment_reactions (comment_id);

alter table public.comment_reactions enable row level security;
drop policy if exists "public_read_comment_reactions" on public.comment_reactions;
create policy "public_read_comment_reactions"
  on public.comment_reactions for select using (true);
revoke all on public.comment_reactions from anon, authenticated;
grant select on public.comment_reactions to anon, authenticated;
grant all privileges on public.comment_reactions to service_role;

-- ============================================================================
-- Reações sociais nos portefólios — comentários (opiniões / roasts) + gostos
-- ----------------------------------------------------------------------------
-- Cada portefólio pode receber gostos (1 por pessoa) e comentários. Só quem
-- submeteu portefólio (tem PIN) escreve — verificado no servidor via authOwner.
-- Leitura PÚBLICA (o mural é visível a todos); escrita só via service_role (rotas
-- /api/comments/* e /api/likes/toggle). Corre no Supabase: SQL Editor > Run.
-- Idempotente.
-- ============================================================================

-- Comentários -----------------------------------------------------------------
create table if not exists public.portfolio_comments (
  id           uuid        primary key default gen_random_uuid(),
  portfolio_id uuid        not null references public.portfolios(id) on delete cascade,
  user_id      uuid        not null references public.users(id)      on delete cascade,
  content      text        not null,
  created_at   timestamptz not null default now()
);
create index if not exists portfolio_comments_pf_idx
  on public.portfolio_comments (portfolio_id, created_at desc);

alter table public.portfolio_comments enable row level security;
drop policy if exists "public_read_portfolio_comments" on public.portfolio_comments;
create policy "public_read_portfolio_comments"
  on public.portfolio_comments for select using (true);
revoke all on public.portfolio_comments from anon, authenticated;
grant select on public.portfolio_comments to anon, authenticated;
grant all privileges on public.portfolio_comments to service_role;

-- Gostos (1 por pessoa por portefólio) ---------------------------------------
create table if not exists public.portfolio_likes (
  portfolio_id uuid        not null references public.portfolios(id) on delete cascade,
  user_id      uuid        not null references public.users(id)      on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (portfolio_id, user_id)
);
create index if not exists portfolio_likes_pf_idx
  on public.portfolio_likes (portfolio_id);

alter table public.portfolio_likes enable row level security;
drop policy if exists "public_read_portfolio_likes" on public.portfolio_likes;
create policy "public_read_portfolio_likes"
  on public.portfolio_likes for select using (true);
revoke all on public.portfolio_likes from anon, authenticated;
grant select on public.portfolio_likes to anon, authenticated;
grant all privileges on public.portfolio_likes to service_role;

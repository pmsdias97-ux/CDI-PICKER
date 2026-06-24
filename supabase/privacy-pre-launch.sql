-- ============================================================================
-- Privacidade pré-lançamento — esconder as ESCOLHAS dos portefólios oficiais
-- ----------------------------------------------------------------------------
-- Problema: a leitura pública (anon) de portfolio_stocks deixava qualquer pessoa
-- ler, via API, as 8 ações de todos os portefólios oficiais antes de 1 jul.
-- Correção: anon só pode ler as ações de um portefólio se:
--   - for DEMO (official = false, exemplos públicos), OU
--   - a competição já tiver arrancado (competition_started = true).
-- Depois de 1 jul, com "Iniciar competição", tudo fica visível.
-- O próprio dono vê o seu portefólio via rota de servidor (nome + código).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.portfolio_stocks enable row level security;

drop policy if exists "public_read_portfolio_stocks" on public.portfolio_stocks;
drop policy if exists "read_portfolio_stocks"        on public.portfolio_stocks;

create policy "read_portfolio_stocks" on public.portfolio_stocks
for select using (
  exists (
    select 1 from public.portfolios p
    where p.id = portfolio_stocks.portfolio_id
      and (
        p.official = false
        or coalesce((select gs.competition_started from public.game_settings gs where gs.id = 1), false) = true
      )
  )
);

-- Reforço (defesa em profundidade): o código de 3 dígitos NUNCA é legível por anon.
alter table public.member_pins enable row level security;
revoke all on public.member_pins from anon, authenticated;
grant all privileges on public.member_pins to service_role;

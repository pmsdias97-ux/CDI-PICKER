-- ============================================================================
-- Snapshots diários de rentabilidade — para o gráfico de evolução (#5)
-- ----------------------------------------------------------------------------
-- Um cron (/api/cron/snapshot) grava 1×/dia o retorno de cada portefólio aqui.
-- Leitura pública (gráfico); escrita só via service_role (servidor).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

create table if not exists public.portfolio_snapshots (
  id          bigint generated always as identity primary key,
  portfolio_id uuid not null references public.portfolios(id) on delete cascade,
  date        date not null,
  total_return double precision not null,   -- retorno médio do portefólio nesse dia (ex.: 0.0123 = +1,23%)
  created_at  timestamptz not null default now(),
  unique (portfolio_id, date)               -- 1 snapshot por portefólio por dia
);

create index if not exists portfolio_snapshots_pf_date_idx
  on public.portfolio_snapshots (portfolio_id, date);

-- RLS: leitura pública, escrita negada ao anon (só service_role escreve).
alter table public.portfolio_snapshots enable row level security;

drop policy if exists "public_read_snapshots" on public.portfolio_snapshots;
create policy "public_read_snapshots" on public.portfolio_snapshots for select using (true);

-- Grants (mesma lógica do resto do projeto).
grant select on public.portfolio_snapshots to anon, authenticated;
grant all privileges on public.portfolio_snapshots to service_role;
grant usage, select on all sequences in schema public to service_role;

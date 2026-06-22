-- ============================================================================
-- Fundamentais por ticker (cache aprendido para os tooltips de detalhe)
-- ----------------------------------------------------------------------------
-- EPS, ações em circulação e máximo de 52 semanas vêm do Alpha Vantage OVERVIEW
-- (o mesmo endpoint dos setores). Cada ticker é buscado uma vez e guardado aqui;
-- P/E e Market Cap são depois calculados ao vivo com o preço atual.
-- Leitura pública; escrita só via service_role (servidor).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

create table if not exists public.ticker_fundamentals (
  ticker             text primary key,
  eps                double precision,
  shares_outstanding double precision,
  week52_high        double precision,
  updated_at         timestamptz not null default now()
);

alter table public.ticker_fundamentals enable row level security;

drop policy if exists "public_read_ticker_fundamentals" on public.ticker_fundamentals;
create policy "public_read_ticker_fundamentals" on public.ticker_fundamentals for select using (true);

grant select on public.ticker_fundamentals to anon, authenticated;
grant all privileges on public.ticker_fundamentals to service_role;

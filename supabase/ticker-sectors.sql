-- ============================================================================
-- Setores aprendidos por ticker (cache persistente do donut "Exposição por setor")
-- ----------------------------------------------------------------------------
-- Tickers fora do mapa curado são resolvidos uma vez via Alpha Vantage e
-- gravados aqui. Depois servem-se sempre da BD (sem repetir chamadas à API).
-- Leitura pública; escrita só via service_role (servidor).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

create table if not exists public.ticker_sectors (
  ticker     text primary key,
  sector     text not null,
  source     text,
  updated_at timestamptz not null default now()
);

alter table public.ticker_sectors enable row level security;

drop policy if exists "public_read_ticker_sectors" on public.ticker_sectors;
create policy "public_read_ticker_sectors" on public.ticker_sectors for select using (true);

grant select on public.ticker_sectors to anon, authenticated;
grant all privileges on public.ticker_sectors to service_role;

-- Aba "ATH": distância de cada ação do S&P 500 ao seu máximo histórico.
-- Dados calculados fora do site (GitHub Action / yfinance) e gravados via service_role.
-- Leitura PÚBLICA (anon) — a aba é aberta a qualquer visitante.
create table if not exists sp500_ath (
  symbol      text primary key,
  name        text,
  price       numeric,
  marketcap   numeric,
  shares      numeric,
  ath         numeric,
  ath_ts      timestamptz,
  updated_at  timestamptz default now()
);

alter table sp500_ath enable row level security;

-- Só leitura para anon/authenticated; a escrita é feita pelo service_role (ignora RLS).
drop policy if exists "sp500_ath_read" on sp500_ath;
create policy "sp500_ath_read" on sp500_ath
  for select to anon, authenticated using (true);

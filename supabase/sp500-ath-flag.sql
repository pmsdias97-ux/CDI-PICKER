-- Distingue ações do S&P 500 (true) das EXTRA (watchlists/portefólios dos membros, false).
-- A vista principal "Máximo histórico" mostra só in_sp500=true; as watchlists/Minhas usam todas.
alter table public.sp500_ath add column if not exists in_sp500 boolean not null default true;
create index if not exists sp500_ath_in_sp500_idx on public.sp500_ath (in_sp500);

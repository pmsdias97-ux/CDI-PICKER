-- ============================================================================
-- Registo de splits já aplicados aos baselines (auto-correção justa)
-- ----------------------------------------------------------------------------
-- Quando uma ação faz split a meio da competição, o yfinance reajusta os preços
-- ao vivo para a nova escala mas o baseline trancado (portfolio_stocks.initial_price)
-- fica na escala antiga -> rentabilidade fantasma (ex.: CRWD 4-for-1 -> -74.69%).
--
-- O endpoint /api/cron/splits corrige os baselines dos membros de forma JUSTA:
-- divide o initial_price pelo fator do split, mas SÓ para quem tinha o baseline
-- trancado ANTES da data do split (quem submeteu depois já tem o preço pós-split).
--
-- Esta tabela é o LEDGER de idempotência: cada split (symbol + data) é aplicado
-- UMA vez. Sem ela, uma segunda passagem voltaria a dividir e estragava tudo.
--
-- RLS ativo SEM política => anon/authenticated não lê nem escreve; só o
-- service_role (servidor) mexe. Corre com: npm run db:apply supabase/stock-splits-ledger.sql
-- Idempotente.
-- ============================================================================

create table if not exists public.applied_stock_splits (
  symbol            text        not null,
  split_date        date        not null,
  factor            numeric     not null,
  holdings_adjusted integer     not null default 0,
  applied_at        timestamptz not null default now(),
  primary key (symbol, split_date)
);

alter table public.applied_stock_splits enable row level security;
-- Sem políticas => só o service_role (ignora RLS). Defesa extra:
revoke all on public.applied_stock_splits from anon, authenticated;
grant all privileges on public.applied_stock_splits to service_role;

-- Seed: o split 4-for-1 da CRWD (efetivo 2026-07-02) JÁ foi corrigido à mão
-- (763.14 -> 190.79, 3 holdings). Marca-o como aplicado para o guard automático
-- NUNCA o voltar a dividir. on conflict do nothing => seguro correr outra vez.
insert into public.applied_stock_splits (symbol, split_date, factor, holdings_adjusted, applied_at)
values ('CRWD', '2026-07-02', 4.0, 3, now())
on conflict (symbol, split_date) do nothing;

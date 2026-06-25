-- ============================================================================
-- Snapshots INTRADAY — vários pontos por dia (ex.: 2×/dia)
-- ----------------------------------------------------------------------------
-- Para o Season Race / Evolução ficarem mais densos/ondulados precisamos de
-- guardar mais que 1 ponto por dia. Passamos a unicidade de (portfolio_id, date)
-- para (portfolio_id, captured_at) — cada corrida do cron usa um "slot" (hora
-- arredondada), por isso 2 corridas/dia = 2 pontos/dia e um re-run no mesmo slot
-- não duplica. Mantém-se a coluna `date` (compatibilidade / agrupamento).
-- Idempotente. Correr no Supabase: SQL Editor > New query > Run.
-- ============================================================================

-- 1) Nova coluna com o instante da captura.
alter table public.portfolio_snapshots
  add column if not exists captured_at timestamptz;

-- 2) Backfill dos registos existentes (1/dia) a partir do created_at.
update public.portfolio_snapshots
  set captured_at = coalesce(created_at, (date::timestamp at time zone 'UTC'))
  where captured_at is null;

alter table public.portfolio_snapshots
  alter column captured_at set default now();

-- 3) Trocar a unicidade: de (portfolio_id, date) para (portfolio_id, captured_at).
alter table public.portfolio_snapshots
  drop constraint if exists portfolio_snapshots_portfolio_id_date_key;

create unique index if not exists portfolio_snapshots_pf_captured_uidx
  on public.portfolio_snapshots (portfolio_id, captured_at);

-- 4) Índice de leitura por (portefólio, instante).
create index if not exists portfolio_snapshots_pf_captured_idx
  on public.portfolio_snapshots (portfolio_id, captured_at);

-- (RLS e grants já estão definidos em snapshots.sql — leitura pública, escrita
--  só via service_role. Nada a alterar aqui.)

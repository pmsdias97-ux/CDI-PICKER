-- ============================================================================
-- Baselines semanais — "Campeão da semana" (mini-época semanal)
-- ----------------------------------------------------------------------------
-- Toda a segunda-feira (à abertura US), o cron /api/cron/weekly-baselines grava o
-- preço de CADA ticker em competição para o período da semana. O 'period' é a data
-- da SEGUNDA-FEIRA (UTC) dessa semana, no formato 'YYYY-MM-DD' (ex.: '2026-07-06').
--
-- A rentabilidade semanal = média de (preço_atual / baseline_da_semana − 1), espelhada
-- para shorts — a MESMA fórmula do total, só que com o preço de INÍCIO DA SEMANA em vez
-- do preço de submissão. Justo ao membro (pondera por 1/preço-início-da-semana).
--
-- SEM seed: a 1.ª semana (6–12 jul 2026) arranca ao vivo na 2ª feira 6-jul; até lá o
-- separador "Semanal" mostra o estado "começa 2ª feira" (rentabilidade "—").
--
-- Leitura PÚBLICA (o leaderboard é calculado no cliente); escrita só via service_role
-- (o cron). Idempotente. Corre no Supabase: SQL Editor > Run.
-- ============================================================================

create table if not exists public.weekly_baselines (
  period      text             not null,          -- 2ª feira da semana, 'YYYY-MM-DD' (ex.: '2026-07-06')
  ticker      text             not null,          -- forma exata de portfolio_stocks.ticker
  price       double precision not null,          -- preço à ABERTURA da 2ª feira (início da semana)
  close_price double precision,                   -- preço ao FECHO de 6ª feira (fim da semana); NULL até 6ª
  captured_at timestamptz      not null default now(),
  primary key (period, ticker)
);
-- Idempotente: se a tabela já existir sem a coluna, acrescenta-a.
alter table public.weekly_baselines add column if not exists close_price double precision;

create index if not exists weekly_baselines_period_idx
  on public.weekly_baselines (period);

-- RLS: leitura pública, escrita negada ao anon/authenticated (só o service_role escreve).
alter table public.weekly_baselines enable row level security;

drop policy if exists "public_read_weekly_baselines" on public.weekly_baselines;
create policy "public_read_weekly_baselines"
  on public.weekly_baselines for select using (true);

revoke all on public.weekly_baselines from anon, authenticated;
grant select on public.weekly_baselines to anon, authenticated;
grant all privileges on public.weekly_baselines to service_role;

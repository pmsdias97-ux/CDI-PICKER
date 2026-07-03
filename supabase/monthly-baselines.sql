-- ============================================================================
-- Baselines mensais — "Campeão do mês" (mini-época mensal)
-- ----------------------------------------------------------------------------
-- No 1º dia útil de cada mês (à abertura US), o cron /api/cron/monthly-baselines
-- grava o preço de CADA ticker em competição para o período 'YYYY-MM'.
--
-- A rentabilidade mensal = média de (preço_atual / baseline_do_mês − 1), espelhada
-- para shorts — a MESMA fórmula do total, só que com o preço de INÍCIO DO MÊS em vez
-- do preço de submissão. É o que torna a mini-época justa ao membro (pondera cada ação
-- por 1/preço-início-do-mês, não por 1/preço-de-submissão).
--
-- 'period' é texto genérico ('YYYY-MM' agora; no futuro 'YYYY-Qn' para trimestral).
-- Leitura PÚBLICA (o leaderboard é calculado no cliente, tal como o ranking); escrita
-- só via service_role (o cron). Idempotente. Corre no Supabase: SQL Editor > Run.
-- ============================================================================

create table if not exists public.monthly_baselines (
  period      text             not null,          -- 'YYYY-MM' (ex.: '2026-08')
  ticker      text             not null,          -- forma exata de portfolio_stocks.ticker
  price       double precision not null,          -- preço à abertura do 1º dia do período
  captured_at timestamptz      not null default now(),
  primary key (period, ticker)
);

create index if not exists monthly_baselines_period_idx
  on public.monthly_baselines (period);

-- RLS: leitura pública, escrita negada ao anon/authenticated (só o service_role escreve).
alter table public.monthly_baselines enable row level security;

drop policy if exists "public_read_monthly_baselines" on public.monthly_baselines;
create policy "public_read_monthly_baselines"
  on public.monthly_baselines for select using (true);

revoke all on public.monthly_baselines from anon, authenticated;
grant select on public.monthly_baselines to anon, authenticated;
grant all privileges on public.monthly_baselines to service_role;

-- Seed do MÊS DE ARRANQUE (julho/2026): o baseline de julho é o próprio baseline da
-- competição (fecho de 30-jun = portfolio_stocks.initial_price da coorte de lançamento).
-- Assim a corrida "Este mês" e o "Campeão do mês" funcionam desde o 1º dia (em julho,
-- rentabilidade-do-mês == total, por definição), e o campeão de julho fica memorizado
-- assim que existir o baseline de agosto. Só a coorte de lançamento (criada antes de 1-jul);
-- entradas tardias são tratadas no cliente (usam o seu próprio preço de entrada). Idempotente.
insert into public.monthly_baselines (period, ticker, price)
select '2026-07', ps.ticker, min(ps.initial_price)
from public.portfolio_stocks ps
join public.portfolios p on p.id = ps.portfolio_id
where p.official = true
  and ps.initial_price > 0
  and p.created_at < '2026-07-01T00:00:00Z'
group by ps.ticker
on conflict (period, ticker) do nothing;

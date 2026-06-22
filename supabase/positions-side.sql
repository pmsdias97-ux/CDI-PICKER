-- ============================================================================
-- Posições long/short por ação
-- ----------------------------------------------------------------------------
-- Cada ação do portefólio passa a ter uma direção: 'long' (default) ou 'short'.
-- Numa short, a rentabilidade é o espelho da ação (cai 10% -> +10%).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.portfolio_stocks
  add column if not exists side text not null default 'long';

-- Garante apenas valores válidos.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portfolio_stocks_side_chk'
  ) then
    alter table public.portfolio_stocks
      add constraint portfolio_stocks_side_chk check (side in ('long','short'));
  end if;
end $$;

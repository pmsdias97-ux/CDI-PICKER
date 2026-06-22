-- ============================================================================
-- Benchmark S&P 500 alinhado no tempo (#2 — correção)
-- ----------------------------------------------------------------------------
-- Guarda o preço do S&P 500 (SPY) NO MOMENTO da submissão, para comparar com o
-- preço ao vivo agora — exatamente o mesmo período do portefólio. Assim o Alpha
-- = rentabilidade do portefólio menos a do SPY no mesmo intervalo.
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.portfolios
  add column if not exists spy_initial_price double precision;

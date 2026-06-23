-- ============================================================================
-- Moeda por ação (para mostrar o símbolo certo: €, $, etc.)
-- ----------------------------------------------------------------------------
-- A rentabilidade é percentual (a moeda cancela), mas o preço deve mostrar o
-- símbolo correto. A moeda vem da cotação no momento da submissão.
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.portfolio_stocks
  add column if not exists currency text default 'USD';

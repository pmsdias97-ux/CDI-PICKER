-- ============================================================================
-- Portefólios oficiais vs demonstração
-- ----------------------------------------------------------------------------
-- official=false  -> portefólio de demonstração (exemplos atuais)
-- official=true   -> participante oficial (novas submissões; competição de 1 jul)
-- As submissões a partir de agora entram como official=true ("em espera" até dia 1).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.portfolios
  add column if not exists official boolean default false;

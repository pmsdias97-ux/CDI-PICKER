-- ============================================================================
-- Arranque oficial da competição
-- ----------------------------------------------------------------------------
-- Flag global: false = modo demonstração (exemplos, novos portefólios em espera);
-- true = competição a decorrer (definida pelo botão "Iniciar competição" no dia 1).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

alter table public.game_settings
  add column if not exists competition_started boolean default false;

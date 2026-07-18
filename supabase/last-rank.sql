-- ============================================================================
-- "Foste ultrapassado no ranking": guarda o último lugar (Ranking Geral) por membro,
-- para o cron /api/cron/rank-notify comparar dia-a-dia e notificar quem desceu. Idempotente.
-- ============================================================================

alter table public.users
  add column if not exists last_rank int;

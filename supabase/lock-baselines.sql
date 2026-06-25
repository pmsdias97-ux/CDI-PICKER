-- Arranque em 2 passos: marca quando os preços de partida foram TRANCADOS no fecho de
-- 30 jun (passo 1). O passo 2 (arrancar / revelar oficiais) recusa enquanto isto for nulo.
-- Aditivo e idempotente.
alter table game_settings add column if not exists baselines_locked_at timestamptz;

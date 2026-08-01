-- ============================================================================
-- Fecho mensal — close_price (mini-época "Campeão do mês")
-- ----------------------------------------------------------------------------
-- Preço de FECHO do último pregão do mês, por ticker. Gravado pelo cron
-- /api/cron/monthly-close no último dia útil do mês (após o fecho US). Simétrico
-- a weekly_baselines.close_price: permite REVELAR o campeão do mês assim que o mês
-- fecha, sem esperar pelo baseline do mês seguinte (que só chega dias 1-5 do mês
-- seguinte). Nulo = mês ainda não fechado. Leitura pública; escrita só service_role.
-- ============================================================================
alter table public.monthly_baselines add column if not exists close_price double precision;

notify pgrst, 'reload schema';

-- ============================================================================
-- Bloqueio por conta para o código de 3 dígitos (anti brute-force)
-- ----------------------------------------------------------------------------
-- Como o PIN tem só 1000 combinações, contamos as falhas POR MEMBRO e bloqueamos
-- a conta ao fim de 5 falhas durante 15 min (independente do IP). A lógica está
-- em app/lib/pinAuth.js (usado por /api/portfolio/recover e /mine).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente. (Aditivo — seguro
-- de correr antes do deploy do código novo.)
-- ============================================================================

alter table public.member_pins
  add column if not exists failed_attempts integer not null default 0,
  add column if not exists locked_until timestamptz;

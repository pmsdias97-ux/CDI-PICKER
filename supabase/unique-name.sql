-- ============================================================================
-- Unicidade do nome (case-insensitive) — fecha a race condition de submissão
-- ----------------------------------------------------------------------------
-- "Um portefólio por nome" passa a ser garantido pela PRÓPRIA base de dados,
-- não só por verificação em código (que tinha uma janela de race condition).
-- Coluna gerada em minúsculas + índice ÚNICO. As rotas comparam por esta coluna
-- com .eq (em vez de .ilike), o que também elimina a injeção de wildcards %/_.
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- (Pré-requisito: não podem existir nomes duplicados — já verificado, 0 duplicados.)
-- ============================================================================

alter table public.users
  add column if not exists telegram_name_lower text
  generated always as (lower(telegram_name)) stored;

create unique index if not exists users_telegram_name_lower_key
  on public.users (telegram_name_lower);

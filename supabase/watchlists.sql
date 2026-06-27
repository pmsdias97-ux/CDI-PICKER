-- ============================================================================
-- Watchlists — listas de tickers guardadas pelo utilizador (aba ATH)
-- ============================================================================
-- Cada utilizador pode ter VÁRIAS listas nomeadas de tickers (ex.: "Tech",
-- "Para vigiar"). Tickers em jsonb (array de strings, ex. ["AAPL","NVDA"]).
-- Segurança (igual ao resto do projeto):
--   * RLS ligado, SEM política de leitura  => anon/authenticated NÃO leem.
--   * Leitura só via rota de servidor autenticada por nome + PIN (verifyMemberPin).
--   * Escrita só por service_role (rotas /api/watchlists/*).
-- ============================================================================

create table if not exists public.watchlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  list_name   text not null,
  tickers     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, list_name)
);

create index if not exists watchlists_user_idx on public.watchlists (user_id);

alter table public.watchlists enable row level security;     -- sem política => anon não lê
revoke all on public.watchlists from anon, authenticated;     -- defesa em profundidade
grant all privileges on public.watchlists to service_role;

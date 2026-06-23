-- ============================================================================
-- Códigos de 3 dígitos por membro (anti-impersonação)
-- ----------------------------------------------------------------------------
-- IMPORTANTE: o PIN NÃO pode ser legível pelo browser (anon), senão qualquer um
-- o lê e impersona. Por isso esta tabela tem RLS ativo SEM política de leitura
-- e o SELECT do anon é revogado — só o service_role (servidor) lê/escreve.
-- O admin vê os PINs através de uma rota protegida (service_role).
-- Corre no Supabase: SQL Editor > New query > Run. Idempotente.
-- ============================================================================

create table if not exists public.member_pins (
  user_id    uuid primary key references public.users(id) on delete cascade,
  pin        text not null,
  updated_at timestamptz not null default now()
);

alter table public.member_pins enable row level security;
-- Sem políticas => anon/authenticated não leem nem escrevem (service_role ignora RLS).

-- Defesa extra: revogar quaisquer privilégios herdados ao anon/authenticated.
revoke all on public.member_pins from anon, authenticated;
grant all privileges on public.member_pins to service_role;

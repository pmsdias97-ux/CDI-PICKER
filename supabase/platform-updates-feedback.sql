-- ============================================================================
-- "Updates e feedbacks" — recap diário da plataforma + feedback dos membros
-- ----------------------------------------------------------------------------
-- platform_updates: 1 linha por dia. draft_lines = assuntos crus dos commits do
--   dia (semente auto, NUNCA público); body = recap escrito pelo admin (público
--   quando status='published').
-- member_feedback: os membros deixam feedback; o TEXTO é público (anónimo), mas o
--   AUTOR só o admin o vê. Por isso ambas as tabelas têm RLS ativo SEM política de
--   leitura anon — TODO o acesso passa por rotas server (service_role), que só
--   devolvem ao público os campos seguros. Idempotente.
-- ============================================================================

-- Updates / recap diário ------------------------------------------------------
create table if not exists public.platform_updates (
  day          date        primary key,
  draft_lines  text[]      not null default '{}',
  body         text,
  status       text        not null default 'draft',  -- 'draft' | 'published'
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists platform_updates_pub_idx
  on public.platform_updates (status, day desc);

alter table public.platform_updates enable row level security;
-- Sem políticas => anon/authenticated não leem nem escrevem (service_role ignora RLS).
revoke all on public.platform_updates from anon, authenticated;
grant all privileges on public.platform_updates to service_role;

-- Feedback dos membros --------------------------------------------------------
create table if not exists public.member_feedback (
  id         bigint      generated always as identity primary key,
  message    text        not null,
  author     text,       -- nome do membro; SÓ o admin o vê (nunca devolvido ao público)
  hidden     boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists member_feedback_pub_idx
  on public.member_feedback (hidden, created_at desc);

alter table public.member_feedback enable row level security;
-- Sem políticas => o autor fica protegido por construção (nenhuma leitura anon direta).
revoke all on public.member_feedback from anon, authenticated;
grant all privileges on public.member_feedback to service_role;

-- ============================================================================
-- Notificações pessoais (in-app). PRIVADAS: sem leitura anon — acesso só via
-- service_role (rotas /api/notifications/*, name+pin -> authOwner). Sem Realtime
-- (o app não tem sessão Supabase-auth p/ filtrar por-utilizador) → o sino faz poll.
-- Gatilhos inserem via helper app/lib/notify.js. Idempotente.
-- ============================================================================

create table if not exists public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade, -- destinatário
  type       text        not null,   -- 'comment' | 'reaction' | 'weekly_win' | 'mention'
  title      text        not null,
  body       text,
  link       text,                    -- token que o cliente mapeia p/ navegação ('mine' | 'ranking' | 'chat')
  actor_name text,                    -- quem despoletou (display)
  read       boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;
-- SEM policy de select p/ anon/authenticated → RLS nega leitura (privado). service_role ignora RLS.
revoke all on public.notifications from anon, authenticated;
grant all privileges on public.notifications to service_role;

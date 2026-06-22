-- ============================================================================
-- RLS policies + grants — Conversas de Investidores / CDI PICKER
-- ----------------------------------------------------------------------------
-- Modelo de segurança:
--   * O browser (chave anon) só pode LER. O ranking é público => SELECT a todos.
--   * Todas as ESCRITAS passam pelos API routes do Next.js, que usam a chave
--     service_role (ignora RLS). Por isso anon NÃO tem políticas nem grants de
--     escrita — defesa em profundidade dupla (sem policy E sem grant).
--
-- Corre tudo no Supabase: SQL Editor > New query > Run. É idempotente.
-- ============================================================================

-- 0) Limpeza de dados de teste (se existirem).
delete from public.users where telegram_name in ('__HACKER__', '__TESTE_SEGURANCA__');

-- 1) Garantir RLS ativo em todas as tabelas.
alter table public.users            enable row level security;
alter table public.portfolios       enable row level security;
alter table public.portfolio_stocks enable row level security;
alter table public.game_settings    enable row level security;

-- 2) APAGAR TODAS as políticas existentes nestas tabelas (incl. permissivas
--    antigas que permitiam escrita ao anon). Recriamos só as de leitura a seguir.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('users','portfolios','portfolio_stocks','game_settings')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 3) Leitura pública (anon + authenticated). Sem políticas de escrita => escrita
--    negada por omissão para anon.
create policy "public_read_users"            on public.users            for select using (true);
create policy "public_read_portfolios"       on public.portfolios       for select using (true);
create policy "public_read_portfolio_stocks" on public.portfolio_stocks for select using (true);
create policy "public_read_game_settings"    on public.game_settings    for select using (true);

-- 4) GRANTs.
grant usage on schema public to anon, authenticated, service_role;

-- service_role: acesso total (escrita só no servidor; ignora RLS).
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- anon/authenticated: SÓ leitura. Revoga qualquer escrita herdada por defeito.
grant  select on all tables in schema public to anon, authenticated;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public grant  select on tables to anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Verificação (opcional): listar políticas que ficaram.
--   select tablename, policyname, cmd from pg_policies where schemaname='public';
-- ----------------------------------------------------------------------------

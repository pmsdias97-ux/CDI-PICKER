-- ============================================================================
-- Hora em que cada notificação foi LIDA (por destinatário). Serve para ordenar a
-- lista "quem leu" no admin por RECÊNCIA (mais recente primeiro). Nulo = lida antes
-- de esta coluna existir (ou ainda não lida). Preenchida em /api/notifications/read.
-- ============================================================================
alter table public.notifications add column if not exists read_at timestamptz;

notify pgrst, 'reload schema';

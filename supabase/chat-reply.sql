-- ============================================================================
-- Chat: responder a uma mensagem (quote). Colunas desnormalizadas (nome + excerto da
-- mensagem citada) para o display e o payload de Realtime não precisarem de join.
-- reply_to aponta à mensagem original (SET NULL se a original for apagada). Idempotente.
-- ============================================================================

alter table public.chat_messages
  add column if not exists reply_to         uuid references public.chat_messages(id) on delete set null,
  add column if not exists reply_to_name    text,
  add column if not exists reply_to_excerpt text;

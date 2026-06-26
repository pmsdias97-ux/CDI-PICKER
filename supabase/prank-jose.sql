-- Flag para ARMAR a piada do "José Pinho" no live (admin liga minutos antes; por defeito off).
-- Aditivo e idempotente.
alter table game_settings add column if not exists prank_jose boolean default false;

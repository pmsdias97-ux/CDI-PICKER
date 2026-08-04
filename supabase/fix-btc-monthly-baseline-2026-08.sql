-- Repõe o baseline mensal de BTC que ficou ausente na captura parcial de agosto/2026.
-- Agosto e a semana de 03-ago partilham a mesma âncora: o fecho de 31-jul (27.81).
-- A fonte é o fecho mensal de julho já congelado, sem escrever um valor literal duplicado.
-- Idempotente: uma segunda execução só atualiza se o preço estiver diferente.
insert into public.monthly_baselines as target (period, ticker, price)
select '2026-08', 'BTC', close_price
from public.monthly_baselines
where period = '2026-07'
  and ticker = 'BTC'
  and close_price > 0
on conflict (period, ticker) do update
set price = excluded.price
where target.price is distinct from excluded.price;

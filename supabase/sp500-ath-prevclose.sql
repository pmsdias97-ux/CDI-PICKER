-- DIÁRIO fiável: guarda também o FECHO ANTERIOR (prev_close) no pipeline sp500_ath.
-- Assim a variação do dia (price/prev_close - 1) vem da MESMA fonte (yfinance/GitHub) que
-- os baselines, em vez do Yahoo/CNBC ao vivo do site — que dá 429/desfasa vários tickers
-- (ex.: META/BABA/MSFT ficavam "—" e o CPRT chegou a mostrar um preço errado).
alter table sp500_ath add column if not exists prev_close numeric;

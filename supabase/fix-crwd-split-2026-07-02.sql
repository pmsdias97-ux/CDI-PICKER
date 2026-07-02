-- Correção de baseline da CRWD após split 4-for-1 (efetivo 2026-07-02).
--
-- O baseline foi trancado no fecho de 30-jun em escala PRÉ-split (763.14). O yfinance
-- reajusta os preços ao vivo para a escala PÓS-split (~193), criando uma perda fantasma
-- de -74.69% para os 3 membros com CRWD (na tabela detalhe, no total do ranking e no widget).
--
-- Novo baseline justo = 763.14 / 4 = 190.79 (= fecho ajustado de 30-jun = sp500_ath.prev_close).
-- Assim a rentabilidade desde a submissão fica correta: 193.18 / 190.79 - 1 ~= +1.25%.
--
-- Guarda de idempotência: só atualiza linhas ainda na escala pré-split (763.14),
-- por isso correr duas vezes não volta a dividir.
UPDATE portfolio_stocks
SET initial_price = 190.79
WHERE upper(ticker) = 'CRWD' AND initial_price = 763.14;

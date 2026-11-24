#!/usr/bin/env python3
"""Recolhe o PREÇO e o FECHO ANTERIOR das ações que os membros têm (≈165 símbolos) e envia para o
CDI-PICKER (POST /api/cron/ath, Bearer CRON_SECRET → upsert em sp500_ath). É a fonte de preços do jogo.

Modos:
  --mode prices / positions   preço atual + fecho anterior (2 pedidos bulk ao Yahoo). "positions" corre a cada
                              ~10 min na sessão; "prices" corre 3×/dia em horas certas (dispatch do Vercel).
  --mode splits   (horário)   deteta splits recentes das ações dos membros (Ticker.splits) e faz POST a
                              /api/cron/splits, que corrige os baselines de forma justa.

(O antigo modo "full" — máximos históricos, market cap e o S&P 500 inteiro, para a aba ATH — foi removido.)

Corre fora do Vercel (GitHub Actions) porque o Yahoo bloqueia o IP do site a esta escala.

Env: CRON_SECRET (obrigatório), ATH_INGEST_URL (default = produção),
     SUPABASE_URL + SUPABASE_ANON_KEY (leitura das ações dos membros).
"""
import argparse
import datetime as dt
import os
import socket
import sys
import time
from zoneinfo import ZoneInfo

import requests
import yfinance as yf

# Rede: nenhuma chamada (download/fast_info/.info) pode pendurar para sempre — o Yahoo às vezes
# limita o IP e deixa a ligação aberta. Um timeout global garante que cada chamada desiste.
socket.setdefaulttimeout(45)

INGEST_URL = os.environ.get("ATH_INGEST_URL", "https://cdi-picker.vercel.app/api/cron/ath")
SPLITS_URL = INGEST_URL.replace("/api/cron/ath", "/api/cron/splits")
CRON_SECRET = os.environ.get("CRON_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
BATCH = 100  # yf.download é mais feliz em lotes ~100

# GUARDA ANTI-STALENESS. O Yahoo às vezes serve barras VELHAS aos runners do GitHub (aconteceu a
# 15-jul: a corrida da manhã trouxe fechos de 2ª feira numa 4ª feira → variações erradas). Antes de
# escrever preços, comparamos a data da barra mais recente com o ÚLTIMO pregão US já fechado; se for
# anterior, NÃO escrevemos (evita clobber de dados bons com dados velhos). Feriados de fecho total US.
US_HOLIDAYS = {
    "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
}
def _is_trading_day(d):  # d: datetime.date — dia útil (0=2ª…4=6ª) e não-feriado
    return d.weekday() < 5 and d.isoformat() not in US_HOLIDAYS

def expected_last_session(now=None):
    """Data (YYYY-MM-DD, ET) do ÚLTIMO pregão US já FECHADO. Barra mais recente < isto ⇒ feed velho."""
    et = (now or dt.datetime.now(dt.timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    d = et.date()
    # Hoje só conta depois do fecho (16:00 ET); senão o último pregão fechado é (pelo menos) ontem.
    if not (_is_trading_day(d) and et.hour >= 16):
        d -= dt.timedelta(days=1)
    while not _is_trading_day(d):
        d -= dt.timedelta(days=1)
    return d.isoformat()

def _feed_fresh(max_bar_date, label):
    """True se a barra mais recente do download não está atrasada face ao último pregão fechado."""
    if max_bar_date is None:
        print(f"[ath] {label}: sem barras — nada a escrever."); return False
    exp = expected_last_session()
    if max_bar_date < exp:
        print(f"[ath] {label}: FEED DESATUALIZADO — barra {max_bar_date} < último pregão {exp}. "
              f"NÃO escreve (evita clobber com dados velhos)."); return False
    return True

def _us_market_open_now(now=None):
    """Mercado US aberto AGORA (dia de pregão + 09:30–16:00 ET). Serve para decidir se a CRIPTO (ex.: BTC = ETF
    Grayscale) é atualizada no sp500_ath — fora de horas fica congelada, como as ações (senão corria 24/7 e
    mexia o ranking)."""
    et = (now or dt.datetime.now(dt.timezone.utc)).astimezone(ZoneInfo("America/New_York"))
    if not _is_trading_day(et.date()):
        return False
    mins = et.hour * 60 + et.minute
    return 9 * 60 + 30 <= mins < 16 * 60  # 09:30–16:00 ET

# Cripto que os membros podem ter (espelha app/lib/crypto.js). No jogo tipicamente só a BTC (ETF Grayscale ~$28,
# que o yf.download não resolve → vai pelo chart-v8). Fica no sp500_ath para CONGELAR fora de horas.
CRYPTO = {"BTC", "ETH", "USDT", "BNB", "SOL", "XRP", "USDC", "ADA", "DOGE", "TRX", "AVAX", "SHIB", "LINK", "DOT",
          "BCH", "NEAR", "LTC", "UNI", "ICP", "ETC", "XLM", "ATOM", "XMR", "APT", "FIL", "ARB", "OP", "HBAR",
          "VET", "MKR", "AAVE", "ALGO", "SUI", "PEPE"}
def _is_crypto(t):
    return str(t or "").upper().replace("-USD", "").strip() in CRYPTO


# Tickers que mudaram de símbolo: o jogo continua a chamar-lhes pelo antigo (portfolio_stocks, baselines, sp500_ath),
# mas é com o símbolo ATUAL que se pede ao Yahoo. ATLN → CIRC (Circle8 Group, ~3-set-2026): o Yahoo deixou de ter
# dados em ATLN e o preço ficou congelado meses. Mantém em sincronia com app/lib/tickerAlias.js.
ALIAS = {"ATLN": "CIRC"}


def _r(x):
    """Arredonda um preço: 2 casas (≥ 1 USD) ou 4 casas (penny stocks — 0,165 não pode virar 0,17)."""
    x = float(x)
    return round(x, 2 if abs(x) >= 1 else 4)


def _y(sym):
    """Símbolo a pedir ao Yahoo para um ticker do jogo."""
    s = str(sym).upper()
    return ALIAS.get(s, s)


def yf_symbol(s):
    return _y(str(s).replace(".", "-").strip().upper())


def _prev_session(d):
    """Pregão US imediatamente anterior a `d` (datetime.date)."""
    d = d - dt.timedelta(days=1)
    while not _is_trading_day(d):
        d -= dt.timedelta(days=1)
    return d


def _chart_prev_close(symbol, last_date):
    """Fecho do pregão imediatamente anterior a `last_date` (YYYY-MM-DD) via Yahoo chart v8, com a DATA
    da barra verificada. None se a barra desse pregão não existir (nunca devolve um fecho mais antigo)."""
    try:
        want = _prev_session(dt.date.fromisoformat(last_date)).isoformat()
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{_y(symbol)}",
                         params={"range": "10d", "interval": "1d"},
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        res = (r.json().get("chart", {}).get("result") or [{}])[0]
        off = (res.get("meta") or {}).get("gmtoffset") or 0
        closes = (((res.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
        for ts, c in zip(res.get("timestamp") or [], closes):
            if c and dt.datetime.fromtimestamp(ts + off, dt.timezone.utc).date().isoformat() == want:
                return _r(c)
    except Exception:
        pass
    return None


def post_rows_uniform(rows):
    """O upsert em lote do PostgREST mete NULL nas chaves em falta de algumas linhas → cada POST só leva
    linhas com o MESMO conjunto de chaves (ver rota /api/cron/ath)."""
    groups = {}
    for r in rows:
        groups.setdefault(tuple(sorted(r)), []).append(r)
    for g in groups.values():
        post_rows(g)


def post_rows(rows):
    if not rows:
        print("[ath] nada para enviar")
        return
    for i in range(0, len(rows), 400):
        chunk = rows[i:i + 400]
        last_err = None
        for attempt in range(3):  # retry a 5xx/timeout/rede transitórios antes de rebentar o run
            try:
                r = requests.post(
                    INGEST_URL,
                    json={"rows": chunk},
                    headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
                    timeout=60,
                )
                print(f"[ath] POST {i}-{i + len(chunk)} -> {r.status_code} {r.text[:160]}")
                r.raise_for_status()
                last_err = None
                break
            except Exception as e:
                last_err = e
                print(f"[ath] POST {i} tentativa {attempt + 1}/3 falhou: {e}")
                time.sleep(3 * (attempt + 1))
        if last_err:
            raise last_err


def _chart_price(symbol):
    """Preço atual via Yahoo chart v8 — fallback p/ tickers SEM barras no download (ex.: ATLN, uma
    micro-cap que o yfinance dá como 'delisted' no histórico mas ainda tem cotação em tempo real).
    Só o preço (não há fecho anterior fiável → sem variação diária)."""
    try:
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{_y(symbol)}",
                         params={"range": "1d", "interval": "1d"},
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
        meta = (r.json().get("chart", {}).get("result") or [{}])[0].get("meta", {}) or {}
        p = meta.get("regularMarketPrice")
        return _r(p) if p and float(p) > 0 else None
    except Exception:
        return None


def _fill_missing_via_chart(missing, prices):
    """Para os tickers de MEMBROS que o download não trouxe, tenta o preço pelo chart v8 (teto de
    segurança p/ não martelar o Yahoo). Preenche `prices` in-place; sem prev_close → sem diário."""
    mkt_open = _us_market_open_now()
    for sym in missing[:20]:
        # Cripto (ex.: BTC): só atualiza com o MERCADO ABERTO → congela fora de horas como as ações (as ações
        # já congelam porque o sp500_ath fica stale; a cripto correria 24/7 e mexia o ranking).
        if _is_crypto(sym) and not mkt_open:
            continue
        p = _chart_price(sym)
        if p:
            prices[sym] = p
            print(f"[ath] chart-fallback {sym} = {p}")


def _dl_prices(symbols):
    """Preço atual + fecho anterior (period=5d) para uma lista de símbolos, em lotes de BATCH.
    Devolve (prices, prevs, max_bar_date) — max_bar_date = data da barra mais recente (p/ a guarda)."""
    prices, prevs = {}, {}
    max_bar_date = None
    for i in range(0, len(symbols), BATCH):
        batch = symbols[i:i + BATCH]
        ybatch = [_y(x) for x in batch]  # símbolos a pedir ao Yahoo (ATLN → CIRC)
        try:
            # period="5d": últimos pregões → o preço (iloc[-1]) E o fecho anterior (iloc[-2]).
            # 5d (não 2d) garante ≥2 fechos mesmo em ações de negociação esparsa (ex.: penny
            # stocks como ATLN) ou com feriados pelo meio — senão o prev_close ficava null.
            df = yf.download(ybatch, period="5d", interval="1d", auto_adjust=False,
                             threads=True, progress=False, group_by="ticker")
        except Exception as e:
            print(f"[ath] download(2d) erro {i}: {e}")
            continue
        for sym in batch:
            try:
                sub = df[_y(sym)] if len(batch) > 1 else df
                c = sub["Close"].dropna()
                if not c.empty:
                    prices[sym] = float(c.iloc[-1])
                    d = c.index[-1].date().isoformat()  # data da barra mais recente deste ticker
                    if max_bar_date is None or d > max_bar_date:
                        max_bar_date = d
                    if len(c) >= 2:
                        prevs[sym] = float(c.iloc[-2])
                        # O fecho anterior TEM de ser o do pregão imediatamente anterior à última barra. Se o feed
                        # perdeu essa barra (SNDK a 23-nov: faltava 6ª → iloc[-2] era 5ª, 94.39 em vez de 79.24 →
                        # diário −4% em vez de +14%), tenta o chart v8; sem confirmação → None (o site vai ao vivo).
                        if c.index[-2].date() != _prev_session(c.index[-1].date()):
                            fix = _chart_prev_close(sym, d)
                            print(f"[ath] {sym}: fecho anterior do feed é de {c.index[-2].date()} (≠ pregão anterior a {d}) "
                                  f"→ chart: {fix}")
                            prevs[sym] = fix  # None = sem fecho anterior fiável
            except Exception:
                continue
        time.sleep(1)
    return prices, prevs, max_bar_date


def table_symbols():
    """Símbolos já presentes em sp500_ath (anon). Servem para casar a FORMA do ticker: o S&P guarda BRK-B,
    as europeias guardam RMS.PA — usa-se a forma que já existe na tabela."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        return set()
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/sp500_ath?select=symbol&limit=2000",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=30,
    )
    r.raise_for_status()
    return {row["symbol"] for row in r.json()}


def member_symbols():
    """Símbolos (na forma guardada em sp500_ath) das ações que os membros TÊM. É o ÚNICO universo do pipeline:
    preços e fecho anterior só para estas (o resto do S&P já não é recolhido)."""
    known = table_symbols()
    out, seen = [], set()
    for t in held_tickers():
        cands = (t, t.replace(".", "-"))
        sym = next((c for c in cands if c in known), None)
        if sym is None:  # ticker novo: sufixo de 1 letra = classe de ações (BRK.B → BRK-B); mais longo = bolsa (RMS.PA)
            head, _, tail = t.rpartition(".")
            sym = t.replace(".", "-") if (head and len(tail) == 1) else t
        if sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def _price_rows(prices, prevs):
    rows = []
    for sym, p in prices.items():
        if not p:
            continue
        row = {"symbol": sym, "price": _r(p)}
        pc = prevs.get(sym)
        if pc:  # só envia prev_close quando o temos (senão não mexe no valor guardado)
            row["prev_close"] = _r(pc)
        elif sym in prevs:  # fecho anterior desmentido pela guarda → limpa o valor velho (o site calcula ao vivo)
            row["prev_close"] = None
        rows.append(row)
    return rows


def fetch_prices():
    """Preço atual + fecho anterior das ações dos MEMBROS (≈165 símbolos, 2 pedidos bulk ao Yahoo) → POST
    /api/cron/ath. Corre a cada ~10 min na sessão (modo positions) e 3×/dia pontual (modo prices)."""
    # Só em dias de PREGÃO US: exclui feriados (os fins de semana já ficam de fora pelo cron "1-5").
    _et = dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo("America/New_York")).date()
    if not _is_trading_day(_et):
        print(f"[ath] prices: {_et} não é dia de pregão US (fim de semana/feriado) — nada a fazer."); return
    symbols = member_symbols()
    if not symbols:
        print("[ath] prices: sem tickers de membros — nada a fazer."); return
    stocks = [s for s in symbols if not _is_crypto(s)]
    print(f"[ath] prices: {len(symbols)} símbolos (membros)")

    if stocks:
        p, pv, mx = _dl_prices(stocks)
        if _feed_fresh(mx, "prices (membros)"):
            _fill_missing_via_chart([s for s in stocks if s not in p], p)  # ex.: ATLN (sem barras)
            rows = _price_rows(p, pv)
            print(f"[ath] prices: {len(rows)} linhas -> POST")
            post_rows_uniform(rows)

    # CRIPTO dos membros (ex.: BTC = ETF Grayscale que o yf.download não resolve): via chart-v8 (mesma fonte do app),
    # SÓ com o mercado aberto → entra no sp500_ath e depois CONGELA fora de horas como as ações (senão corria 24/7 e
    # mexia o ranking). NÃO-fatal.
    try:
        crypto_held = [t for t in symbols if _is_crypto(t)]
        if crypto_held and _us_market_open_now():
            cp = {}
            _fill_missing_via_chart(crypto_held, cp)
            if cp:
                rows = _price_rows(cp, {})
                print(f"[ath] prices cripto (chart, mercado aberto): {len(rows)} linha(s) -> POST")
                post_rows(rows)
    except Exception as e:
        print(f"[ath] prices cripto falhou (não-fatal): {e}")


def held_tickers():
    """Tickers que os membros TÊM (portfolio_stocks, anon-legível) — para vigiar splits."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        return []
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/portfolio_stocks?select=ticker",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=30,
    )
    r.raise_for_status()
    out, seen = [], set()
    for row in r.json():
        t = str(row.get("ticker") or "").upper().strip()
        # exclui futuros/commodities ("=") que penduram o yfinance; cripto não faz splits.
        if t and "=" not in t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def recent_splits(tickers, days=45):
    """Splits das últimas `days` para os tickers dados, via Ticker.splits (fiável no dia
    efetivo — ao contrário da coluna 'Stock Splits' do download, que só aparece quando já
    existe a barra de preço do dia). Devolve [{symbol, date, factor}] com o ticker ORIGINAL
    (como está no portfolio_stocks) para o endpoint casar."""
    import datetime as _dt
    cutoff = (_dt.datetime.utcnow().date() - _dt.timedelta(days=days)).isoformat()
    out = []
    for t in tickers:
        try:
            sp = yf.Ticker(yf_symbol(t)).splits
        except Exception:
            continue
        if sp is None or len(sp) == 0:
            continue
        for ts, val in sp.items():
            try:
                f = float(val)
                d = ts.strftime("%Y-%m-%d")
            except Exception:
                continue
            if f and f > 0 and d >= cutoff:
                out.append({"symbol": t, "date": d, "factor": round(f, 6)})
    return out


def post_splits(splits):
    if not splits:
        print("[splits] nenhum split recente a enviar")
        return
    r = requests.post(
        SPLITS_URL,
        json={"splits": splits},
        headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
        timeout=60,
    )
    print(f"[splits] POST {len(splits)} -> {r.status_code} {r.text[:300]}")
    r.raise_for_status()


def fetch_splits():
    tickers = held_tickers()
    print(f"[splits] {len(tickers)} tickers de membros a vigiar")
    splits = recent_splits(tickers)
    print(f"[splits] {len(splits)} split(s) recente(s): {splits}")
    post_splits(splits)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["prices", "positions", "splits"], default="prices")
    args = ap.parse_args()
    if not CRON_SECRET:
        sys.exit("CRON_SECRET em falta")
    {"prices": fetch_prices, "positions": fetch_prices, "splits": fetch_splits}[args.mode]()

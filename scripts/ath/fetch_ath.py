#!/usr/bin/env python3
"""Recolhe o ATH (máximo histórico) + preço + marketcap do S&P 500 e envia para o
CDI-PICKER (POST /api/cron/ath, Bearer CRON_SECRET → upsert em sp500_ath).

Três modos:
  --mode full     (diário)  ATH (max High de toda a história) + nome + preço + marketcap + shares
  --mode prices   (hora a hora) preço atual (bulk) + marketcap (shares lidas do site)
  --mode splits   (horário) deteta splits recentes das ações dos membros (Ticker.splits) e
                  faz POST a /api/cron/splits, que corrige os baselines de forma justa.

Corre fora do Vercel (GitHub Actions) porque o Yahoo bloqueia o IP do site a esta escala.

Env: CRON_SECRET (obrigatório), ATH_INGEST_URL (default = produção),
     SUPABASE_URL + SUPABASE_ANON_KEY (para o modo prices ler as shares).
"""
import argparse
import io
import os
import signal
import socket
import sys
import time

import pandas as pd
import requests
import yfinance as yf

# Rede: nenhuma chamada (download/fast_info/.info) pode pendurar para sempre — o Yahoo às vezes
# limita o IP e deixa a ligação aberta. Um timeout global garante que cada chamada desiste.
socket.setdefaulttimeout(45)

INGEST_URL = os.environ.get("ATH_INGEST_URL", "https://cdi-picker.vercel.app/api/cron/ath")
EXTRA_URL = INGEST_URL.replace("/api/cron/ath", "/api/cron/extra-tickers")
SPLITS_URL = INGEST_URL.replace("/api/cron/ath", "/api/cron/splits")
CRON_SECRET = os.environ.get("CRON_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
BATCH = 100  # yf.download é mais feliz em lotes ~100
ENRICH_BUDGET_S = 300  # teto DURO (SIGALRM) p/ a fase de marketcap/nome — evita pendurar se o Yahoo limitar


def yf_symbol(s):
    return str(s).replace(".", "-").strip().upper()


def constituents():
    """S&P 500 (symbol, name) via Wikipédia (com User-Agent de browser; sem ele dá 403)."""
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    resp = requests.get(url, headers={"User-Agent": ua}, timeout=30)
    resp.raise_for_status()
    df = pd.read_html(io.StringIO(resp.text))[0]
    out = []
    for _, row in df.iterrows():
        sym = yf_symbol(row["Symbol"])
        name = str(row["Security"]).strip()
        if sym:
            out.append((sym, name))
    return out


def _iso_utc(ts):
    try:
        ts = ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")
        return ts.isoformat()
    except Exception:
        return None


def fi_get(fi, *keys):
    """Acesso tolerante ao fast_info (suporta chave [] e atributo, vários nomes)."""
    for k in keys:
        try:
            v = fi[k]
            if v is not None:
                return v
        except Exception:
            pass
        try:
            v = getattr(fi, k)
            if v is not None:
                return v
        except Exception:
            pass
    return None


def post_rows(rows):
    if not rows:
        print("[ath] nada para enviar")
        return
    for i in range(0, len(rows), 400):
        chunk = rows[i:i + 400]
        r = requests.post(
            INGEST_URL,
            json={"rows": chunk},
            headers={"Authorization": f"Bearer {CRON_SECRET}", "Content-Type": "application/json"},
            timeout=60,
        )
        print(f"[ath] POST {i}-{i + len(chunk)} -> {r.status_code} {r.text[:160]}")
        r.raise_for_status()


def compute_rows(symbols, names, in_sp500):
    """ATH (max High de toda a história) + preço + marketcap/shares para uma lista de símbolos."""
    info = {}  # symbol -> {ath, ath_ts, price}  (tudo do histórico → fiável)
    for i in range(0, len(symbols), BATCH):
        batch = symbols[i:i + BATCH]
        try:
            df = yf.download(batch, period="max", interval="1d", auto_adjust=False,
                             threads=True, progress=False, group_by="ticker")
        except Exception as e:
            print(f"[ath] download(max) erro {i}: {e}")
            continue
        for sym in batch:
            try:
                sub = df[sym] if len(batch) > 1 else df
                high = sub["High"].dropna() if "High" in sub.columns else sub["Close"].dropna()
                close = sub["Close"].dropna()
                if high.empty or close.empty:
                    continue
                info[sym] = {"ath": round(float(high.max()), 2),
                             "ath_ts": _iso_utc(high.idxmax()),
                             "price": round(float(close.iloc[-1]), 2),
                             # fecho ANTERIOR (para a variação do dia = price/prev_close - 1)
                             "prev_close": round(float(close.iloc[-2]), 2) if len(close) >= 2 else None}
            except Exception:
                continue
        print(f"[ath] download {min(i + BATCH, len(symbols))}/{len(symbols)} (acumulado {len(info)})")
        time.sleep(1)

    # marketcap + shares via fast_info (best-effort). Nome: S&P vem da Wikipédia; extras via .info.
    # Teto DURO via SIGALRM: mesmo que UMA chamada do yfinance fique pendurada (Yahoo a limitar),
    # o alarme interrompe-a e seguimos com o que já temos (ATH/preço já garantidos pela fase 1).
    enriched = {}

    def _on_alarm(signum, frame):
        raise TimeoutError("enrich budget")

    prev = signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(ENRICH_BUDGET_S)
    try:
        for sym in info:
            mcap = shares = None
            nm = names.get(sym)
            try:
                tk = yf.Ticker(sym)
                fi = tk.fast_info
                mcap = fi_get(fi, "market_cap", "marketCap")
                shares = fi_get(fi, "shares", "sharesOutstanding", "implied_shares_outstanding")
                if not nm:
                    try:
                        inf = tk.info
                        nm = inf.get("shortName") or inf.get("longName")
                    except TimeoutError:
                        raise
                    except Exception:
                        pass
            except TimeoutError:
                print(f"[ath] enriquecimento estourou o teto ({ENRICH_BUDGET_S}s) — resto sem marketcap/nome")
                break
            except Exception:
                pass
            enriched[sym] = (nm, mcap, shares)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, prev)

    rows = []
    for sym, d in info.items():
        nm, mcap, shares = enriched.get(sym, (names.get(sym), None, None))
        rows.append({
            "symbol": sym, "name": nm or sym, "price": d["price"],
            "prev_close": d.get("prev_close"),
            "marketcap": float(mcap) if mcap else None,
            "shares": float(shares) if shares else None,
            "ath": d["ath"], "ath_ts": d["ath_ts"], "in_sp500": in_sp500,
        })
    return rows


def extra_tickers(sp_set):
    """Tickers que os membros têm/vigiam (endpoint protegido), menos os já S&P."""
    try:
        r = requests.get(EXTRA_URL, headers={"Authorization": f"Bearer {CRON_SECRET}"}, timeout=30)
        r.raise_for_status()
        raw = r.json().get("tickers", [])
    except Exception as e:
        print(f"[ath] extra-tickers erro: {e}")
        return []
    # Mantém o ORIGINAL (ponto p/ europeias, ex. RMS.PA — o yfinance precisa do ponto);
    # deduplica vs S&P comparando na forma normalizada (ponto→traço).
    sp_norm = {s.replace(".", "-") for s in sp_set}
    out = []
    seen = set()
    for t in raw:
        s = str(t).upper().strip()
        if not s:
            continue
        n = s.replace(".", "-")
        if n in sp_norm or n in seen:
            continue
        seen.add(n)
        out.append(s)
    return out


def fetch_full():
    pairs = constituents()
    names = {s: n for s, n in pairs}
    symbols = [s for s, _ in pairs]
    print(f"[ath] full: {len(symbols)} símbolos S&P")
    rows = compute_rows(symbols, names, True)

    extra = extra_tickers(set(symbols))
    if extra:
        print(f"[ath] extras: {len(extra)} símbolos (watchlists/portefólios)")
        rows += compute_rows(extra, {}, False)

    with_cap = sum(1 for r in rows if r["marketcap"])
    print(f"[ath] full: {len(rows)} linhas (com marketcap: {with_cap})")
    post_rows(rows)


def site_shares():
    """{symbol: shares} a partir do Supabase (anon)."""
    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        return {}
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/sp500_ath?select=symbol,shares",
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
        timeout=30,
    )
    r.raise_for_status()
    return {row["symbol"]: row.get("shares") for row in r.json()}


def _dl_prices(symbols):
    """Preço atual + fecho anterior (period=2d) para uma lista de símbolos, em lotes de BATCH.
    Devolve (prices, prevs)."""
    prices, prevs = {}, {}
    for i in range(0, len(symbols), BATCH):
        batch = symbols[i:i + BATCH]
        try:
            # period="5d": últimos pregões → o preço (iloc[-1]) E o fecho anterior (iloc[-2]).
            # 5d (não 2d) garante ≥2 fechos mesmo em ações de negociação esparsa (ex.: penny
            # stocks como ATLN) ou com feriados pelo meio — senão o prev_close ficava null.
            df = yf.download(batch, period="5d", interval="1d", auto_adjust=False,
                             threads=True, progress=False, group_by="ticker")
        except Exception as e:
            print(f"[ath] download(2d) erro {i}: {e}")
            continue
        for sym in batch:
            try:
                sub = df[sym] if len(batch) > 1 else df
                c = sub["Close"].dropna()
                if not c.empty:
                    prices[sym] = float(c.iloc[-1])
                    if len(c) >= 2:
                        prevs[sym] = float(c.iloc[-2])
            except Exception:
                continue
        time.sleep(1)
    return prices, prevs


def _price_rows(prices, prevs, shares, have_shares):
    rows = []
    for sym, p in prices.items():
        if not p:
            continue
        row = {"symbol": sym, "price": round(p, 2)}
        pc = prevs.get(sym)
        if pc:  # só envia prev_close quando o temos (senão não mexe no valor guardado)
            row["prev_close"] = round(pc, 2)
        if have_shares:  # só atualiza marketcap se soubermos as shares (senão não lhe toca)
            sh = shares.get(sym)
            row["marketcap"] = round(sh * p) if sh else None
        rows.append(row)
    return rows


def fetch_prices():
    shares = site_shares()
    symbols = list(shares.keys()) or [s for s, _ in constituents()]
    have_shares = bool(shares)
    print(f"[ath] prices: {len(symbols)} símbolos")

    # PASSAGEM RÁPIDA: primeiro só os tickers que os MEMBROS têm, e POST logo — assim as POSIÇÕES
    # atualizam no site poucos segundos após a abertura, sem esperar pelo resto do S&P.
    held = {t.replace(".", "-") for t in held_tickers()}  # normaliza p/ casar com os símbolos (traço)
    fast = [s for s in symbols if s.replace(".", "-") in held]
    fast_set = set(fast)
    rest = [s for s in symbols if s not in fast_set]

    if fast:
        print(f"[ath] prices passagem 1 (membros): {len(fast)} símbolos")
        p, pv = _dl_prices(fast)
        rows = _price_rows(p, pv, shares, have_shares)
        print(f"[ath] prices passagem 1: {len(rows)} linhas -> POST")
        post_rows(rows)

    # PASSAGEM 2: o resto do S&P (para a aba ATH / % abaixo). Se não houve lista de membros,
    # `rest` == todos os símbolos → comporta-se como a passagem única de antes.
    print(f"[ath] prices passagem 2 (resto): {len(rest)} símbolos")
    p, pv = _dl_prices(rest)
    rows = _price_rows(p, pv, shares, have_shares)
    print(f"[ath] prices passagem 2: {len(rows)} linhas (marketcap: {have_shares}) -> POST")
    post_rows(rows)


def fetch_positions():
    """Passagem LEVE (30 em 30 min): SÓ os tickers que os membros têm — preço + fecho anterior,
    em ~2 pedidos bulk ao Yahoo. Não toca no resto do S&P (aba ATH), que fica na corrida horária."""
    shares = site_shares()
    symbols = list(shares.keys())
    have_shares = bool(shares)
    if not symbols:
        print("[ath] positions: site_shares vazio — nada a fazer."); return
    held = {t.replace(".", "-") for t in held_tickers()}
    fast = [s for s in symbols if s.replace(".", "-") in held]
    if not fast:
        print("[ath] positions: sem tickers de membros — nada a fazer."); return
    print(f"[ath] positions: {len(fast)} símbolos (membros)")
    p, pv = _dl_prices(fast)
    rows = _price_rows(p, pv, shares, have_shares)
    print(f"[ath] positions: {len(rows)} linhas (marketcap: {have_shares}) -> POST")
    post_rows(rows)


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
    ap.add_argument("--mode", choices=["full", "prices", "positions", "splits"], default="full")
    args = ap.parse_args()
    if not CRON_SECRET:
        sys.exit("CRON_SECRET em falta")
    {"full": fetch_full, "prices": fetch_prices, "positions": fetch_positions, "splits": fetch_splits}[args.mode]()

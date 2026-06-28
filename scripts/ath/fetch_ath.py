#!/usr/bin/env python3
"""Recolhe o ATH (máximo histórico) + preço + marketcap do S&P 500 e envia para o
CDI-PICKER (POST /api/cron/ath, Bearer CRON_SECRET → upsert em sp500_ath).

Dois modos:
  --mode full     (diário)  ATH (max High de toda a história) + nome + preço + marketcap + shares
  --mode prices   (hora a hora) preço atual (bulk) + marketcap (shares lidas do site)

Corre fora do Vercel (GitHub Actions) porque o Yahoo bloqueia o IP do site a esta escala.

Env: CRON_SECRET (obrigatório), ATH_INGEST_URL (default = produção),
     SUPABASE_URL + SUPABASE_ANON_KEY (para o modo prices ler as shares).
"""
import argparse
import io
import os
import sys
import time

import pandas as pd
import requests
import yfinance as yf

INGEST_URL = os.environ.get("ATH_INGEST_URL", "https://cdi-picker.vercel.app/api/cron/ath")
EXTRA_URL = INGEST_URL.replace("/api/cron/ath", "/api/cron/extra-tickers")
CRON_SECRET = os.environ.get("CRON_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
BATCH = 100  # yf.download é mais feliz em lotes ~100
ENRICH_BUDGET_S = 420  # teto p/ a fase de marketcap/nome (fast_info/.info) — evita pendurar se o Yahoo limitar


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
                             "price": round(float(close.iloc[-1]), 2)}
            except Exception:
                continue
        print(f"[ath] download {min(i + BATCH, len(symbols))}/{len(symbols)} (acumulado {len(info)})")
        time.sleep(1)

    # marketcap + shares via fast_info (best-effort). Nome: S&P vem da Wikipédia; extras via .info.
    # Orçamento de tempo: se o Yahoo limitar e isto arrastar, paramos de enriquecer e enviamos o
    # que temos (ATH/preço já estão garantidos pela fase 1) — evita o run pendurar horas.
    rows = []
    deadline = time.time() + ENRICH_BUDGET_S
    enrich = True
    for sym, d in info.items():
        mcap = shares = None
        nm = names.get(sym)
        if enrich and time.time() > deadline:
            enrich = False
            print(f"[ath] orçamento de enriquecimento esgotado ({ENRICH_BUDGET_S}s) — resto sem marketcap/nome")
        if enrich:
            try:
                tk = yf.Ticker(sym)
                fi = tk.fast_info
                mcap = fi_get(fi, "market_cap", "marketCap")
                shares = fi_get(fi, "shares", "sharesOutstanding", "implied_shares_outstanding")
                if not nm:
                    try:
                        inf = tk.info
                        nm = inf.get("shortName") or inf.get("longName")
                    except Exception:
                        pass
            except Exception:
                pass
        rows.append({
            "symbol": sym, "name": nm or sym, "price": d["price"],
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


def fetch_prices():
    shares = site_shares()
    symbols = list(shares.keys()) or [s for s, _ in constituents()]
    print(f"[ath] prices: {len(symbols)} símbolos")

    prices = {}
    for i in range(0, len(symbols), BATCH):
        batch = symbols[i:i + BATCH]
        try:
            df = yf.download(batch, period="1d", interval="1d", auto_adjust=False,
                             threads=True, progress=False, group_by="ticker")
        except Exception as e:
            print(f"[ath] download(1d) erro {i}: {e}")
            continue
        for sym in batch:
            try:
                sub = df[sym] if len(batch) > 1 else df
                c = sub["Close"].dropna()
                if not c.empty:
                    prices[sym] = float(c.iloc[-1])
            except Exception:
                continue
        time.sleep(1)

    have_shares = bool(shares)
    rows = []
    for sym, p in prices.items():
        if not p:
            continue
        row = {"symbol": sym, "price": round(p, 2)}
        if have_shares:  # só atualiza marketcap se soubermos as shares (senão não lhe toca)
            sh = shares.get(sym)
            row["marketcap"] = round(sh * p) if sh else None
        rows.append(row)
    print(f"[ath] prices: {len(rows)} linhas (marketcap atualizado: {have_shares})")
    post_rows(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["full", "prices"], default="full")
    args = ap.parse_args()
    if not CRON_SECRET:
        sys.exit("CRON_SECRET em falta")
    (fetch_full if args.mode == "full" else fetch_prices)()

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
import os
import sys
import time

import pandas as pd
import requests
import yfinance as yf

INGEST_URL = os.environ.get("ATH_INGEST_URL", "https://cdi-picker.vercel.app/api/cron/ath")
CRON_SECRET = os.environ.get("CRON_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
BATCH = 100  # yf.download é mais feliz em lotes ~100


def yf_symbol(s):
    return str(s).replace(".", "-").strip().upper()


def constituents():
    """S&P 500 (symbol, name) via Wikipédia."""
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    df = pd.read_html(url)[0]
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


def fetch_full():
    pairs = constituents()
    names = {s: n for s, n in pairs}
    symbols = [s for s, _ in pairs]
    print(f"[ath] full: {len(symbols)} símbolos")

    ath = {}  # symbol -> (ath, ath_ts_iso)
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
                series = sub["High"].dropna() if "High" in sub.columns else sub["Close"].dropna()
                if series.empty:
                    continue
                hi = float(series.max())
                ath[sym] = (round(hi, 2), _iso_utc(series.idxmax()))
            except Exception:
                continue
        time.sleep(1)

    # preço + marketcap + shares via fast_info
    rows = []
    tk = yf.Tickers(" ".join(symbols))
    for sym in symbols:
        a = ath.get(sym)
        if not a:
            continue
        price = mcap = shares = None
        try:
            fi = tk.tickers[sym].fast_info
            price = fi.get("last_price")
            mcap = fi.get("market_cap")
            shares = fi.get("shares")
        except Exception:
            pass
        if not price:
            continue
        rows.append({
            "symbol": sym, "name": names.get(sym, sym),
            "price": round(float(price), 2),
            "marketcap": float(mcap) if mcap else None,
            "shares": float(shares) if shares else None,
            "ath": a[0], "ath_ts": a[1],
        })
    print(f"[ath] full: {len(rows)} linhas completas")
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

    rows = []
    for sym, p in prices.items():
        if not p:
            continue
        sh = shares.get(sym)
        mcap = round(sh * p) if sh else None
        rows.append({"symbol": sym, "price": round(p, 2), "marketcap": mcap})
    print(f"[ath] prices: {len(rows)} linhas")
    post_rows(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["full", "prices"], default="full")
    args = ap.parse_args()
    if not CRON_SECRET:
        sys.exit("CRON_SECRET em falta")
    (fetch_full if args.mode == "full" else fetch_prices)()

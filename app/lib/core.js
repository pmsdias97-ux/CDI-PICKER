// Constantes e funções utilitárias partilhadas (extraído de app/page.js — sem alterações de comportamento).

import { useLayoutEffect, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { createPortal } from "react-dom";

// useLayoutEffect corre ANTES do paint (mede/posiciona sem flash); no servidor cai para useEffect
// (não há DOM), evitando o aviso de SSR. Usado para centrar o campeão/medalhão no gráfico.
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// weekly_baselines/monthly_baselines já passaram das 1000 linhas (limite por resposta do Supabase) → a
// query simples truncava e a semana/mês ATUAL ficava com baseline INCOMPLETO → o pfWeekRet caía no
// initialPrice da ÉPOCA para os tickers em falta → ranking e VENCEDOR semanais ERRADOS. Paginar por
// range() traz todas as linhas (a tabela não tem coluna `id` para cursor).
export async function fetchAllBaselines(table){
  const PAGE=1000; let from=0; const all=[];
  for(;;){
    const { data, error } = await supabase.from(table)
      .select("period,ticker,price,close_price")
      .order("period",{ascending:true}).order("ticker",{ascending:true})
      .range(from, from+PAGE-1);
    if(error||!data||!data.length) break;
    all.push(...data);
    if(data.length<PAGE) break;
    from+=PAGE;
  }
  return all;
}

/* ============================================================================
   CONVERSAS DE INVESTIDORES
   ============================================================================ */

export const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export const PORTFOLIO_SIZE = 8;

export const MAX_SHORTS = 2;

export const STARTING_VALUE = 10000;

export const PER_STOCK = STARTING_VALUE / PORTFOLIO_SIZE;

// Feriados do mercado US (NYSE/NASDAQ). Atualizar ~1×/ano. Datas em ET (YYYY-MM-DD).
export const MARKET_HOLIDAYS_US = new Set([
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18",
  "2027-07-05","2027-09-06","2027-11-25","2027-12-24",
]);

// Estado do mercado pela hora de Nova Iorque (sem API). Só aberto/fechado
// (horário regular 09:30–16:00 ET). Devolve {open,label,et,pt}.
export function marketStatus(){
  try{
    const et=new Intl.DateTimeFormat("pt-PT",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date());
    const get=t=>parts.find(p=>p.type===t)?.value;
    const wd=get("weekday");
    let h=parseInt(get("hour"),10); if(h===24) h=0;
    const t=h*60+parseInt(get("minute"),10);
    const weekend=wd==="Sat"||wd==="Sun";
    const open=!weekend&&!MARKET_HOLIDAYS_US.has(date)&&t>=570&&t<960;
    return{open,label:open?"Mercado aberto":"Mercado fechado",et};
  }catch{ return{open:false,label:"Mercado fechado",et:""}; }
}

// Offset (ms) do fuso ET num dado instante — trata do horário de verão/inverno.
export function etOffsetMs(instant){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(instant);
  const m={}; for(const x of p) m[x.type]=x.value;
  let h=parseInt(m.hour,10); if(h===24) h=0;
  const asUTC=Date.UTC(+m.year,+m.month-1,+m.day,h,+m.minute,+m.second);
  return asUTC-instant.getTime();
}

// Tempo (ms) até à próxima ABERTURA do mercado (09:30 ET em dia de sessão, saltando
// fins-de-semana e feriados). Devolve 0 se o mercado estiver aberto agora.
export function msUntilMarketOpen(){
  try{
    if(marketStatus().open) return 0;
    const now=Date.now();
    const etDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const [y,mo,d]=etDate.split("-").map(Number);
    for(let i=0;i<14;i++){
      const cand=new Date(Date.UTC(y,mo-1,d+i));
      const cy=cand.getUTCFullYear(),cmo=cand.getUTCMonth()+1,cd=cand.getUTCDate();
      const dow=cand.getUTCDay();
      const key=`${cy}-${String(cmo).padStart(2,"0")}-${String(cd).padStart(2,"0")}`;
      if(dow===0||dow===6||MARKET_HOLIDAYS_US.has(key)) continue; // só dias de sessão
      const guess=Date.UTC(cy,cmo-1,cd,9,30);                     // 09:30 "como UTC"
      const inst=guess-etOffsetMs(new Date(guess));               // → instante real (09:30 ET)
      if(inst>now) return inst-now;
    }
    return 0;
  }catch{ return 0; }
}

// Rótulo da coluna diária conforme o "dia" mostrado: "Hoje" se a sessão de HOJE já começou (mercado aberto,
// ou fechado à tarde depois do fecho de hoje); "Ontem" se o último pregão foi mesmo ontem; senão "Último dia"
// (domingo/2ª feira mostram sexta, dia a seguir a feriado, etc.).
export function lastDayLabel(){
  try{
    const now=new Date();
    const g=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(now);
    const gv=t=>g.find(p=>p.type===t)?.value;
    const todayET=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
    let h=parseInt(gv("hour"),10); if(h===24) h=0; const mins=h*60+parseInt(gv("minute"),10);
    const [y,mo,d]=todayET.split("-").map(Number);
    const key=c=>`${c.getUTCFullYear()}-${String(c.getUTCMonth()+1).padStart(2,"0")}-${String(c.getUTCDate()).padStart(2,"0")}`;
    const isTrading=c=>{ const dow=c.getUTCDay(); return dow!==0&&dow!==6&&!MARKET_HOLIDAYS_US.has(key(c)); };
    let last=null;
    // Sessão de HOJE já começou (dia de pregão e >= 09:30 ET) → o "dia" mostrado é hoje (ao vivo ou já fechado).
    if(isTrading(new Date(Date.UTC(y,mo-1,d)))&&mins>=570){ last=todayET; }
    else { for(let i=1;i<=10;i++){ const c=new Date(Date.UTC(y,mo-1,d-i)); if(isTrading(c)){ last=key(c); break; } } } // senão, recua ao pregão anterior
    // "Hoje"/"Ontem" medem-se contra o dia CIVIL em Portugal (não o de Nova Iorque): a sessão que fecha às
    // 21h de Lisboa continua "Hoje" até à meia-noite; depois da meia-noite passa a "Ontem" até a sessão
    // seguinte abrir (14:30 Lisboa). Fins de semana/feriados: último pregão há >1 dia → "Último dia".
    const [ly,lmo,ld]=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon",year:"numeric",month:"2-digit",day:"2-digit"}).format(now).split("-").map(Number);
    const todayPT=key(new Date(Date.UTC(ly,lmo-1,ld)));
    const ystPT=key(new Date(Date.UTC(ly,lmo-1,ld-1)));
    if(last===todayPT) return "Hoje";
    if(last===ystPT) return "Ontem";
    return "Último dia";
  }catch{ return "Último dia"; }
}

// "falta HH:mm" no formato 01:02 (<24h) ou "falta Nd 01:02" (>=24h). Sem segundos.
export function fmtCountdown(ms){
  if(ms<=0) return "";
  const totalMin=Math.floor(ms/60000);
  const days=Math.floor(totalMin/1440);
  const h=Math.floor((totalMin%1440)/60);
  const m=totalMin%60;
  const hhmm=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  return days>0?`falta ${days}d ${hhmm}`:`falta ${hhmm}`;
}

// Mapa curado de setores (sem APIs). Tickers fora do mapa caem em "Outros".
export const SECTORS = {
  // Tecnologia
  AAPL:"Tecnologia",MSFT:"Tecnologia",NVDA:"Tecnologia",AVGO:"Tecnologia",ORCL:"Tecnologia",
  CRM:"Tecnologia",ADBE:"Tecnologia",AMD:"Tecnologia",MU:"Tecnologia",INTC:"Tecnologia",
  SMCI:"Tecnologia",PLTR:"Tecnologia",CSCO:"Tecnologia",QCOM:"Tecnologia",TXN:"Tecnologia",
  IBM:"Tecnologia",NOW:"Tecnologia",SHOP:"Tecnologia",ASML:"Tecnologia",ARM:"Tecnologia",
  TSM:"Tecnologia",ZETA:"Tecnologia",DELL:"Tecnologia",ANET:"Tecnologia",PANW:"Tecnologia",
  // Comunicação / Internet
  GOOG:"Comunicação",GOOGL:"Comunicação",META:"Comunicação",NFLX:"Comunicação",DIS:"Comunicação",
  TMUS:"Comunicação",T:"Comunicação",VZ:"Comunicação",SPOT:"Comunicação",
  // Consumo
  AMZN:"Consumo",TSLA:"Consumo",MCD:"Consumo",NKE:"Consumo",SBUX:"Consumo",LULU:"Consumo",
  HD:"Consumo",LOW:"Consumo",KO:"Consumo",PEP:"Consumo",PG:"Consumo",COST:"Consumo",WMT:"Consumo",
  MB:"Consumo",CMG:"Consumo",
  // Financeiro
  MA:"Financeiro",V:"Financeiro",JPM:"Financeiro",BAC:"Financeiro",WFC:"Financeiro",GS:"Financeiro",
  MS:"Financeiro",AXP:"Financeiro","BRK.A":"Financeiro","BRK.B":"Financeiro",NU:"Financeiro",
  SOFI:"Financeiro",PYPL:"Financeiro",C:"Financeiro",SCHW:"Financeiro",
  // Saúde
  UNH:"Saúde",JNJ:"Saúde",LLY:"Saúde",PFE:"Saúde",ABBV:"Saúde",MRK:"Saúde",TMO:"Saúde",
  // Energia / Industrial
  XOM:"Energia",CVX:"Energia",BA:"Industrial",CAT:"Industrial",GE:"Industrial",UBER:"Industrial",
  SPCX:"Industrial",RTX:"Industrial",LMT:"Industrial",
  // ETFs
  VOO:"ETF / Índice",SPY:"ETF / Índice",QQQ:"ETF / Índice",VTI:"ETF / Índice",
  // ── Backfill: todos os tickers em uso nos portefólios, classificados 1×
  //    (evita o "A identificar…" — a mesma carteira abre sempre resolvida).
  // Tecnologia
  AAOI:"Tecnologia",ACN:"Tecnologia",AKAM:"Tecnologia",AMAT:"Tecnologia",AMBA:"Tecnologia",
  AMKR:"Tecnologia",APLD:"Tecnologia",APP:"Tecnologia",CGNX:"Tecnologia",CLS:"Tecnologia",
  COHR:"Tecnologia",CRDO:"Tecnologia",CRWD:"Tecnologia",CRWV:"Tecnologia",CTM:"Tecnologia",
  DSGX:"Tecnologia",DUOL:"Tecnologia",FORM:"Tecnologia",FTNT:"Tecnologia",GLW:"Tecnologia",
  GRRR:"Tecnologia",INFQ:"Tecnologia",INOD:"Tecnologia",INTU:"Tecnologia",IONQ:"Tecnologia",
  KLAC:"Tecnologia",LRCX:"Tecnologia",MRVL:"Tecnologia",NBIS:"Tecnologia",NET:"Tecnologia",
  NTSK:"Tecnologia",NVTS:"Tecnologia",P:"Tecnologia",QBTS:"Tecnologia",QLYS:"Tecnologia",
  QUBT:"Tecnologia",RGTI:"Tecnologia",RZLV:"Tecnologia",SNDK:"Tecnologia",SNOW:"Tecnologia",
  SNPS:"Tecnologia",SOUN:"Tecnologia",TEAM:"Tecnologia",TSEM:"Tecnologia",WDC:"Tecnologia",
  ZS:"Tecnologia",HIVE:"Tecnologia",IREN:"Tecnologia",NXTS:"Tecnologia",
  // Comunicação
  ASTS:"Comunicação",LUMN:"Comunicação",RDDT:"Comunicação",TTWO:"Comunicação",U:"Comunicação",
  WBD:"Comunicação",
  // Consumo
  AZO:"Consumo",BABA:"Consumo",BKNG:"Consumo",CELH:"Consumo",CPRT:"Consumo",DPZ:"Consumo",
  ELF:"Consumo",FLUT:"Consumo",HLT:"Consumo",MELI:"Consumo",POOL:"Consumo",RACE:"Consumo",
  SONY:"Consumo",
  // Financeiro
  DLO:"Financeiro",FICO:"Financeiro",FOUR:"Financeiro",HOOD:"Financeiro",
  IBKR:"Financeiro",SPGI:"Financeiro",
  // Saúde
  CVS:"Saúde",HIMS:"Saúde",ISRG:"Saúde",NVO:"Saúde",OSCR:"Saúde",SIGA:"Saúde",
  SLS:"Saúde",TEM:"Saúde",VEEV:"Saúde",XRAY:"Saúde",
  // Industrial
  AMPX:"Industrial",ATLN:"Industrial",AVAV:"Industrial",BE:"Industrial",FPS:"Industrial",
  GEV:"Industrial",GRAB:"Industrial",LUNR:"Industrial",ONDS:"Industrial",OPTX:"Industrial",
  PL:"Industrial",PSIG:"Industrial",QS:"Industrial",QXO:"Industrial",RDW:"Industrial",
  RKLB:"Industrial",RR:"Industrial",SMR:"Industrial",TE:"Industrial",VRT:"Industrial",
  // Serviços Públicos (utilities)
  CEG:"Serviços Públicos",VST:"Serviços Públicos",
  // Materiais (metais / químicos / commodities)
  AAAU:"Materiais",ADUR:"Materiais",ASPI:"Materiais",
  // Cripto (BTC + tesourarias/mineração)
  BMNP:"Cripto",BMNR:"Cripto",BTC:"Cripto",MSTR:"Cripto",STRC:"Cripto",
};

export const SECTOR_COLORS=["#3b82f6","#22c55e","#fbbf24","#a855f7","#f87171","#06b6d4","#f97316","#94a3b8"];

/* ---- Storage helpers -----------------------------------------------------
   Per-visitor identity only (the Telegram name), in browser localStorage so it
   survives closing/reopening the window. All shared data lives in Supabase.
--------------------------------------------------------------------------- */
export function sget(key){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):null; }catch{ return null; } }

export function sset(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)); return true; }catch{ return false; } }

/* ---- Domain helpers ------------------------------------------------------ */
export function norm(s){ return (s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," "); }

// Current price = real live market price; falls back to the day-zero price until
// the live quote loads. The whole game is: buy at submission, measure real return.
export function curPrice(ticker,initPrice,livePrices){
  if(livePrices&&typeof livePrices[ticker]==="number") return livePrices[ticker];
  return initPrice;
}

export function stockRet(s,livePrices){
  const c=curPrice(s.ticker,s.initialPrice,livePrices);
  const base=s.initialPrice?c/s.initialPrice-1:0;
  // Short: rentabilidade é o espelho da variação da ação (cai 10% -> +10%).
  return s.side==="short"?-base:base;
}

// Rentabilidade do portefólio HOJE: média das variações do dia das ações (espelhada p/ shorts).
export function pfDayRet(pf,dayChange){
  const dc=dayChange||{};
  const rs=(pf?.stocks||[]).map(s=>{ const d=dc[s.ticker]; return Number.isFinite(d)?(s.side==="short"?-d:d):null; }).filter(x=>x!=null);
  return rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null;
}

export function mapPortfolioFromSupabase(row){
  const user=row.users;
  const name=user?.telegram_name||"";
  return{
    key:`pf_${row.id}`,
    id:row.id,
    userId:row.user_id,
    name,
    normName:norm(name),
    submittedAt:row.created_at||null,
    locked:row.locked,
    initialValue:row.initial_value,
    spyInitialPrice:row.spy_initial_price!=null?Number(row.spy_initial_price):null,
    official:row.official===true,
    stocks:(row.portfolio_stocks||[]).map(s=>({
      ticker:s.ticker,
      companyName:s.company_name,
      exchange:"",
      side:s.side==="short"?"short":"long",
      initialPrice:Number(s.initial_price),
      initialWeight:Number(s.initial_weight)/100,
      currency:s.currency||"USD",
      allocated:PER_STOCK,
    })),
  };
}

// Verde/vermelho conta pelo valor ARREDONDADO a 2 casas (= o que é mostrado): "+0.00%" → neutro.
// Evita "1 no verde" por ruído de cêntimo no arranque da semana (ex.: base 384.27 vs 384.28 = +0.003%).
export const rSign=(r)=>Number((r*100).toFixed(2));

export function pfStats(p,livePrices){
  const rets=p.stocks.map(s=>stockRet(s,livePrices));
  return{ total:rets.reduce((a,b)=>a+b,0)/rets.length, pos:rets.filter(r=>rSign(r)>0).length, neg:rets.filter(r=>rSign(r)<0).length };
}

// Mini-época MENSAL ("Campeão do mês"): MESMA fórmula do total, mas com o baseline do
// início do mês (monthBase[ticker]) em vez do preço de submissão. Justo ao membro — pondera
// cada ação por 1/preço-início-do-mês (não por 1/preço-de-submissão, que sobrevaloriza ações
// que já dispararam desde o arranque). Sem baseline do mês → cai no preço inicial (ex.: julho,
// o mês de arranque, fica = ao total automaticamente).
export function pfMonthRet(p,monthBase,livePrices){
  if(!p?.stocks?.length) return null;
  // Entrou a meio do mês (submissão dentro do período)? O baseline dele é o preço de submissão
  // (comprou a meio), não o preço de abertura do mês que nunca negociou.
  const periodStartMs=Date.parse(new Date().toISOString().slice(0,7)+"-01T00:00:00Z");
  const enteredThisMonth=p.submittedAt?Date.parse(p.submittedAt)>=periodStartMs:false;
  const rets=p.stocks.map(s=>{
    const mb=monthBase&&monthBase[s.ticker];
    const baseline=(!enteredThisMonth&&Number.isFinite(mb)&&mb>0)?mb:s.initialPrice;
    const c=curPrice(s.ticker,s.initialPrice,livePrices);
    const base=baseline?c/baseline-1:0;
    return s.side==="short"?-base:base; // short = espelho
  });
  return rets.reduce((a,b)=>a+b,0)/rets.length;
}

// Rentabilidade de um período JÁ FECHADO: preço no fim (baseTo) vs início (baseFrom), por ticker.
export function pfPeriodRet(p,baseFrom,baseTo){
  const rets=(p?.stocks||[]).map(s=>{
    const a=baseFrom&&baseFrom[s.ticker], b=baseTo&&baseTo[s.ticker];
    if(!(a>0)||!(b>0)) return null;
    const base=b/a-1;
    return s.side==="short"?-base:base;
  }).filter(x=>x!=null);
  return rets.length?rets.reduce((x,y)=>x+y,0)/rets.length:null;
}

export function nextPeriod(p){ const [y,m]=p.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; }

export function periodLabel(p){ const [y,m]=p.split("-").map(Number); return new Date(Date.UTC(y,m-1,1)).toLocaleDateString("pt-PT",{month:"long"}); }

// Mini-época SEMANAL ("Campeão da semana"). Chave = SEGUNDA-feira (UTC) dessa semana, 'YYYY-MM-DD'.
export function weekKey(d){
  const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  const dow=t.getUTCDay(); t.setUTCDate(t.getUTCDate()+(dow===0?-6:1-dow)); // recua até 2ª feira
  return t.toISOString().slice(0,10);
}

export function nextWeek(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+7); return t.toISOString().slice(0,10); }

// Fecho de um mês FECHADO (p/ apurar o "Campeão do mês"), por ordem de fiabilidade:
//  0) close_price GRAVADO (cron monthly-close, no último dia útil do mês) — geral e permanente, revela o
//     campeão logo que o mês fecha, seja qual for o dia. É a fonte principal.
//  1) abertura do mês SEGUINTE = o "fecho antes do dia 1" (permanente; o cron mensal captura-o no início
//     do mês seguinte). Fallback caso o close_price ainda não exista.
//  2) se o mês terminou numa 6ª feira / fim de semana (último pregão = 6ª) e essa semana já foi FECHADA
//     pela weekly-close, o fecho SEMANAL dessa semana serve de fecho do mês. Último recurso.
export function monthCloseBase(per, pastBaselines, weekCloses, monthCloses){
  const stored = monthCloses && monthCloses[per];
  if(stored) return stored;
  const nxt = pastBaselines && pastBaselines[nextPeriod(per)];
  if(nxt) return nxt;
  const [y,m] = per.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0));            // dia 0 do mês seguinte = último dia deste mês
  const dow = last.getUTCDay();                        // 5=6ª, 6=Sáb, 0=Dom → último pregão do mês = 6ª dessa semana
  if((dow===5||dow===6||dow===0) && weekCloses){ const wc = weekCloses[weekKey(last)]; if(wc) return wc; }
  return null;
}

// Semanas numeradas ("Semana 1", "Semana 2", …). Semana 1 = semana de arranque (1–3 jul, parcial;
// semana ISO de 29-jun). Semana 2 = 6–10 jul (1ª semana completa e ao vivo).
export const WEEK1_MONDAY="2026-06-29";

export const WEEK_LIVE_FROM="2026-07-06";

// jogo semanal ao vivo a partir da Semana 2 (6-jul)
// Semana 1 (1–3 jul) é um registo FIXO (semeado), vencedor Manuel. ret=null → mostra só o nome (sem %).
// ret = rentabilidade do Manuel na Semana 1 (1–2 jul; 3-jul foi feriado) = total_return congelado a 2-jul.
export const WEEK_SEED_CHAMPS=[{period:"2026-06-29", name:"Manuel", ret:0.0984}];

export function weekNum(key){ return Math.max(1, Math.round((Date.parse(key+"T00:00:00Z")-Date.parse(WEEK1_MONDAY+"T00:00:00Z"))/(7*86400000))+1); }

export function weekLabel(key){ return `Semana ${weekNum(key)}`; }

// Fim da semana = SEXTA-feira (2ª feira + 4). O ranking semanal é 2ª (abertura) → 6ª (fecho).
export function weekFriday(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+4); return t.toISOString().slice(0,10); }

// Abertura US (09:30 ET) do 1.º PREGÃO da semana (2ª; salta feriados) — instante em ms (UTC).
export function weekFirstOpenMs(mondayKey){
  for(let i=0;i<5;i++){
    const d=new Date(Date.parse(mondayKey+"T00:00:00Z")+i*86400000);
    const key=d.toISOString().slice(0,10);
    if(MARKET_HOLIDAYS_US.has(key)) continue;
    const guess=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),9,30);
    return guess-etOffsetMs(new Date(guess));
  }
  return null;
}

// 2ª feira (ou depois de um feriado) ANTES da abertura do 1.º pregão: a semana nova ainda não arrancou.
export function weekPreOpen(now){
  const n=now||new Date(); const mk=weekKey(n); const t=weekFirstOpenMs(mk);
  return t!=null && Date.parse(mk+"T00:00:00Z")<=n.getTime() && n.getTime()<t;
}

export function prevWeek(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()-7); return t.toISOString().slice(0,10); }

// Semana da COMPETIÇÃO "em jogo": a calendário, EXCETO até à abertura do 1.º pregão — aí ainda é a semana
// que acabou de fechar (congelada, com o vencedor), tal como ao fim de semana.
export function compWeekKey(now){ const n=now||new Date(); const k=weekKey(n); return weekPreOpen(n)?prevWeek(k):k; }

// Semana fechada? 6ª feira depois do fecho US (16:00 ET), fim de semana, ou 2ª antes da abertura → vencedor apurado.
export function weekTradingDone(now){
  if(weekPreOpen(now)) return true;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",hour12:false}).formatToParts(now||new Date());
  const wd=parts.find(x=>x.type==="weekday")?.value;
  let h=parseInt(parts.find(x=>x.type==="hour")?.value||"0",10); if(h===24)h=0;
  if(wd==="Sat"||wd==="Sun") return true;   // fim de semana
  if(wd==="Fri"&&h>=16) return true;        // 6ª feira depois do fecho (16:00 ET)
  return false;
}

// Mês fechado? Só DEPOIS do fecho US (16:00 ET) do ÚLTIMO dia útil do mês (recua de fim de semana e
// feriados). O campeão do mês NUNCA é apurado antes disso — nem no próprio último dia antes do fecho.
export function monthTradingDone(now){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hour12:false}).formatToParts(now||new Date());
  const g=t=>parts.find(x=>x.type===t)?.value;
  const y=+g("year"), mo=+g("month"), d=+g("day"); let h=parseInt(g("hour")||"0",10); if(h===24)h=0;
  const ld=new Date(Date.UTC(y,mo,0)); // dia 0 do mês seguinte = último dia deste mês
  while(ld.getUTCDay()===0||ld.getUTCDay()===6||MARKET_HOLIDAYS_US.has(ld.toISOString().slice(0,10))) ld.setUTCDate(ld.getUTCDate()-1);
  const ldDay=ld.getUTCDate();
  if(d>ldDay) return true;               // já passámos o último pregão do mês
  if(d===ldDay&&h>=16) return true;       // último pregão, depois do fecho US
  return false;
}

// Rentabilidade da SEMANA: mesma fórmula do total, mas com o baseline da 2ª feira (weekBase).
export function pfWeekRet(p,weekBase,livePrices){
  if(!p?.stocks?.length) return null;
  const wkStartMs=Date.parse(weekKey(new Date())+"T00:00:00Z");
  const enteredThisWeek=p.submittedAt?Date.parse(p.submittedAt)>=wkStartMs:false;
  const rets=p.stocks.map(s=>{
    const wb=weekBase&&weekBase[s.ticker];
    const baseline=(!enteredThisWeek&&Number.isFinite(wb)&&wb>0)?wb:s.initialPrice;
    const c=curPrice(s.ticker,s.initialPrice,livePrices);
    const base=baseline?c/baseline-1:0;
    return s.side==="short"?-base:base; // short = espelho
  });
  return rets.reduce((a,b)=>a+b,0)/rets.length;
}

export function pct(x,dp=2){ const v=(x*100).toFixed(dp); return `${x>=0?"+":""}${v}%`; }

export function money(x,cur){
  try{ return new Intl.NumberFormat("en-US",{style:"currency",currency:cur||"USD",minimumFractionDigits:2}).format(x); }
  catch{ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(x); }
}

export function dt(iso){
  if(!iso) return "—";
  try{ return new Date(iso).toLocaleString("pt-PT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch{ return iso; }
}

export function dlCSV(filename,rows){
  const csv=rows.map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(";")).join("\r\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
  a.download=filename; a.click();
}

/* ---- Stock logo ----------------------------------------------------------
   Company logo by ticker via logo.dev (high quality, ticker-accurate). Needs a
   public token (pk_...) in NEXT_PUBLIC_LOGODEV_TOKEN. If there's no token or the
   image fails, falls back to a coloured monogram with the ticker's initials.
--------------------------------------------------------------------------- */
export const LOGODEV_TOKEN=process.env.NEXT_PUBLIC_LOGODEV_TOKEN;

// Estado da faixa de voltar: ativa só em desktop (hover/ponteiro fino) e com margem
// esquerda suficiente. Quando ativa, SUBSTITUI o botão "← Voltar ao ranking".
export function useBackRail(){
  const [enabled,setEnabled]=useState(false);
  const [gap,setGap]=useState(0);
  useEffect(()=>{
    let ok=false;
    try{ ok=window.matchMedia("(hover:hover) and (pointer:fine)").matches; }catch{}
    setEnabled(ok);
    if(!ok) return;
    const calc=()=>{ const w=window.innerWidth; setGap(w>1320?(w-1320)/2+20:20); };
    calc();
    window.addEventListener("resize",calc);
    return ()=>window.removeEventListener("resize",calc);
  },[]);
  return {active:enabled&&gap>=64,gap};
}

// Portal para um <div> block dedicado no fim do <body>. Isto resolve DOIS bugs de position:fixed no
// Safari iOS que faziam os botões "flutuar" e prender-se ao centro ao fazer scroll:
//  1) ancestral com overflow clip/hidden (o root do Shell) → tira-os de lá;
//  2) o <body> é `flex flex-col` (layout.js) e um fixed que é FILHO DIRETO de um flex container é
//     posicionado relativo ao container, não à viewport. O wrapper block (não é flex item) evita isso.
// Só monta no cliente (evita SSR sem document).
export function Portal({children}){
  const [container,setContainer]=useState(null);
  useEffect(()=>{
    const el=document.createElement("div");
    document.body.appendChild(el);
    setContainer(el);
    return()=>{ try{ document.body.removeChild(el); }catch{} };
  },[]);
  return container?createPortal(children, container):null;
}

// Glow ambiente a respirar/derivar LENTAMENTE (Web Animations API, loop infinito; respeita
// prefers-reduced-motion). BreatheGlow = só a camada de luz; GlowBehind = luz + conteúdo por cima.
// CALM_MOTION: congela os brilhos AMBIENTE (Aurora + BreatheGlow). Animar blur por trás de painéis
// com backdrop-filter obriga o vidro a re-compor a cada frame (pesado em páginas com muito vidro, ex.:
// "Minhas 8"). Congelado = visual quase idêntico (ciclos de 22-50s), sem o custo contínuo. [TESTE local]
export const CALM_MOTION=true;

export function fmtCap(v,s="$"){
  if(!Number.isFinite(v)||v<=0) return "—";
  if(v>=1e12) return `${s}${(v/1e12).toFixed(2)}T`;
  if(v>=1e9)  return `${s}${(v/1e9).toFixed(0)}B`;
  if(v>=1e6)  return `${s}${(v/1e6).toFixed(0)}M`;
  return `${s}${v.toFixed(0)}`;
}

export const curSym=(c)=>({USD:"$",EUR:"€",GBP:"£",JPY:"¥",CHF:"CHF ",CAD:"C$",AUD:"A$",HKD:"HK$",BRL:"R$"}[c]||"$");

// Moeda inferida pelo sufixo do ticker (sem precisar de coluna na BD). Ex.: .PA/.AS/.DE → EUR.
export const SUFFIX_CUR={PA:"EUR",AS:"EUR",BR:"EUR",LS:"EUR",MC:"EUR",MI:"EUR",DE:"EUR",F:"EUR",VI:"EUR",IR:"EUR",HE:"EUR",AT:"EUR",L:"GBP",SW:"CHF",TO:"CAD",V:"CAD",AX:"AUD",HK:"HKD",T:"JPY",SA:"BRL"};

export const curForTicker=(sym)=>{ const p=String(sym||"").toUpperCase().split(/[.\-]/); return p.length>1?(SUFFIX_CUR[p[p.length-1]]||"USD"):"USD"; };

export function fmtMoney(v){ return Number.isFinite(v)?`$${v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—"; }

export function sinceLabel(ts){
  if(!ts) return "—";
  const t=new Date(ts).getTime(); if(!Number.isFinite(t)) return "—";
  const days=Math.floor((Date.now()-t)/86400000);
  if(days<=0) return "hoje";
  if(days===1) return "1 dia";
  if(days<31) return `${days} dias`;
  const months=Math.round(days/30.44);
  if(months<12) return months<=1?"1 mês":`${months} meses`;
  const years=days/365.25;
  return years<1.95?`${years.toFixed(1)} anos`:`${years.toFixed(years<10?1:0)} anos`;
}

export function fmtMoneyC(v,s="$"){ if(!Number.isFinite(v)) return "—"; return v>=1000?`${s}${Math.round(v).toLocaleString("en-US")}`:`${s}${v.toFixed(2)}`; }

export function sinceLabelShort(ts){
  if(!ts) return "—";
  const t=new Date(ts).getTime(); if(!Number.isFinite(t)) return "—";
  const days=Math.floor((Date.now()-t)/86400000);
  if(days<=0) return "hoje"; if(days<31) return `${days}d`;
  const months=Math.round(days/30.44); if(months<12) return `${months}m`;
  return `${Math.round(days/365.25)}a`;
}

export const tkNorm=(s)=>String(s||"").toUpperCase().replace(/\./g,"-").trim();

/* ---- Shared game settings (Supabase) ------------------------------------- */
export const DEFAULT_SETTINGS={submissionsOpen:true,gameStartDate:"",gameEndDate:"",competitionStarted:false,baselinesLockedAt:null};

export async function loadGameSettings(){
  try{
    const { data, error }=await supabase
      .from("game_settings")
      .select("submissions_open,game_start_date,game_end_date,competition_started,baselines_locked_at")
      .eq("id",1)
      .maybeSingle();
    if(error||!data) return null;
    return{
      submissionsOpen:data.submissions_open!==false,
      gameStartDate:data.game_start_date||"",
      gameEndDate:data.game_end_date||"",
      competitionStarted:data.competition_started===true,
      baselinesLockedAt:data.baselines_locked_at||null,
    };
  }catch{ return null; }
}

// Pré-lançamento (modo demonstração): antes de a competição arrancar.
export function isPreLaunch(s){ return !!s && s.competitionStarted!==true; }

// Submissões fechadas se desligadas, já arrancou, ou passou o prazo (game_start_date).
export function submissionsClosed(s){
  if(Date.now()>=SUBMISSIONS_CLOSE_MS) return true; // prazo (22:00 PT, 30 jun) — não reabre
  if(!s) return false;
  if(s.competitionStarted) return true;
  if(!s.submissionsOpen) return true;
  if(s.gameStartDate){ const d=new Date(s.gameStartDate); if(!isNaN(d)&&Date.now()>=d.getTime()) return true; }
  return false;
}

export function fmtDateShort(iso){
  try{ return new Intl.DateTimeFormat("pt-PT",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(iso)); }
  catch{ return ""; }
}

// Tempo relativo curto (pt-PT) para comentários: "agora", "há 5 min", "há 2 h", "há 3 d", senão data.
export function timeAgo(iso){
  const t=Date.parse(iso); if(!Number.isFinite(t)) return "";
  const s=Math.max(0,Math.floor((Date.now()-t)/1000));
  if(s<60) return "agora";
  const m=Math.floor(s/60); if(m<60) return `há ${m} min`;
  const h=Math.floor(m/60); if(h<24) return `há ${h} h`;
  const d=Math.floor(h/24); if(d<7) return `há ${d} d`;
  return fmtDateShort(iso);
}

// Contador ao segundo até ao FECHO das submissões (22h PT de 30 jun).
// Só na homepage, e só enquanto a competição ainda não arrancou (pré-lançamento).
// 22:00 PT (WEST, UTC+1) de 30 jun 2026 = 21:00 UTC — instante absoluto, à prova do fuso do visitante.
export const SUBMISSIONS_CLOSE_MS=Date.UTC(2026,5,30,21,0,0);

// Settings are written through the admin API route (service_role key); the
// browser only reads them via loadGameSettings above.

/* ---- Keys ---------------------------------------------------------------- */
export const K={MYNAME:"ci_myname",MYPIN:"ci_mypin"};

/* ============================================================================
   ROOT
   ============================================================================ */
/* ---- Routing por hash: URL = fonte de verdade (back/forward + links partilháveis) ----
   Os links usam o SLUG do nome (ex.: #p/tiago-almeida), resolvido AO VIVO a partir da lista
   de membros — vale para os atuais e os futuros. Aceita ainda links antigos por id (UUID).
   O duelo separa os dois slugs por "~". */
export const keyToId=(k)=>k?String(k).replace(/^pf_/,""):"";

export const slugify=(s)=>norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");

export function findBySlug(list,slug){ return slug?(list||[]).find(p=>slugify(p.name)===slug||keyToId(p.key)===slug)||null:null; }

export function routeToPath(r){
  if(r.page==="detail") return r.detailSlug?`/p/${r.detailSlug}`:"/minhas"; // sem slug = "Minhas 8" (deslogado → Área bloqueada)
  if(r.page==="duel"&&r.duelSlugs?.[0]&&r.duelSlugs?.[1]) return `/duel/${r.duelSlugs[0]}~${r.duelSlugs[1]}`;
  if(r.page==="ranking") return "/ranking";
  if(r.page==="ath")     return "/ath";
  if(r.page==="create")  return "/criar";
  if(r.page==="confirm") return "/confirmar";
  if(r.page==="admin")   return "/admin";
  return "/"; // home
}

export function parseRoute(){
  if(typeof window==="undefined") return {page:"home"};
  let p=window.location.pathname.replace(/\/+$/,"")||"/";
  if(p==="/"){ // migração de links antigos com hash (#p/..., #ath, #ranking, ...)
    const legacy=window.location.hash.replace(/^#/,"");
    if(legacy) p="/"+legacy;
  }
  if(p==="/"||p==="")  return {page:"home"};
  if(p==="/ranking")   return {page:"ranking"};
  if(p==="/ath")       return {page:"ath"};
  if(p==="/criar")     return {page:"create"};
  if(p==="/confirmar") return {page:"confirm"};
  if(p==="/admin")     return {page:"admin"};
  if(p==="/minhas")    return {page:"detail"}; // detalhe sem slug = "Minhas 8"
  const mp=p.match(/^\/p\/(.+)$/);          if(mp) return {page:"detail",detailSlug:decodeURIComponent(mp[1])};
  const md=p.match(/^\/duel\/(.+)~(.+)$/);  if(md) return {page:"duel",duelSlugs:[decodeURIComponent(md[1]),decodeURIComponent(md[2])]};
  return {page:"home"};
}

// "Ranking" com submenu ao passar o rato: Geral / Mensal / Semanal → vai direto a esse separador.
// Cores de destaque por período (mesmas do cabeçalho do Ranking): azul=Geral, roxo=Mensal, verde-água=Semanal.
export const RANK_PERIOD_ACCENT={
  total:{l:"#93c5fd",d:"#3b82f6",rgb:"96,165,250"},
  month:{l:"#c4b5fd",d:"#8b5cf6",rgb:"167,139,250"},
  week:{l:"#5eead4",d:"#14b8a6",rgb:"45,212,191"},
};

// Ícones do menu (traço). ATH = montanha (pico = máximo histórico).
export const NAV_ICONS={
  home:<><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></>,
  trophy:<><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 5H5a2 2 0 0 0 0 4h2M17 5h2a2 2 0 0 1 0 4h-2"/><path d="M12 13v4M8.5 21h7M10.5 21a1.5 1.5 0 0 1 3 0"/></>,
  person:<><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></>,
  mountain:<><path d="m8 3 4 8 5-5 5 15H2L8 3z"/><path d="M4.1 15.1c2.6-1.6 5.2-1.4 7.9.4 2.7 1.9 5.5 2 8.2.2"/></>,
};

export const RANK_BADGE={
  1:{background:"linear-gradient(145deg,#fde68a,#f59e0b)",color:"#3a2800",boxShadow:"0 0 14px rgba(245,158,11,0.55), 0 3px 12px rgba(245,158,11,0.4)"},
  2:{background:"linear-gradient(145deg,#f8fafc,#94a3b8)",color:"#1e293b",boxShadow:"0 0 12px rgba(203,213,225,0.5), 0 3px 10px rgba(148,163,184,0.3)"},
  3:{background:"linear-gradient(145deg,#fcd9a8,#b45309)",color:"#2e1800",boxShadow:"0 0 12px rgba(217,119,6,0.5), 0 3px 10px rgba(180,83,9,0.3)"},
};

// Pódio do ranking: Top 3 em 2-1-3, o 1.º maior e elevado. Substitui as 3 primeiras linhas da lista.
// Louros em SVG (vetorial → nítidos em qualquer tamanho; os .webp têm só 95px). Ramo esquerdo desenhado e
// espelhado para o direito. Folhas distribuídas ao longo de um arco (Bézier cúbica), alternando de lado.
export const LAUREL_LEAVES=(()=>{
  const P=[[96,176],[40,150],[28,86],[66,38]]; // arco do caule (esquerdo)
  const bez=t=>{ const u=1-t; return [u*u*u*P[0][0]+3*u*u*t*P[1][0]+3*u*t*t*P[2][0]+t*t*t*P[3][0], u*u*u*P[0][1]+3*u*u*t*P[1][1]+3*u*t*t*P[2][1]+t*t*t*P[3][1]]; };
  const out=[];
  for(let i=0;i<8;i++){
    const t=0.10+i*0.115, [x,y]=bez(t), [x2,y2]=bez(t+0.01);
    const ang=Math.atan2(y2-y,x2-x)*180/Math.PI;
    const sz=1-i*0.045; // folhas diminuem para a ponta
    out.push({x,y,r:ang-38,sz},{x,y,r:ang+38,sz});
  }
  const [tx,ty]=bez(1); out.push({x:tx,y:ty,r:Math.atan2(ty-bez(0.97)[1],tx-bez(0.97)[0])*180/Math.PI,sz:0.8});
  return {leaves:out,stem:`M${P[0][0]} ${P[0][1]} C${P[1][0]} ${P[1][1]} ${P[2][0]} ${P[2][1]} ${P[3][0]} ${P[3][1]}`};
})();

export const PODIUM_TONE={
  1:{rgb:"250,204,21",ink:"#fde68a",hi:"#fde68a",lo:"#d9930d"},
  2:{rgb:"203,213,225",ink:"#e2e8f0",hi:"#f8fafc",lo:"#8794a8"},
  3:{rgb:"217,119,6",ink:"#fbbf77",hi:"#fcd9a8",lo:"#b4620f"},
};

// Pilha de moedas (SVG vetorial, muito detalhada) sobre um prato metálico: ouro (1.º), prata (2.º), bronze (3.º).
// Cada moeda: corpo com sombreado metálico + serrilha vertical + oclusão de sombra da moeda de cima + aro biselado
// + brilho especular; a de cima tem face em relevo (aro, campo rebaixado, anel interior).
export const COIN_SET={
  1:{n:10,rx:104,side:[["0","#4d2a02"],[".1","#9a5f0a"],[".28","#f0bd48"],[".4","#fff3b0"],[".52","#e8ad2c"],[".78","#a0640c"],["1","#3e2202"]],
     top:["#fff8c9","#f2b92e","#b4710c"],field:["#c98c14","#f7d56e"],rim:"#fff0a8",dark:"#5a3203"},
  2:{n:8,rx:96,side:[["0","#3b4556"],[".1","#7f8b9e"],[".28","#d6dde8"],[".4","#ffffff"],[".52","#bcc6d4"],[".78","#707c90"],["1","#303a4a"]],
     top:["#ffffff","#c9d2df","#8793a6"],field:["#97a3b5","#e4eaf3"],rim:"#ffffff",dark:"#2c3646"},
  3:{n:7,rx:92,side:[["0","#341705"],[".1","#7a3d12"],[".28","#d98d4c"],[".4","#ffd6a6"],[".52","#c97b3a"],[".78","#7a3d12"],["1","#301504"]],
     top:["#ffe0bb","#d38a45","#8f4a17"],field:["#a8602a","#efb27a"],rim:"#ffd9b0",dark:"#4a2208"},
};

export const COIN_DX=[0,-5,4,-3,6,-4,3,-6,2,-3,5], COIN_DR=[0,-1.2,0.9,-0.6,1.4,-1,0.7,-1.3,0.5,-0.8,1.1], COIN_DRX=[0,2,-1,1,-2,1,0,-2,2,-1,1];

export const HERO_LINE_PATH="M0,24 C12,23 14,20 25,21 C36,22 40,16 50,18 C60,21 66,13 75,14 C84,14 89,11 94,10";

/* ---- Season Race (evolução multi-linha, estilo "season race") ------------ */
// Cores por posição: 1º ouro, 2º cinzento-claro, 3º bronze; 4º–10º cores bem distintas
// (sem tons parecidos entre si nem próximos do fundo azul-escuro). Usadas no gráfico Season
// Race, na legenda e no snapshot (via raceColorOf) → tudo coerente. O próprio ("tu") = branco.
export const RACE_COLORS=["#facc15","#cbd5e1","#d97706","#4ade80","#2dd4bf","#38bdf8","#818cf8","#c084fc","#f472b6","#fb7185"];

// Eixo X: só dia (DD/MM). Tooltip: dia + hora (DD/MM HH:mm), em hora local.
export function raceTick(iso){ const d=new Date(iso); if(Number.isNaN(d.getTime())) return String(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)}`; }

export function raceFull(iso){ const d=new Date(iso); if(Number.isNaN(d.getTime())) return String(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; }

// Ignora pontos gravados com o mercado US fechado (cotações repetidas → linhas
// "achatadas"). Dias úteis, 9:30–16:15 ET (DST automático via fuso New York).
export function isMktOpen(iso){
  const d=new Date(iso); if(Number.isNaN(d.getTime())) return false;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
  const v=k=>parts.find(x=>x.type===k)?.value;
  const wd=v("weekday"); if(wd==="Sat"||wd==="Sun") return false;
  let h=parseInt(v("hour"),10); if(h===24) h=0;
  const m=h*60+parseInt(v("minute"),10);
  return m>=570&&m<=975;
}

export const PT_WEEKDAY_SHORT=["Dom","2ª-feira","3ª-feira","4ª-feira","5ª-feira","6ª-feira","Sáb"];

export const raceColorOf=(p,i)=> p._me?"#ffffff":RACE_COLORS[i%RACE_COLORS.length];

// Cartão de partilha do Top 10 (fundos SÓLIDOS, sem blur → captura limpa com html-to-image).
export const SNAP_W=1000;

// Cache em memória (dura a sessão SPA, não sobrevive a reload) dos snapshots por conjunto de membros.
// Ao voltar ao Ranking, o gráfico usa logo o que já tinha (instantâneo) e revalida em fundo sem re-animar.
export const RACE_SNAP_CACHE=new Map();

// Cache PERSISTENTE (localStorage) dos snapshots do gráfico: no F5 mostra logo os últimos dados conhecidos e
// atualiza por trás (stale-while-revalidate) → as linhas deixam de esperar pela rede. Formato compacto.
export const RACE_LS_PREFIX="ci_race_v1:";

export function raceLsGet(key){
  try{
    const raw=localStorage.getItem(RACE_LS_PREFIX+key); if(!raw) return null;
    const rows=JSON.parse(raw); if(!Array.isArray(rows)) return null;
    return rows.map(r=>({portfolio_id:r[0],captured_at:r[1],total_return:r[2]}));
  }catch{ return null; }
}

export function raceLsSet(key,arr){
  try{
    // só uma entrada guardada (a mais recente) → não acumula lixo no localStorage
    for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith(RACE_LS_PREFIX)&&k!==RACE_LS_PREFIX+key) localStorage.removeItem(k); }
    localStorage.setItem(RACE_LS_PREFIX+key,JSON.stringify(arr.map(r=>[r.portfolio_id,r.captured_at,r.total_return])));
  }catch{ /* quota/indisponível → ignora */ }
}

// Fundo do ecrã inteiro do gráfico = o MESMO do ranking respetivo (Geral azul / Mensal roxo / Semanal teal) — iguais
// aos temas BLUE/PURPLE/TEAL do Shell.
export const RACE_FS_BG={
  total:{bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",color:"#070d1c"},
  month:{bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(88,60,160,0.24) 0%, rgba(67,42,130,0.10) 42%, transparent 72%), linear-gradient(180deg,#1e1640 0%,#181230 52%,#110c24 80%,#0c0819 100%)",color:"#0c0819"},
  week:{bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(20,160,150,0.22) 0%, rgba(13,120,120,0.09) 42%, transparent 72%), linear-gradient(180deg,#0c2e2e 0%,#0a2626 52%,#071c1d 80%,#051315 100%)",color:"#051315"},
};

// Mural social do portefólio: gostos (1 por pessoa) + comentários/roasts. Leitura pública; escrita só
// para quem submeteu (name+pin via authOwner). Apaga: o autor o seu, o admin qualquer (adminPw presente).
export const COMMENT_REACTIONS=["❤️","🔥","😂"];

// Icons (traço, herdam a cor do chip via currentColor) por tipo de badge — substituem os emojis.
export const BADGE_ICONS={
  "beat-spy":<><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/><path d="M12 13v4M9 21h6"/></>,
  "all-green":<><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9"/></>,
  "short-master":<><path d="M3 7l6 6 4-4 8 8"/><path d="M17 17h4v-4"/></>,
  resilient:<><path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z"/><path d="M9 12l2 2 4-4"/></>,
  leader:<><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.5 9.2l5.9-.9z"/></>,
  podium:<><circle cx="12" cy="9" r="6"/><path d="M9 14l-1.5 7L12 19l4.5 2L15 14"/></>,
  top10:<><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></>,
  "gain-10":<><circle cx="12" cy="12" r="9"/><path d="M8 12l4-4 4 4M12 8v8"/></>,
  "gain-20":<><circle cx="12" cy="12" r="9"/><path d="M8 12l4-4 4 4M12 8v8"/></>,
  "green-streak":<><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1.5-4.5C9 8 11 6 12 2z"/></>,
};

/* ---- Duelo 1v1 ----------------------------------------------------------- */
export const DUEL_A="#3b82f6", DUEL_B="#f59e0b";

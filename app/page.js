"use client";

import { useState, useEffect, useMemo, useCallback, useId } from "react";
import { supabase } from "./supabase";
import { fetchStockInfo, fetchStockPrices, fetchStockHistory, searchTickers } from "./lib/stocks";

/* ============================================================================
   CONVERSAS DE INVESTIDORES
   ============================================================================ */

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;
const PORTFOLIO_SIZE = 8;
const MAX_SHORTS = 2;
const STARTING_VALUE = 10000;
const PER_STOCK = STARTING_VALUE / PORTFOLIO_SIZE;

// Feriados do mercado US (NYSE/NASDAQ). Atualizar ~1×/ano. Datas em ET (YYYY-MM-DD).
const MARKET_HOLIDAYS_US = new Set([
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18",
  "2027-07-05","2027-09-06","2027-11-25","2027-12-24",
]);
// Estado do mercado pela hora de Nova Iorque (sem API). Só aberto/fechado
// (horário regular 09:30–16:00 ET). Devolve {open,label,et,pt}.
function marketStatus(){
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

// Mapa curado de setores (sem APIs). Tickers fora do mapa caem em "Outros".
const SECTORS = {
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
};
const SECTOR_COLORS=["#3b82f6","#22c55e","#fbbf24","#a855f7","#f87171","#06b6d4","#f97316","#94a3b8"];

/* ---- Storage helpers -----------------------------------------------------
   Per-visitor identity only (the Telegram name), in browser localStorage so it
   survives closing/reopening the window. All shared data lives in Supabase.
--------------------------------------------------------------------------- */
function sget(key){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):null; }catch{ return null; } }
function sset(key,value){ try{ localStorage.setItem(key,JSON.stringify(value)); return true; }catch{ return false; } }

/* ---- Domain helpers ------------------------------------------------------ */
function norm(s){ return (s||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," "); }
// Current price = real live market price; falls back to the day-zero price until
// the live quote loads. The whole game is: buy at submission, measure real return.
function curPrice(ticker,initPrice,livePrices){
  if(livePrices&&typeof livePrices[ticker]==="number") return livePrices[ticker];
  return initPrice;
}
function stockRet(s,livePrices){
  const c=curPrice(s.ticker,s.initialPrice,livePrices);
  const base=s.initialPrice?c/s.initialPrice-1:0;
  // Short: rentabilidade é o espelho da variação da ação (cai 10% -> +10%).
  return s.side==="short"?-base:base;
}
function mapPortfolioFromSupabase(row){
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
    stocks:(row.portfolio_stocks||[]).map(s=>({
      ticker:s.ticker,
      companyName:s.company_name,
      exchange:"",
      side:s.side==="short"?"short":"long",
      initialPrice:Number(s.initial_price),
      initialWeight:Number(s.initial_weight)/100,
      allocated:PER_STOCK,
    })),
  };
}
function pfStats(p,livePrices){
  const rets=p.stocks.map(s=>stockRet(s,livePrices));
  return{ total:rets.reduce((a,b)=>a+b,0)/rets.length, pos:rets.filter(r=>r>0).length, neg:rets.filter(r=>r<0).length };
}
function pct(x,dp=2){ const v=(x*100).toFixed(dp); return `${x>=0?"+":""}${v}%`; }
function money(x){ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(x); }
function dt(iso){
  if(!iso) return "—";
  try{ return new Date(iso).toLocaleString("pt-PT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}); }
  catch{ return iso; }
}
function dlCSV(filename,rows){
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
const LOGODEV_TOKEN=process.env.NEXT_PUBLIC_LOGODEV_TOKEN;
function Monogram({ticker,size}){
  const t=(ticker||"?").replace(/[.\-].*$/,"").slice(0,4);
  const label=t.slice(0,t.length<=3?t.length:2);
  let h=0; for(let i=0;i<ticker.length;i++) h=(h*31+ticker.charCodeAt(i))%360;
  return(
    <div style={{width:size,height:size,borderRadius:6,flexShrink:0,display:"flex",
      alignItems:"center",justifyContent:"center",fontWeight:800,
      fontSize:Math.round(size*0.36),letterSpacing:"-0.5px",color:"#fff",
      background:`linear-gradient(135deg,hsl(${h},55%,42%),hsl(${(h+40)%360},55%,32%))`}}>
      {label}
    </div>
  );
}
// Só marca as posições SHORT — long é o normal, não precisa de badge.
function SideBadge({side}){
  if(side!=="short") return null;
  return(
    <span style={{fontSize:10,fontWeight:800,letterSpacing:"0.5px",borderRadius:5,padding:"2px 6px",
      color:"#fbbf24",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.35)"}}>
      SHORT
    </span>
  );
}
function StockLogo({ticker,size=28}){
  const [err,setErr]=useState(false);
  if(!ticker) return null;
  if(err||!LOGODEV_TOKEN) return <Monogram ticker={ticker} size={size}/>;
  return(
    <img
      src={`https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${LOGODEV_TOKEN}&size=${size*3}&format=png&retina=true&fallback=404`}
      alt="" width={size} height={size} loading="lazy" onError={()=>setErr(true)}
      style={{width:size,height:size,borderRadius:6,objectFit:"cover",
        background:"#fff",display:"block",flexShrink:0}}/>
  );
}

/* ---- Shared game settings (Supabase) ------------------------------------- */
const DEFAULT_SETTINGS={submissionsOpen:true,gameStartDate:"",gameEndDate:""};
async function loadGameSettings(){
  try{
    const { data, error }=await supabase
      .from("game_settings")
      .select("submissions_open,game_start_date,game_end_date")
      .eq("id",1)
      .maybeSingle();
    if(error||!data) return null;
    return{
      submissionsOpen:data.submissions_open!==false,
      gameStartDate:data.game_start_date||"",
      gameEndDate:data.game_end_date||"",
    };
  }catch{ return null; }
}
// Settings are written through the admin API route (service_role key); the
// browser only reads them via loadGameSettings above.

/* ---- Keys ---------------------------------------------------------------- */
const K={MYNAME:"ci_myname"};

/* ============================================================================
   ROOT
   ============================================================================ */
export default function App(){
  const [page,setPage]=useState("home"); // home|create|confirm|ranking|detail|admin
  const [loading,setLoading]=useState(true);
  const [settings,setSettings]=useState(null);
  const [portfolios,setPortfolios]=useState([]);
  const [spyHist,setSpyHist]=useState(null);
  const [myName,setMyName]=useState(null);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [livePrices,setLivePrices]=useState({});
  const [dayChange,setDayChange]=useState({}); // variação do dia por ticker
  const [pricesLoading,setPricesLoading]=useState(false);
  const [detailKey,setDetailKey]=useState(null);
  const [duelKeys,setDuelKeys]=useState(null); // [keyA, keyB] para o duelo 1v1
  const [toast,setToast]=useState(null);

  const showToast=useCallback((msg,kind="ok")=>{ setToast({msg,kind}); setTimeout(()=>setToast(null),3500); },[]);

  const refreshLivePrices=useCallback(async(pfs)=>{
    // Inclui "SPY" para o benchmark (preço ao vivo do S&P 500 agora).
    const tickers=[...new Set([...(pfs||[]).flatMap(p=>p.stocks.map(s=>s.ticker)),"SPY"])];
    if(!tickers.length){ setLivePrices({}); setDayChange({}); return; }
    setPricesLoading(true);
    try{
      const { prices, changes }=await fetchStockPrices(tickers);
      setLivePrices(prices);
      setDayChange(changes||{});
    }catch(err){
      console.error(err);
    }finally{
      setPricesLoading(false);
    }
  },[]);

  const load=useCallback(async()=>{
    const mn=sget(K.MYNAME);
    const gs=await loadGameSettings();
    setSettings(gs||DEFAULT_SETTINGS);
    setMyName(mn||null);

    const { data: portfolioRows, error: pfError }=await supabase
      .from("portfolios")
      .select(`
        id,
        user_id,
        created_at,
        locked,
        initial_value,
        spy_initial_price,
        users (
          telegram_name,
          has_submitted_portfolio
        ),
        portfolio_stocks (
          ticker,
          company_name,
          initial_price,
          current_price,
          initial_weight,
          side
        )
      `);
    if(pfError){
      console.error(pfError);
      setPortfolios([]);
      setLivePrices({});
      setDayChange({});
    }else{
      const pfs=(portfolioRows||[])
        .filter(row=>row.users?.has_submitted_portfolio)
        .map(mapPortfolioFromSupabase);
      setPortfolios(pfs);
      await refreshLivePrices(pfs);
    }

    // S&P 500 benchmark history (cached server-side). Non-blocking failure: if
    // unavailable, the benchmark simply doesn't render.
    fetchStockHistory("SPY").then(h=>setSpyHist(h&&h.length?h:null)).catch(()=>{});

    let submitted=false;
    if(mn?.trim()){
      const { data: userRow, error: userError }=await supabase
        .from("users")
        .select("has_submitted_portfolio")
        .ilike("telegram_name", mn.trim())
        .maybeSingle();
      if(!userError&&userRow) submitted=userRow.has_submitted_portfolio===true;
    }
    setHasSubmitted(submitted);
    setLoading(false);
  },[refreshLivePrices]);

  useEffect(()=>{ load(); },[load]);

  // Entrada discreta para a área de admin: abrir a app com #admin no URL
  // (ex.: localhost:3000/#admin). Continua protegida pela palavra-passe.
  useEffect(()=>{
    const applyHash=()=>{ if(window.location.hash==="#admin") setPage("admin"); };
    applyHash();
    window.addEventListener("hashchange",applyHash);
    return()=>window.removeEventListener("hashchange",applyHash);
  },[]);

  const myPf=useMemo(()=>{
    if(!myName) return null;
    const n=norm(myName);
    return portfolios.find(p=>p.normName===n)||null;
  },[myName,portfolios]);

  const submitted=hasSubmitted;

  const ranking=useMemo(()=>
    portfolios.map(p=>({...p,...pfStats(p,livePrices)})).sort((a,b)=>b.total-a.total)
  ,[portfolios,livePrices]);

  // S&P 500 benchmark — alinhado no tempo: "se tivesses metido no SPY em vez das
  // 8 ações, no mesmo período". Usa o preço do SPY AGORA (ao vivo) vs o preço do
  // SPY NO MOMENTO da submissão (guardado em spy_initial_price). Para portefólios
  // antigos sem esse valor, recorre ao histórico (fecho na data de submissão).
  const spy=useMemo(()=>{
    const now=(livePrices&&typeof livePrices.SPY==="number")?livePrices.SPY:null;
    if(now==null) return null;
    const closeOnOrBefore=iso=>{
      if(!spyHist||!spyHist.length) return null;
      const d=(iso||"").slice(0,10);
      let v=null;
      for(const p of spyHist){ if(p.date<=d) v=p.close; else break; }
      return v??spyHist[0].close;
    };
    const returnFor=pf=>{
      const base=(pf&&typeof pf.spyInitialPrice==="number"&&pf.spyInitialPrice>0)
        ? pf.spyInitialPrice
        : closeOnOrBefore(pf?.submittedAt);
      if(base==null||!base) return null;
      return now/base-1;
    };
    return { now, returnFor };
  },[livePrices,spyHist]);

  async function doSubmit(name,stocks){
    // All validation + the authoritative price snapshot happen server-side
    // (/api/portfolio/submit) using the service_role key — the browser never
    // writes to the database directly, so initial_price can't be forged.
    const trimmedName=name.trim();
    if(!trimmedName) return{error:"Escreve o teu nome."};
    let res,data;
    try{
      res=await fetch("/api/portfolio/submit",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name:trimmedName, stocks:stocks.map(s=>({ticker:s.ticker,name:s.name,side:s.side==="short"?"short":"long"})) }),
      });
      data=await res.json();
    }catch{
      return{error:"Falha de ligação. Tenta novamente."};
    }
    if(!res.ok||!data?.ok) return{error:data?.error||"Não foi possível submeter o portefólio."};

    sset(K.MYNAME, trimmedName);
    setMyName(trimmedName);
    await load();
    setHasSubmitted(true);
    setPage("ranking");
    return{ok:true};
  }

  // Returning member with no local identity (closed window, cleared storage,
  // other device): re-identify by Telegram name against Supabase. No password —
  // the name already is the unique, validated identity.
  async function recoverByName(rawName){
    const name=(rawName||"").trim();
    if(!name) return{error:"Escreve o teu nome."};
    const { data, error }=await supabase
      .from("users")
      .select("telegram_name, has_submitted_portfolio")
      .ilike("telegram_name", name)
      .maybeSingle();
    if(error) return{error:"Não foi possível verificar o nome. Tenta novamente."};
    if(!data||data.has_submitted_portfolio!==true)
      return{error:"Não encontrámos um portefólio submetido com esse nome."};
    sset(K.MYNAME, data.telegram_name);
    setMyName(data.telegram_name);
    setHasSubmitted(true);
    setPage("ranking");
    return{ok:true};
  }

  const nav=(p)=>setPage(p);

  if(loading) return(
    <div style={{minHeight:"100vh",
      background:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",
      backgroundAttachment:"fixed",
      display:"flex",alignItems:"center",justifyContent:"center",color:"#4b5563",fontFamily:"system-ui,sans-serif"}}>
      <style>{`@keyframes cdiPulse{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
      <img src="/logo.png" alt="A carregar…"
        style={{width:"clamp(96px,16vw,140px)",height:"auto",animation:"cdiPulse 1.4s ease-in-out infinite"}}/>
    </div>
  );

  const sh=(children)=><Shell page={page} nav={nav} submitted={submitted} toast={toast}>{children}</Shell>;

  if(page==="home")   return sh(<Home nav={nav} submitted={submitted} count={portfolios.length} settings={settings} ranking={ranking} livePrices={livePrices}/>);
  if(page==="create") return sh(submitted?<AlreadySubmitted nav={nav} name={myName}/>:<Create settings={settings} doSubmit={doSubmit} onDone={()=>nav("ranking")} showToast={showToast}/>);
  if(page==="confirm")return sh(<Confirm nav={nav} name={myName}/>);
  if(page==="ranking")return sh(submitted?<Ranking ranking={ranking} myNorm={norm(myName)} pricesLoading={pricesLoading} spy={spy} onSelect={(k)=>{setDetailKey(k);nav("detail");}} onCompare={(a,b)=>{setDuelKeys([a,b]);nav("duel");}}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="duel")   return sh(submitted?<Duel a={ranking.find(p=>p.key===duelKeys?.[0])} b={ranking.find(p=>p.key===duelKeys?.[1])} livePrices={livePrices} spy={spy} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="detail") return sh(submitted?<Detail pf={portfolios.find(p=>p.key===detailKey)||myPf} rank={(()=>{const k=(portfolios.find(p=>p.key===detailKey)||myPf)?.key; const i=ranking.findIndex(r=>r.key===k); return i>=0?i+1:0;})()} livePrices={livePrices} dayChange={dayChange} spy={spy} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="admin")  return sh(<Admin settings={settings} setSettings={setSettings} portfolios={portfolios} ranking={ranking} livePrices={livePrices} reload={load} showToast={showToast}/>);
  return null;
}

/* ---- Shell --------------------------------------------------------------- */
function Shell({children,page,nav,submitted,toast}){
  return(
    <div style={{minHeight:"100vh",
      background:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",
      backgroundAttachment:"fixed",
      color:"#e2e8f0",fontFamily:"system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",overflowX:"hidden"}}>
      <MarketStatus/>
      <Nav page={page} nav={nav} submitted={submitted} />
      <main>{children}</main>
      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:9999,
          background:toast.kind==="error"?"#1a0a0a":"#0a1a0f",border:`1px solid ${toast.kind==="error"?"#ef4444":"#22c55e"}`,
          borderRadius:12,padding:"12px 20px",fontSize:14,color:toast.kind==="error"?"#fca5a5":"#86efac",
          whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
          {toast.kind==="error"?"⚠ ":""}{toast.msg}
        </div>
      )}
    </div>
  );
}

/* ---- Indicador de estado do mercado -------------------------------------- */
function MarketStatus(){
  const [st,setSt]=useState(null); // null no servidor → evita mismatch SSR
  useEffect(()=>{
    setSt(marketStatus());
    const id=setInterval(()=>setSt(marketStatus()),1000);
    return()=>clearInterval(id);
  },[]);
  if(!st) return null;
  const c=st.open?"#34d399":"#f87171";
  return(
    <div style={{position:"fixed",top:12,right:14,zIndex:60}}>
      <style>{`
        @keyframes mktPulse{0%{box-shadow:0 0 8px var(--mk),0 0 0 0 var(--mk)}70%{box-shadow:0 0 8px var(--mk),0 0 0 6px transparent}100%{box-shadow:0 0 8px var(--mk),0 0 0 0 transparent}}
        @media(max-width:480px){.mktLabel{display:none}}
      `}</style>
      <div title={st.label} style={{display:"inline-flex",alignItems:"center",gap:9,
        padding:"6px 13px 6px 11px",borderRadius:999,
        background:"rgba(255,255,255,0.05)",backdropFilter:"blur(18px) saturate(170%)",WebkitBackdropFilter:"blur(18px) saturate(170%)",
        border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10)"}}>
        <span style={{"--mk":`${c}90`,width:8,height:8,borderRadius:"50%",background:c,flexShrink:0,
          boxShadow:`0 0 8px ${c}`,animation:st.open?"mktPulse 2s ease-out infinite":"none"}}/>
        <span className="mktLabel" style={{fontSize:12,fontWeight:600,color:"#cbd5e1",letterSpacing:"0.2px",whiteSpace:"nowrap"}}>{st.label}</span>
        <span style={{fontSize:11,fontWeight:600,fontFamily:"monospace",color:"#64748b",whiteSpace:"nowrap"}}>
          {st.et} ET
        </span>
      </div>
    </div>
  );
}

/* ---- Nav ----------------------------------------------------------------- */
function Nav({page,nav,submitted}){
  return(
    <div style={{position:"sticky",top:0,zIndex:50,padding:"14px 12px 0",display:"flex",justifyContent:"center",gap:6}}>
      <NavLink label="Início" active={page==="home"} onClick={()=>nav("home")}/>
      <NavLink label="Ranking" active={page==="ranking"} onClick={()=>nav("ranking")} locked={!submitted}/>
      <NavLink label="Criar Portefólio" active={page==="create"} onClick={()=>nav("create")}/>
    </div>
  );
}
// Plain text link; only the page we're on gets the liquid-glass pill.
function NavLink({label,active,onClick,locked}){
  return(
    <button onClick={onClick}
      onMouseEnter={e=>{ if(!active) e.currentTarget.style.color="#e2e8f0"; }}
      onMouseLeave={e=>{ if(!active) e.currentTarget.style.color="#9aa4b2"; }}
      style={{cursor:"pointer",fontSize:14,fontWeight:active?600:500,padding:"8px 16px",borderRadius:999,
        color:active?"#e2e8f0":"#9aa4b2",
        background:active?"rgba(255,255,255,0.08)":"transparent",
        backdropFilter:active?"blur(16px) saturate(180%)":"none",
        WebkitBackdropFilter:active?"blur(16px) saturate(180%)":"none",
        border:`1px solid ${active?"rgba(255,255,255,0.14)":"transparent"}`,
        boxShadow:active?"0 4px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.16)":"none",
        transition:"color 0.15s",display:"flex",alignItems:"center",gap:4}}>
      {label}{locked&&<span style={{fontSize:10,opacity:0.5}}>🔒</span>}
    </button>
  );
}

/* ---- Home: liga ao vivo -------------------------------------------------- */

function WinnersGrid({top,livePrices,nav}){
  const [seriesById,setSeriesById]=useState({});
  useEffect(()=>{
    let cancel=false;
    const ids=top.map(p=>p.id).filter(Boolean);
    if(!ids.length) return;
    (async()=>{
      const { data }=await supabase
        .from("portfolio_snapshots").select("portfolio_id,date,total_return")
        .in("portfolio_id",ids).order("date",{ascending:true});
      if(cancel) return;
      const m={};
      (data||[]).forEach(r=>{ (m[r.portfolio_id]=m[r.portfolio_id]||[]).push({date:r.date,r:Number(r.total_return)}); });
      setSeriesById(m);
    })();
    return()=>{ cancel=true; };
  },[top]);
  const main=top.slice(0,4);
  const peek=top[4]; // 5º lugar — "espreitado" no desktop para dar continuidade
  return(
    <>
      <style>{`
        .cdiWinners{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr))}
        .cdiPeek{display:none}
        @media(min-width:769px){
          .cdiWinners.has-peek{grid-template-columns:repeat(4,minmax(0,1fr)) minmax(0,0.42fr)}
          .cdiPeek{display:block;overflow:hidden;cursor:pointer;
            -webkit-mask-image:linear-gradient(to right,#000 30%,transparent 95%);
            mask-image:linear-gradient(to right,#000 30%,transparent 95%);
            filter:blur(1.5px);opacity:0.5}
          .cdiPeek>div{width:260px}
        }
        @media(max-width:768px){.cdiWinners{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>
      <div className={`cdiWinners${peek?" has-peek":""}`}>
        {main.map((p,i)=>(
          <WinnerCard key={p.key} p={p} rank={i+1} livePrices={livePrices}
            series={seriesById[p.id]||[]} onClick={()=>nav("ranking")}/>
        ))}
        {peek&&(
          <div className="cdiPeek" onClick={()=>nav("ranking")} aria-hidden="true">
            <div>
              <WinnerCard p={peek} rank={5} livePrices={livePrices} series={seriesById[peek.id]||[]} onClick={()=>nav("ranking")}/>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const RANK_BADGE={
  1:{background:"linear-gradient(145deg,#fde68a,#f59e0b)",color:"#3a2800",boxShadow:"0 3px 12px rgba(245,158,11,0.45)"},
  2:{background:"linear-gradient(145deg,#f8fafc,#94a3b8)",color:"#1e293b",boxShadow:"0 3px 10px rgba(148,163,184,0.3)"},
  3:{background:"linear-gradient(145deg,#fcd9a8,#b45309)",color:"#2e1800",boxShadow:"0 3px 10px rgba(180,83,9,0.3)"},
};
function WinnerCard({p,rank,livePrices,series,onClick}){
  const up=p.total>=0;
  const col=up?"#34d399":"#fb7185";
  const isTop=rank===1;
  const baseShadow=isTop
    ? "0 10px 36px rgba(0,0,0,0.35), 0 0 0 1px rgba(251,191,36,0.18), inset 0 1px 0 rgba(255,255,255,0.14)"
    : "0 10px 36px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10)";
  const badge=RANK_BADGE[rank]||{background:"rgba(255,255,255,0.06)",color:"#94a3b8",border:"1px solid rgba(255,255,255,0.14)"};
  return(
    <div onClick={onClick}
      onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=isTop?"0 18px 46px rgba(251,191,36,0.16), 0 0 0 1px rgba(251,191,36,0.32), inset 0 1px 0 rgba(255,255,255,0.16)":"0 18px 46px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow=baseShadow; }}
      style={{cursor:"pointer",borderRadius:22,padding:22,
        background:isTop
          ? "linear-gradient(160deg, rgba(251,191,36,0.12) 0%, rgba(255,255,255,0.045) 38%, rgba(255,255,255,0.025) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.028) 100%)",
        backdropFilter:"blur(22px) saturate(170%)",WebkitBackdropFilter:"blur(22px) saturate(170%)",
        border:`1px solid ${isTop?"rgba(251,191,36,0.38)":"rgba(255,255,255,0.10)"}`,
        boxShadow:baseShadow,transition:"transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <div style={{width:34,height:34,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:14,fontWeight:800,...badge}}>{rank}</div>
        <span style={{fontWeight:700,fontSize:17,letterSpacing:"-0.4px",flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</span>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:18}}>
        <span style={{fontSize:13,color:col}}>{up?"▲":"▼"}</span>
        <span style={{fontFamily:"'SF Mono',ui-monospace,monospace",fontWeight:800,fontSize:30,letterSpacing:"-1.5px",color:col}}>
          {pct(Math.abs(p.total)).replace(/[+-]/,"")}
        </span>
        <span style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",marginLeft:"auto"}}>rentab. média</span>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {p.stocks.map(s=>{ const g=stockRet(s,livePrices)>=0; return(
          <span key={s.ticker} title={s.ticker} style={{flex:1,height:6,borderRadius:999,
            background:g?"linear-gradient(180deg,#34d399,#10b981)":"linear-gradient(180deg,#fb7185,#ef4444)",
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.25)"}}/>
        ); })}
      </div>
      <MiniSparkline series={series} current={p.total}/>
    </div>
  );
}

function MiniSparkline({series,current}){
  const uid=useId();
  const today=new Date().toISOString().slice(0,10);
  const pts=(series||[]).map(s=>({date:s.date,r:s.r}));
  if(typeof current==="number"){
    if(pts.length&&pts[pts.length-1].date===today) pts[pts.length-1].r=current;
    else pts.push({date:today,r:current});
  }
  const isEx=pts.length<2;
  const drawn=isEx?[0,0.004,-0.002,0.006,0.003,0.009,0.007,0.013].map(r=>({r})):pts;
  const W=300,H=52,P=4;
  const vals=drawn.map(p=>p.r).concat([0]);
  let min=Math.min(...vals),max=Math.max(...vals);
  if(min===max){ min-=0.01; max+=0.01; }
  const pad=(max-min)*0.18; min-=pad; max+=pad;
  const x=i=>P+(i/(drawn.length-1))*(W-2*P);
  const y=v=>P+(1-(v-min)/(max-min))*(H-2*P);
  // Smooth curve (Catmull-Rom → cubic Bézier) for an organic line.
  const pts2=drawn.map((p,i)=>[x(i),y(p.r)]);
  let line=`M${pts2[0][0].toFixed(1)},${pts2[0][1].toFixed(1)}`;
  for(let i=0;i<pts2.length-1;i++){
    const p0=pts2[i-1]||pts2[i],p1=pts2[i],p2=pts2[i+1],p3=pts2[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6,c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6,c2y=p2[1]-(p3[1]-p1[1])/6;
    line+=` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area=`${line} L${x(drawn.length-1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last=drawn[drawn.length-1].r;
  const col=isEx?"#64748b":(last>=0?"#34d399":"#fb7185");
  const gid=`spk-${uid}`;
  return(
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:48,display:"block",opacity:isEx?0.55:1}}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={isEx?0.16:0.32}/>
          <stop offset="100%" stopColor={col} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`}/>
      <path d={line} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray={isEx?"5 4":undefined} vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

function Home({nav,submitted,count,settings,ranking,livePrices}){
  return(
    <div>
      {/* Hero */}
      <section style={{textAlign:"center",padding:"100px 24px 80px",maxWidth:780,margin:"0 auto"}}>
        <img src="/logo.png" alt="Conversas de Investidores"
          style={{display:"block",width:"clamp(120px,18vw,180px)",height:"auto",margin:"0 auto 32px"}}/>
        <h1 style={{fontSize:"clamp(40px,6vw,72px)",fontWeight:800,lineHeight:1.1,letterSpacing:"-2px",margin:"0 0 24px"}}>
          Conversas de{" "}
          <span style={{color:"#22c55e"}}>Investidores</span>
        </h1>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(34,197,94,0.1)",
          border:"1px solid rgba(34,197,94,0.25)",borderRadius:999,padding:"6px 16px",fontSize:13,
          color:"#4ade80",marginBottom:24}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",display:"inline-block"}}/>
          Jogo ativo — Submissões {settings?.submissionsOpen?"abertas":"fechadas"}
        </div>
        <p style={{fontSize:18,color:"#6b7280",lineHeight:1.6,maxWidth:560,margin:"0 auto 40px"}}>
          O jogo de portefólios da nossa comunidade. Escolhe as tuas 8 ações,
          submete o teu portefólio e compete com os outros membros pelo melhor retorno.
        </p>
        <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          {submitted?(
            <>
              <Btn onClick={()=>nav("ranking")} primary>Ver Ranking</Btn>
              <Btn onClick={()=>nav("create")}>O meu portefólio</Btn>
            </>
          ):(
            <>
              <Btn onClick={()=>nav("create")} primary>Criar o Meu Portefólio</Btn>
              <Btn onClick={()=>nav("ranking")}>Ver Ranking 🔒</Btn>
            </>
          )}
        </div>
        {count>0&&<p style={{marginTop:20,fontSize:13,color:"#374151"}}>{count} {count===1?"portefólio":"portefólios"} já submetidos</p>}
      </section>

      {/* Liga ao vivo — vencedores */}
      {ranking&&ranking.length>0&&(
        <section style={{maxWidth:1120,margin:"0 auto",padding:"0 24px 80px"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:7,background:"rgba(239,68,68,0.12)",
              border:"1px solid rgba(239,68,68,0.3)",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:700,color:"#f87171",letterSpacing:"0.5px"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",display:"inline-block"}}/>AO VIVO
            </span>
          </div>
          <WinnersGrid top={ranking.slice(0,5)} livePrices={livePrices} nav={nav}/>
        </section>
      )}

      {/* Como funciona */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <h2 style={{textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:40}}>Como funciona</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {n:"01",icon:"✏️",t:"Insere o teu nome",d:"Usa exatamente o mesmo nome que tens no grupo de Telegram da comunidade."},
            {n:"02",icon:"🔍",t:"Escolhe 8 ações",d:"Pesquisa por ticker ou nome da empresa. Tens de selecionar exatamente 8 ações."},
            {n:"03",icon:"🚀",t:"Submete o portefólio",d:"Depois da submissão, tens acesso ao ranking completo e aos portefólios dos outros."},
          ].map(c=>(
            <div key={c.n} style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:16,right:20,fontSize:36,fontWeight:800,color:"#1f2937",lineHeight:1}}>{c.n}</div>
              <div style={{fontSize:28,marginBottom:16}}>{c.icon}</div>
              <h3 style={{fontSize:17,fontWeight:700,marginBottom:8,letterSpacing:"-0.3px"}}>{c.t}</h3>
              <p style={{fontSize:14,color:"#6b7280",lineHeight:1.6,margin:0}}>{c.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Regras */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <div style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:40}}>
          <h2 style={{fontSize:22,fontWeight:700,marginBottom:28,letterSpacing:"-0.3px",textAlign:"center"}}>Regras do Jogo</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"12px 40px"}}>
            {[
              "Cada participante cria exatamente 1 portefólio com 8 ações",
              "Cada ação representa 12,5% do portefólio (peso igual)",
              "Podes abrir até 2 posições short",
              "O preço de cada ação é registado no momento da submissão",
              "Não podes ver os outros portefólios antes de submeter o teu",
              "Depois de submetido, o portefólio fica bloqueado",
              "O ranking é atualizado automaticamente com os preços atuais",
              "A rentabilidade é calculada como a média das 8 ações",
            ].map((r,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12}}>
                <span style={{color:"#22c55e",fontWeight:700,marginTop:1,flexShrink:0}}>✓</span>
                <span style={{fontSize:14,color:"#9ca3af",lineHeight:1.5}}>{r}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      {!submitted&&(
        <section style={{maxWidth:700,margin:"0 auto",padding:"0 24px 100px"}}>
          <div style={{background:"linear-gradient(135deg,#0d1f12,#0a1520)",border:"1px solid rgba(34,197,94,0.2)",
            borderRadius:20,padding:"48px 40px",textAlign:"center"}}>
            <h2 style={{fontSize:26,fontWeight:700,marginBottom:8,letterSpacing:"-0.5px"}}>Pronto para competir?</h2>
            <p style={{fontSize:15,color:"#6b7280",marginBottom:28}}>Junta-te à comunidade e mostra quem escolhe as melhores ações.</p>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <Btn onClick={()=>nav("create")} primary large>Criar Portefólio Agora</Btn>
              <a href="https://www.patreon.com/cw/Conversasdeinvestidores" target="_blank" rel="noopener noreferrer"
                onMouseEnter={e=>{e.currentTarget.style.filter="brightness(1.08)";e.currentTarget.style.transform="translateY(-1px)";}}
                onMouseLeave={e=>{e.currentTarget.style.filter="none";e.currentTarget.style.transform="none";}}
                style={{display:"inline-flex",alignItems:"center",justifyContent:"center",textDecoration:"none",
                  background:"linear-gradient(180deg,#3b82f6,#2563eb)",color:"#fff",border:"1px solid rgba(255,255,255,0.25)",
                  borderRadius:12,padding:"14px 28px",fontSize:16,fontWeight:700,letterSpacing:"-0.2px",
                  boxShadow:"0 2px 14px rgba(37,99,235,0.4), inset 0 1px 0 rgba(255,255,255,0.3)",
                  transition:"transform 0.15s, filter 0.15s"}}>
                Junta-te à Comunidade
              </a>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---- Create -------------------------------------------------------------- */
function Create({settings,doSubmit,onDone,showToast}){
  const [step,setStep]=useState(1); // 1=name 2=stocks
  const [name,setName]=useState("");
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [picked,setPicked]=useState([]);
  const [submitting,setSubmitting]=useState(false);
  const [addingManual,setAddingManual]=useState(false);
  const [shortMode,setShortMode]=useState(false); // próxima posição: false=long, true=short
  const shortCount=picked.filter(p=>p.side==="short").length;

  useEffect(()=>{
    const q=query.trim();
    if(q.length<1){ setResults([]); setSearching(false); return; }
    // Marca já como "a pesquisar" para o aviso de "sem sugestões" não aparecer
    // enquanto se escreve (durante o debounce e entre teclas).
    setSearching(true);
    let cancelled=false;
    const timer=setTimeout(async()=>{
      try{
        const r=await searchTickers(q);
        if(!cancelled) setResults(r);
      }catch{
        if(!cancelled) setResults([]);
      }finally{
        if(!cancelled) setSearching(false);
      }
    },400);
    return()=>{ cancelled=true; clearTimeout(timer); };
  },[query]);

  const noResults=query.trim().length>=2&&!searching&&results.length===0;
  const has=t=>picked.some(p=>p.ticker===t);
  const add=s=>{
    if(picked.length>=PORTFOLIO_SIZE||has(s.ticker)) return;
    const side=shortMode?"short":"long";
    if(side==="short"&&shortCount>=MAX_SHORTS){
      showToast(`Máximo de ${MAX_SHORTS} posições short.`,"error");
      return;
    }
    setPicked(p=>[...p,{...s,side}]);
    setQuery("");
    setShortMode(false); // volta automaticamente a long
  };
  const addManual=async()=>{
    if(addingManual||picked.length>=PORTFOLIO_SIZE) return;
    const ticker=query.trim().toUpperCase();
    if(!TICKER_RE.test(ticker)){
      showToast("Ticker inválido. Usa letras, números, ponto ou hífen (ex: AAPL, MC.PA).","error");
      return;
    }
    if(shortMode&&shortCount>=MAX_SHORTS){
      showToast(`Máximo de ${MAX_SHORTS} posições short.`,"error");
      return;
    }
    if(has(ticker)){ setQuery(""); return; }
    // Só adiciona se o ticker existir mesmo (tiver cotação) — caso contrário a
    // rentabilidade nunca poderia ser calculada. A própria cotação devolve o
    // nome completo e a bolsa, por isso funciona para qualquer ticker.
    setAddingManual(true);
    const info=await fetchStockInfo(ticker);
    setAddingManual(false);
    if(info==null){
      showToast(`Não encontrámos cotação para "${ticker}". Verifica o ticker (ex.: AAPL, MC.PA, GALP.LS).`,"error");
      return;
    }
    add({ ticker, name: info.name||ticker, exchange: info.exchange||"", currency: info.currency||"USD" });
  };
  const rem=t=>setPicked(p=>p.filter(s=>s.ticker!==t));
  const progress=picked.length/PORTFOLIO_SIZE;
  const submClosed=settings&&!settings.submissionsOpen;

  async function submit(){
    if(picked.length!==PORTFOLIO_SIZE||!name.trim()||submitting) return;
    setSubmitting(true);
    const r=await doSubmit(name,picked);
    setSubmitting(false);
    if(r.error){ showToast(r.error,"error"); return; }
    onDone();
  }

  return(
    <div style={{maxWidth:680,margin:"0 auto",padding:"40px 20px 80px"}}>
      <h1 style={{textAlign:"center",fontSize:32,fontWeight:800,letterSpacing:"-1px",marginBottom:8}}>Criar Portefólio</h1>
      <p style={{textAlign:"center",color:"#6b7280",marginBottom:40,fontSize:15}}>Escolhe as tuas 8 ações e entra no jogo</p>

      {/* Stepper */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:40}}>
        <StepDot n={1} active={step===1} done={step>1} label="O teu nome"/>
        <div style={{flex:1,maxWidth:80,height:1,background:step>1?"#22c55e":"#1f2937"}}/>
        <StepDot n={2} active={step===2} done={false} label="Escolher ações"/>
      </div>

      {submClosed&&(
        <div style={{background:"#1a1200",border:"1px solid rgba(251,191,36,0.3)",borderRadius:12,padding:"12px 16px",
          fontSize:14,color:"#fbbf24",marginBottom:20}}>
          🔒 As submissões estão fechadas de momento.
        </div>
      )}

      {/* Step 1 — nome */}
      {step===1&&(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:32}}>
          <h2 style={{fontSize:18,fontWeight:700,marginBottom:6}}>O teu nome no Telegram</h2>
          <p style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Escreve exatamente o mesmo nome que aparece no grupo de Telegram da comunidade.</p>
          <input value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&name.trim().length>=2) setStep(2); }}
            placeholder="Ex: João Silva"
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:`1px solid ${name.trim().length>=2?"#22c55e":"#1f2937"}`,
              borderRadius:10,padding:"14px 16px",fontSize:16,color:"#e2e8f0",outline:"none",
              boxSizing:"border-box",transition:"border-color 0.2s"}}/>
          <button onClick={()=>{ if(name.trim().length>=2) setStep(2); }}
            disabled={name.trim().length<2||submClosed}
            style={{width:"100%",marginTop:16,background:name.trim().length>=2&&!submClosed?"#22c55e":"#1f2937",
              color:name.trim().length>=2&&!submClosed?"#000":"#4b5563",border:"none",borderRadius:10,
              padding:"14px",fontSize:16,fontWeight:700,cursor:name.trim().length>=2?"pointer":"not-allowed",
              transition:"background 0.2s"}}>
            Continuar →
          </button>
        </div>
      )}

      {/* Step 2 — ações */}
      {step===2&&(
        <>
          {/* Progresso */}
          <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
              <span style={{fontWeight:600}}>Ações selecionadas</span>
              <span style={{fontSize:22,fontWeight:800,letterSpacing:"-1px"}}>
                <span style={{color:"#22c55e"}}>{picked.length}</span>
                <span style={{color:"#374151",fontSize:16}}> / {PORTFOLIO_SIZE}</span>
              </span>
            </div>
            <div style={{height:6,background:"#1f2937",borderRadius:999,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress*100}%`,background:"linear-gradient(90deg,#3b82f6,#22c55e)",
                borderRadius:999,transition:"width 0.3s"}}/>
            </div>
            {picked.length<PORTFOLIO_SIZE&&(
              <p style={{marginTop:8,fontSize:13,color:"#4b5563"}}>Faltam {PORTFOLIO_SIZE-picked.length} {PORTFOLIO_SIZE-picked.length===1?"ação":"ações"}</p>
            )}
            {picked.length===PORTFOLIO_SIZE&&(
              <p style={{marginTop:8,fontSize:13,color:"#22c55e",fontWeight:600}}>✓ Portefólio completo — pronto para submeter!</p>
            )}
          </div>

          {/* Submeter — ocupa o lugar da pesquisa quando o portefólio está completo */}
          {picked.length===PORTFOLIO_SIZE&&(
            <button onClick={submit}
              disabled={submitting||submClosed}
              style={{width:"100%",marginBottom:16,background:!submClosed?"#22c55e":"#1f2937",
                color:!submClosed?"#000":"#4b5563",border:"none",borderRadius:16,padding:"24px",
                fontSize:16,fontWeight:700,cursor:!submClosed?"pointer":"not-allowed",transition:"background 0.2s"}}>
              {submitting?"A submeter…":submClosed?"Submissões encerradas":"Submeter Portefólio"}
            </button>
          )}

          {/* Pesquisa — escondida quando já há 8 ações */}
          {picked.length<PORTFOLIO_SIZE&&(
          <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              <h3 style={{fontSize:15,fontWeight:600,margin:0}}>Pesquisar ação</h3>
              <div style={{display:"flex",gap:6,background:"rgba(0,0,0,0.25)",borderRadius:10,padding:3}}>
                <button onClick={()=>setShortMode(false)}
                  style={{border:"none",cursor:"pointer",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,
                    background:!shortMode?"rgba(34,197,94,0.18)":"transparent",color:!shortMode?"#4ade80":"#6b7280"}}>
                  Long
                </button>
                <button onClick={()=>{ if(shortCount<MAX_SHORTS) setShortMode(true); else showToast(`Máximo de ${MAX_SHORTS} posições short.`,"error"); }}
                  style={{border:"none",cursor:"pointer",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,
                    background:shortMode?"rgba(245,158,11,0.2)":"transparent",color:shortMode?"#fbbf24":"#6b7280"}}>
                  Short
                </button>
              </div>
            </div>
            {shortMode&&(
              <p style={{margin:"0 0 12px",fontSize:12,color:"#fbbf24"}}>
                Short - máximo 2 posições.
              </p>
            )}
            <div style={{display:"flex",gap:8}}>
              <input value={query} onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{
                  if(e.key!=="Enter") return;
                  // Enter assume a 1ª sugestão; só recorre ao ticker manual se não houver sugestões.
                  const first=results.find(s=>!has(s.ticker));
                  if(first) add(first); else addManual();
                }}
                placeholder="Pesquisa por ticker (ex: AAPL) ou nome da empresa"
                disabled={picked.length>=PORTFOLIO_SIZE}
                style={{flex:1,background:"rgba(0,0,0,0.18)",border:`1px solid ${shortMode?"#f59e0b":query.length>=1?"#22c55e":"#1f2937"}`,
                  borderRadius:10,padding:"12px 16px",fontSize:14,color:"#e2e8f0",outline:"none",
                  boxSizing:"border-box",transition:"border-color 0.2s",
                  opacity:picked.length>=PORTFOLIO_SIZE?0.5:1}}/>
              <button onClick={addManual} disabled={picked.length>=PORTFOLIO_SIZE||!query.trim()||addingManual}
                style={{background:shortMode?"#2a2010":"#1a2a1a",border:`1px solid ${shortMode?"rgba(245,158,11,0.4)":"rgba(34,197,94,0.3)"}`,borderRadius:10,
                  padding:"0 16px",fontSize:13,color:shortMode?"#fbbf24":"#4ade80",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap",
                  opacity:picked.length>=PORTFOLIO_SIZE||!query.trim()||addingManual?0.5:1}}>
                {addingManual?"A verificar…":shortMode?"Adicionar short":"Adicionar"}
              </button>
            </div>

            {searching&&(
              <p style={{marginTop:12,fontSize:13,color:"#6b7280"}}>A pesquisar…</p>
            )}

            {noResults&&(
              <p style={{marginTop:12,fontSize:13,color:"#f59e0b"}}>
                ⚠ Nenhuma sugestão para "{query}". Podes adicionar o ticker manualmente.
              </p>
            )}

            {results.length>0&&(
              <ul style={{margin:"10px 0 0",padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:4}}>
                {results.map(s=>{
                  const already=has(s.ticker);
                  return(
                    <li key={`${s.ticker}-${s.exchange}`} onClick={()=>!already&&add(s)}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        background:already?"rgba(34,197,94,0.12)":"rgba(0,0,0,0.18)",
                        border:`1px solid ${already?"#166534":"#1f2937"}`,
                        borderRadius:10,padding:"10px 14px",cursor:already?"default":"pointer",
                        transition:"border-color 0.15s",opacity:already?0.7:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                        <StockLogo ticker={s.ticker} size={26}/>
                        <span style={{fontWeight:800,fontSize:13,letterSpacing:"0.5px",minWidth:64,color:"#e2e8f0"}}>{s.ticker}</span>
                        <span style={{fontSize:13,color:"#9ca3af",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                        <span style={{fontSize:12,color:"#4b5563"}}>{s.exchange||s.type}</span>
                        {already
                          ?<span style={{fontSize:18,color:"#22c55e"}}>✓</span>
                          :<span style={{width:24,height:24,borderRadius:6,background:"#1a2a1a",border:"1px solid #22c55e",
                            display:"flex",alignItems:"center",justifyContent:"center",color:"#22c55e",fontSize:16,fontWeight:700}}>+</span>
                        }
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          )}

          {/* Portfolio */}
          {picked.length>0&&(
            <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,marginBottom:16}}>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>O teu portefólio</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[...picked].reverse().map(s=>(
                  <div key={s.ticker} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <StockLogo ticker={s.ticker} size={32}/>
                      <span style={{fontWeight:800,fontSize:13,minWidth:56,color:"#e2e8f0"}}>{s.ticker}</span>
                      <SideBadge side={s.side}/>
                      <div>
                        <div style={{fontSize:13,color:"#9ca3af"}}>{s.name}</div>
                        <div style={{fontSize:11,color:"#374151"}}>{s.exchange||"—"} · preço obtido na submissão</div>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,color:"#4b5563",fontWeight:600}}>12,5%</span>
                      <button onClick={()=>rem(s.ticker)}
                        style={{background:"none",border:"none",cursor:"pointer",color:"#374151",
                          padding:4,borderRadius:4,fontSize:16,lineHeight:1,
                          display:"flex",alignItems:"center",justifyContent:"center"}}
                        title="Remover">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </div>
  );
}

function StepDot({n,active,done,label}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:32,height:32,borderRadius:"50%",
        background:done?"#22c55e":active?"#fff":"#1f2937",
        border:done?"none":active?"none":"1px solid #374151",
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:14,fontWeight:700,color:done?"#000":active?"#000":"#4b5563",flexShrink:0}}>
        {done?"✓":n}
      </div>
      <span style={{fontSize:14,fontWeight:active||done?600:400,color:active||done?"#e2e8f0":"#4b5563"}}>{label}</span>
    </div>
  );
}

/* ---- AlreadySubmitted ---------------------------------------------------- */
function AlreadySubmitted({nav,name}){
  return(
    <div style={{maxWidth:500,margin:"80px auto",padding:"0 20px",textAlign:"center"}}>
      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Já tens um portefólio submetido</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:28}}>
          Submeteste como <strong style={{color:"#e2e8f0"}}>{name}</strong>. O portefólio fica bloqueado após a submissão — só um administrador o pode alterar.
        </p>
        <Btn onClick={()=>nav("ranking")} primary>Ver o ranking</Btn>
      </div>
    </div>
  );
}

/* ---- Confirm ------------------------------------------------------------- */
function Confirm({nav,name}){
  return(
    <div style={{maxWidth:520,margin:"80px auto",padding:"0 20px",textAlign:"center"}}>
      <div style={{background:"linear-gradient(135deg,#0a1a0f,#0d1520)",
        border:"1px solid rgba(34,197,94,0.3)",borderRadius:20,padding:56}}>
        <div style={{width:64,height:64,borderRadius:"50%",background:"#22c55e",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 20px"}}>✓</div>
        <h1 style={{fontSize:26,fontWeight:800,letterSpacing:"-0.5px",marginBottom:12}}>Portefólio submetido!</h1>
        <p style={{fontSize:15,color:"#6b7280",lineHeight:1.6,marginBottom:32}}>
          Obrigado, <strong style={{color:"#e2e8f0"}}>{name}</strong>. O teu portefólio está gravado e bloqueado.
          Já podes ver o ranking e os portefólios dos outros membros.
        </p>
        <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
          <Btn onClick={()=>nav("ranking")} primary>Ver Ranking</Btn>
          <Btn onClick={()=>nav("home")}>Início</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---- Locked gate --------------------------------------------------------- */
function LockedGate({nav,recoverByName,showToast}){
  const [name,setName]=useState("");
  const [busy,setBusy]=useState(false);
  async function recover(){
    if(busy) return;
    setBusy(true);
    const r=await recoverByName(name);
    setBusy(false);
    if(r?.error) showToast(r.error,"error");
  }
  return(
    <div style={{maxWidth:480,margin:"80px auto",padding:"0 20px",textAlign:"center"}}>
      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Área bloqueada</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:28}}>
          Só podes ver o ranking e os portefólios dos outros membros depois de submeteres o teu próprio portefólio de 8 ações.
        </p>
        <Btn onClick={()=>nav("create")} primary>Criar o meu portefólio</Btn>

        <div style={{marginTop:32,paddingTop:24,borderTop:"1px solid #1f2937"}}>
          <p style={{fontSize:13,color:"#6b7280",marginBottom:12}}>
            Já submeteste o teu portefólio? Escreve o teu nome do Telegram para voltares a aceder.
          </p>
          <div style={{display:"flex",gap:8}}>
            <input value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") recover(); }}
              placeholder="O teu nome no Telegram"
              style={{flex:1,background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
                padding:"11px 14px",fontSize:14,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
            <button onClick={recover} disabled={busy||!name.trim()}
              style={{background:"#1a2a1a",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,
                padding:"11px 18px",fontSize:14,color:"#4ade80",fontWeight:700,
                cursor:busy||!name.trim()?"default":"pointer",opacity:busy||!name.trim()?0.5:1,whiteSpace:"nowrap"}}>
              {busy?"A verificar…":"Ver ranking"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Ranking ------------------------------------------------------------- */
function Ranking({ranking,myNorm,pricesLoading,spy,onSelect,onCompare}){
  const medals=["🥇","🥈","🥉"];
  const [cmp,setCmp]=useState(false);
  const [sel,setSel]=useState([]);
  const toggleSel=k=>setSel(s=>s.includes(k)?s.filter(x=>x!==k):(s.length>=2?[s[1],k]:[...s,k]));
  const nameByKey=k=>ranking.find(p=>p.key===k)?.name||"";
  return(
    <div style={{maxWidth:900,margin:"0 auto",padding:"40px 20px 120px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
        <h1 style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",marginBottom:4}}>Ranking Geral</h1>
        {ranking.length>=2&&(
          <button onClick={()=>{ setCmp(v=>!v); setSel([]); }}
            style={{cursor:"pointer",fontSize:13,fontWeight:700,borderRadius:999,padding:"8px 16px",
              color:cmp?"#0a0a0a":"#cbd5e1",
              background:cmp?"#3b82f6":"rgba(255,255,255,0.06)",
              border:`1px solid ${cmp?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.12)"}`}}>
            1v1
          </button>
        )}
      </div>
      <p style={{color:"#4b5563",fontSize:14,marginBottom:28}}>
        Ordenado pela rentabilidade total em tempo real (preço atual vs. preço inicial). {ranking.length} {ranking.length===1?"participante":"participantes"}.
        {spy?" · Alpha = a tua rentabilidade menos a do S&P 500 no mesmo período (positivo = bates o mercado).":""}
        {pricesLoading?" · A atualizar preços de mercado…":""}
      </p>

      {ranking.length===0?(
        <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
          Ainda não há portefólios submetidos.
        </div>
      ):(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
          {/* Header */}
          <div style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 100px 64px 64px 110px",
            padding:"10px 20px",borderBottom:"1px solid #1f2937",
            fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
            <span>#</span><span>Membro</span>
            <span style={{textAlign:"right"}}>Rentab.</span>
            <span style={{textAlign:"right"}}>Alpha</span>
            <span style={{textAlign:"center"}}>Pos.</span>
            <span style={{textAlign:"center"}}>Neg.</span>
            <span style={{textAlign:"right"}}>Submissão</span>
          </div>
          {ranking.map((p,i)=>{
            const me=p.normName===myNorm;
            const spyRet=spy?spy.returnFor(p):null;
            const alpha=spyRet==null?null:p.total-spyRet;
            const picked=cmp&&sel.includes(p.key);
            const baseBg=picked?"rgba(59,130,246,0.16)":me?"rgba(34,197,94,0.04)":"transparent";
            return(
              <div key={p.key} onClick={()=>cmp?toggleSel(p.key):onSelect(p.key)}
                style={{display:"grid",gridTemplateColumns:"40px 1fr 100px 100px 64px 64px 110px",
                  padding:"14px 20px",borderBottom:"1px solid #0f172a",cursor:"pointer",
                  background:baseBg,
                  boxShadow:picked?"inset 3px 0 0 #3b82f6":"none",
                  transition:"background 0.15s"}}
                onMouseEnter={e=>{ if(!picked) e.currentTarget.style.background=me?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.05)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background=baseBg; }}>
                <span style={{fontSize:16}}>{medals[i]||<span style={{fontSize:13,color:"#374151",fontWeight:700}}>{i+1}</span>}</span>
                <span style={{fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8}}>
                  {p.name}
                  {me&&<span style={{fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",
                    borderRadius:999,padding:"2px 8px",fontWeight:700}}>Tu</span>}
                </span>
                <span style={{textAlign:"right",alignSelf:"center",fontWeight:800,fontFamily:"monospace",fontSize:15,color:p.total>=0?"#4ade80":"#f87171"}}>{pct(p.total)}</span>
                <span style={{textAlign:"right",alignSelf:"center",fontFamily:"monospace",fontSize:13,fontWeight:600,
                  color:alpha==null?"#4b5563":alpha>=0?"#4ade80":"#f87171"}}>{alpha==null?"—":`${alpha>=0?"+":""}${(alpha*100).toFixed(2)}%`}</span>
                <span style={{textAlign:"center",alignSelf:"center",color:"#4ade80",fontWeight:600,fontSize:14}}>{p.pos}</span>
                <span style={{textAlign:"center",alignSelf:"center",color:"#f87171",fontWeight:600,fontSize:14}}>{p.neg}</span>
                <span style={{textAlign:"right",alignSelf:"center",fontSize:12,color:"#4b5563"}}>{dt(p.submittedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
      <p style={{marginTop:12,fontSize:12,color:"#1f2937",textAlign:"right"}}>
        {cmp?"Seleciona 2 membros para comparar.":"Clica numa linha para ver as 8 ações."}
      </p>
      {cmp&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:70,
          display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:14,maxWidth:"92vw",
          background:"rgba(15,23,42,0.92)",backdropFilter:"blur(18px) saturate(170%)",WebkitBackdropFilter:"blur(18px) saturate(170%)",
          border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 12px 36px rgba(0,0,0,0.5)"}}>
          <span style={{fontSize:13,color:"#cbd5e1",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {sel.length===0?"Escolhe 2 membros…":sel.length===1?`${nameByKey(sel[0])} vs …`:`${nameByKey(sel[0])} vs ${nameByKey(sel[1])}`}
          </span>
          <button onClick={()=>sel.length===2&&onCompare(sel[0],sel[1])} disabled={sel.length!==2}
            style={{cursor:sel.length===2?"pointer":"not-allowed",border:"none",borderRadius:10,padding:"9px 18px",
              fontSize:14,fontWeight:700,whiteSpace:"nowrap",
              background:sel.length===2?"linear-gradient(180deg,#3b82f6,#2563eb)":"rgba(255,255,255,0.08)",
              color:sel.length===2?"#fff":"#64748b"}}>
            Ver
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Evolution chart -----------------------------------------------------
   Lê os snapshots diários (gravados pelo cron) e desenha a evolução da
   rentabilidade. Acrescenta o ponto "hoje" ao vivo para nunca ficar vazio.
   Enche-se ao longo dos dias à medida que o cron corre.
--------------------------------------------------------------------------- */
function EvolutionChart({portfolioId,currentReturn}){
  const [snaps,setSnaps]=useState(null);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      const { data }=await supabase
        .from("portfolio_snapshots")
        .select("date,total_return")
        .eq("portfolio_id",portfolioId)
        .order("date",{ascending:true});
      if(!cancel) setSnaps(data||[]);
    })();
    return()=>{ cancel=true; };
  },[portfolioId]);

  if(snaps===null) return <p style={{fontSize:13,color:"#4b5563",margin:0}}>A carregar evolução…</p>;

  const today=new Date().toISOString().slice(0,10);
  const series=snaps.map(s=>({date:s.date,r:Number(s.total_return)}));
  if(typeof currentReturn==="number"){
    if(series.length&&series[series.length-1].date===today) series[series.length-1].r=currentReturn;
    else series.push({date:today,r:currentReturn});
  }
  // Ainda não há histórico real (o jogo começou hoje). Mostra uma pré-visualização
  // de exemplo, claramente marcada, para se ver como vai ficar.
  const isExample=series.length<2;
  const drawn=isExample
    ? [0,0.006,-0.003,0.009,0.004,0.012,0.009,0.017].map((r,i)=>({date:`d${i}`,r}))
    : series;

  const W=800,H=160,P=8;
  const vals=drawn.map(p=>p.r).concat([0]);
  let min=Math.min(...vals),max=Math.max(...vals);
  if(min===max){ min-=0.01; max+=0.01; }
  const pad=(max-min)*0.1; min-=pad; max+=pad;
  const x=i=>P+(i/(drawn.length-1))*(W-2*P);
  const y=v=>P+(1-(v-min)/(max-min))*(H-2*P);
  const line=drawn.map((p,i)=>`${i===0?"M":"L"}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const area=`${line} L${x(drawn.length-1).toFixed(1)},${(H-P).toFixed(1)} L${x(0).toFixed(1)},${(H-P).toFixed(1)} Z`;
  const last=drawn[drawn.length-1].r;
  const col=isExample?"#64748b":(last>=0?"#22c55e":"#f87171");
  const zeroY=y(0);

  return(
    <div style={{width:"100%",position:"relative",opacity:isExample?0.55:1}}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:160,display:"block"}}>
        <defs>
          <linearGradient id="evoFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.28"/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {min<0&&max>0&&(
          <line x1={P} y1={zeroY} x2={W-P} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="4 4"/>
        )}
        <path d={area} fill="url(#evoFill)"/>
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={isExample?"6 5":undefined} vectorEffect="non-scaling-stroke"/>
      </svg>
      {isExample
        ? <div style={{textAlign:"center",fontSize:12,color:"#6b7280",marginTop:6}}>
            Exemplo — o teu gráfico começa a preencher a partir de amanhã (um ponto por dia).
          </div>
        : <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#4b5563",marginTop:6}}>
            <span>{series[0].date}</span>
            <span style={{color:col,fontWeight:700,fontFamily:"monospace"}}>{pct(last)}</span>
            <span>{series[series.length-1].date}</span>
          </div>}
    </div>
  );
}

/* ---- Sector exposure donut ----------------------------------------------- */
function SectorDonut({stocks}){
  // Tickers fora do mapa curado são resolvidos via /api/stocks/sector (que
  // aprende e guarda na BD). Até resolverem, ficam em "A identificar…".
  const [learned,setLearned]=useState({});
  useEffect(()=>{
    const unknown=[...new Set(stocks.map(s=>s.ticker).filter(t=>!SECTORS[String(t).toUpperCase()]))];
    if(!unknown.length) return;
    let cancel=false;
    (async()=>{
      const updates={};
      for(const t of unknown){
        try{
          const r=await fetch(`/api/stocks/sector?ticker=${encodeURIComponent(t)}`);
          const d=await r.json();
          if(d&&d.sector) updates[t]=d.sector;
        }catch{}
      }
      if(!cancel&&Object.keys(updates).length) setLearned(prev=>({...prev,...updates}));
    })();
    return()=>{ cancel=true; };
  },[stocks]);
  const sec=t=>SECTORS[String(t).toUpperCase()]||learned[t]||"A identificar…";
  const counts={};
  stocks.forEach(s=>{ const k=sec(s.ticker); counts[k]=(counts[k]||0)+1; });
  const total=stocks.length||1;
  const segs=Object.entries(counts).sort((a,b)=>b[1]-a[1])
    .map(([name,n],i)=>({name,n,pct:n/total,color:SECTOR_COLORS[i%SECTOR_COLORS.length]}));
  const R=42,SW=14,C=2*Math.PI*R;
  let off=0;
  return(
    <div style={{display:"flex",alignItems:"center",gap:20,flexWrap:"wrap"}}>
      <svg viewBox="0 0 100 100" style={{width:120,height:120,flexShrink:0,transform:"rotate(-90deg)"}}>
        {segs.map((s,i)=>{ const len=s.pct*C; const el=(
          <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color} strokeWidth={SW}
            strokeDasharray={`${len.toFixed(2)} ${(C-len).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)}/>
        ); off+=len; return el; })}
      </svg>
      <div style={{flex:1,minWidth:160,display:"flex",flexDirection:"column",gap:8}}>
        {segs.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,fontSize:13}}>
            <span style={{width:10,height:10,borderRadius:3,background:s.color,flexShrink:0}}/>
            <span style={{flex:1,color:"#cbd5e1",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
            <span style={{color:"#e2e8f0",fontWeight:700,fontFamily:"monospace"}}>{s.n}</span>
            <span style={{color:"#6b7280",fontFamily:"monospace",minWidth:38,textAlign:"right"}}>{Math.round(s.pct*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Detail -------------------------------------------------------------- */
function Detail({pf,rank,livePrices,dayChange,spy,nav}){
  if(!pf) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Portefólio não encontrado. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  const st=pfStats(pf,livePrices);
  const rows=pf.stocks.map(s=>{
    const cur=curPrice(s.ticker,s.initialPrice,livePrices);
    return{...s,cur,ret:stockRet(s,livePrices)};
  });
  const spyRet=spy?spy.returnFor(pf):null;
  const alpha=spyRet!=null?st.total-spyRet:null;
  // Tabela: ordenada por rentabilidade desde a submissão (métrica do jogo).
  const bySorted=[...rows].sort((a,b)=>b.ret-a.ret);
  // Destaques: melhor/pior performance DO DIA (variação vs fecho anterior),
  // espelhada para shorts. Só inclui ações com variação diária disponível.
  const dc=dayChange||{};
  const byDay=rows.map(s=>{
    const raw=dc[s.ticker];
    if(!Number.isFinite(raw)) return null;
    return {...s,ret:s.side==="short"?-raw:raw};
  }).filter(Boolean).sort((a,b)=>b.ret-a.ret);
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  return(
    <div style={{maxWidth:1320,margin:"0 auto",padding:"40px 20px 80px"}}>
      <style>{`.cdiDetail{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1000px){.cdiDetail{grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);align-items:start}}`}</style>
      <button onClick={()=>nav("ranking")}
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        ← Voltar ao ranking
      </button>

      <div className="cdiDetail">
      <div>{/* coluna esquerda: portefólio */}
      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:28,marginBottom:16}}>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-end",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
            {rank>0&&(
              <span style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:rank<=3?22:18,fontWeight:800,
                color:rank===1?"#fbbf24":rank===2?"#cbd5e1":rank===3?"#f59e0b":"#64748b",
                border:`2px solid ${rank===1?"rgba(251,191,36,0.6)":rank===2?"rgba(203,213,225,0.5)":rank===3?"rgba(245,158,11,0.5)":"rgba(255,255,255,0.12)"}`,
                boxShadow:rank===1?"0 0 16px rgba(251,191,36,0.35)":"none"}}>
                {rank<=3?["🥇","🥈","🥉"][rank-1]:rank}
              </span>
            )}
            <div style={{minWidth:0}}>
              <h1 style={{fontSize:24,fontWeight:800,letterSpacing:"-0.5px",marginBottom:4}}>{pf.name}</h1>
              <p style={{fontSize:13,color:"#4b5563",margin:0}}>Submetido a {dt(pf.submittedAt)}</p>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:36,fontWeight:800,fontFamily:"monospace",lineHeight:1,
              color:st.total>=0?"#4ade80":"#f87171"}}>{st.total>=0?"▲":"▼"} {pct(Math.abs(st.total)).replace(/[+-]/,"")}</div>
            <div style={{fontSize:11,color:"#4b5563",marginTop:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rentabilidade média</div>
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:20,marginTop:16,fontSize:13,color:"#6b7280"}}>
          <span style={{color:"#4ade80"}}>▲ {st.pos} positivas</span>
          <span style={{color:"#f87171"}}>▼ {st.neg} negativas</span>
          {alpha!=null&&(
            <span title="A tua rentabilidade menos a do S&P 500 no mesmo período">
              Alpha: <strong style={{color:alpha>=0?"#4ade80":"#f87171"}}>{alpha>=0?"+":""}{(alpha*100).toFixed(2)}%</strong>
            </span>
          )}
        </div>
      </div>

      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",
          padding:"10px 20px",borderBottom:"1px solid #1f2937",
          fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
          <span>Ação</span>
          <span style={{textAlign:"right"}}>Preço inicial</span>
          <span style={{textAlign:"right"}}>Preço atual</span>
          <span style={{textAlign:"right"}}>Rentab.</span>
        </div>
        {bySorted.map(s=>(
          <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",
            padding:"14px 20px",borderBottom:"1px solid #0f172a"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
              <StockLogo ticker={s.ticker} size={32}/>
              <div style={{minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{fontWeight:800,fontSize:14,color:"#e2e8f0"}}>{s.ticker}</span>
                  <SideBadge side={s.side}/>
                  <span style={{fontSize:13,color:"#6b7280"}}>{s.companyName}</span>
                </div>
              </div>
            </div>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:13,color:"#6b7280",alignSelf:"center"}}>{money(s.initialPrice)}</span>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:13,color:"#e2e8f0",alignSelf:"center"}}>{money(s.cur)}</span>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:15,fontWeight:700,alignSelf:"center",
              color:s.ret>=0?"#4ade80":"#f87171"}}>
              {s.ret>=0?"▲":"▼"} {pct(Math.abs(s.ret)).replace(/[+-]/,"")}
            </span>
          </div>
        ))}
      </div>
      </div>{/* /coluna esquerda */}

      <div>{/* coluna direita: análises */}
      {/* Evolução (#5) + Exposição por setor */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:16}}>
        <div style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Evolução da rentabilidade</h3>
          <EvolutionChart portfolioId={pf.id} currentReturn={st.total}/>
        </div>
        <div style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Exposição por setor</h3>
          <SectorDonut stocks={pf.stocks}/>
        </div>
      </div>

      {/* Destaques — melhor/pior performance DO DIA */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:12,fontWeight:700,
          letterSpacing:"0.5px",textTransform:"uppercase",color:"#94a3b8",
          borderRadius:999,padding:"5px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)"}}>
          Performance de hoje
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16}}>
        <div style={{...GLASS,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(34,197,94,0.12), rgba(34,197,94,0.03))",
          border:"1px solid rgba(34,197,94,0.20)"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><DayChip up/></div>
          {byDay.length?<TopList items={byDay.slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </div>
        <div style={{...GLASS,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(239,68,68,0.12), rgba(239,68,68,0.03))",
          border:"1px solid rgba(239,68,68,0.20)"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><DayChip/></div>
          {byDay.length?<TopList items={[...byDay].reverse().slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </div>
      </div>
      </div>{/* /coluna direita */}
      </div>{/* /cdiDetail */}
    </div>
  );
}

// Seta que distingue a box "melhor" (▲) da "pior" (▼).
function DayChip({up}){
  const c=up?"#4ade80":"#f87171";
  const bg=up?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)";
  const bd=up?"rgba(34,197,94,0.3)":"rgba(239,68,68,0.3)";
  return(
    <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:26,height:26,borderRadius:"50%",fontSize:12,fontWeight:800,
      color:c,background:bg,border:`1px solid ${bd}`}}>
      {up?"▲":"▼"}
    </span>
  );
}
function TopList({items}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map((s,i)=>(
        <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:10,
          background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 12px"}}>
          <span style={{fontSize:12,fontWeight:700,color:"#4b5563",minWidth:16}}>{i+1}</span>
          <StockLogo ticker={s.ticker} size={26}/>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"#e2e8f0",display:"flex",alignItems:"center",gap:6}}>{s.ticker}{s.side==="short"&&<SideBadge side="short"/>}</div>
            <div style={{fontSize:11,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.companyName}</div>
          </div>
          <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:s.ret>=0?"#4ade80":"#f87171"}}>{pct(s.ret)}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- Duelo 1v1 ----------------------------------------------------------- */
const DUEL_A="#3b82f6", DUEL_B="#f59e0b"; // cores de identidade A (azul) / B (âmbar)
function DuelChart({a,b,curA,curB}){
  const [snaps,setSnaps]=useState(null);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      const { data }=await supabase
        .from("portfolio_snapshots").select("portfolio_id,date,total_return")
        .in("portfolio_id",[a.id,b.id]).order("date",{ascending:true});
      if(!cancel) setSnaps(data||[]);
    })();
    return()=>{ cancel=true; };
  },[a.id,b.id]);
  if(snaps===null) return <p style={{fontSize:13,color:"#4b5563",margin:0}}>A carregar evolução…</p>;
  const today=new Date().toISOString().slice(0,10);
  const build=(id,cur)=>{
    const s=snaps.filter(x=>x.portfolio_id===id).map(x=>({date:x.date,r:Number(x.total_return)}));
    if(typeof cur==="number"){
      if(s.length&&s[s.length-1].date===today) s[s.length-1].r=cur; else s.push({date:today,r:cur});
    }
    return s;
  };
  const sa=build(a.id,curA), sb=build(b.id,curB);
  const isExample=sa.length<2&&sb.length<2;
  if(isExample) return(
    <p style={{fontSize:13,color:"#6b7280",margin:0,textAlign:"center",padding:"20px 0"}}>
      📈 O gráfico de evolução começa a preencher a partir de amanhã (um ponto por dia).
    </p>
  );
  const W=760,H=200,P=8;
  const all=[...sa.map(p=>p.r),...sb.map(p=>p.r),0];
  let min=Math.min(...all),max=Math.max(...all);
  if(min===max){ min-=0.01; max+=0.01; }
  const pad=(max-min)*0.12; min-=pad; max+=pad;
  const dates=[...new Set([...sa,...sb].map(p=>p.date))].sort();
  const xByDate={}; dates.forEach((d,i)=>{ xByDate[d]=P+(dates.length<2?0:(i/(dates.length-1))*(W-2*P)); });
  const y=v=>P+(1-(v-min)/(max-min))*(H-2*P);
  const path=s=>s.map((p,i)=>`${i===0?"M":"L"}${xByDate[p.date].toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const COLA=DUEL_A, COLB=DUEL_B;
  const zeroY=y(0);
  return(
    <div>
      <div style={{display:"flex",gap:16,marginBottom:10,fontSize:12}}>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#cbd5e1"}}><span style={{width:10,height:3,borderRadius:2,background:COLA}}/>{a.name}</span>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#cbd5e1"}}><span style={{width:10,height:3,borderRadius:2,background:COLB}}/>{b.name}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:"100%",height:160,display:"block"}}>
        {min<0&&max>0&&<line x1={P} y1={zeroY} x2={W-P} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="4 4"/>}
        {sa.length>1&&<path d={path(sa)} fill="none" stroke={COLA} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
        {sb.length>1&&<path d={path(sb)} fill="none" stroke={COLB} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>}
      </svg>
    </div>
  );
}
function DuelMetric({label,a,b,fmt,better}){
  // better: "high" (maior vence) ou "low" (menor vence)
  const aw=better==="low"?a<b:a>b, bw=better==="low"?b<a:b>a;
  const cell=(val,win)=>(
    <span style={{display:"inline-block",fontFamily:"monospace",fontWeight:800,fontSize:15,
      padding:"4px 11px",borderRadius:8,
      color:win?"#4ade80":"#94a3b8",
      background:win?"rgba(34,197,94,0.13)":"transparent",
      border:`1px solid ${win?"rgba(34,197,94,0.25)":"transparent"}`}}>{fmt(val)}</span>
  );
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:14,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
      <div style={{textAlign:"right"}}>{cell(a,aw)}</div>
      <span style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.6px",whiteSpace:"nowrap"}}>{label}</span>
      <div style={{textAlign:"left"}}>{cell(b,bw)}</div>
    </div>
  );
}
function DuelHoldings({title,tickers,color}){
  if(!tickers.length) return null;
  return(
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{title}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {tickers.map(t=>(
          <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(0,0,0,0.18)",
            border:`1px solid ${color||"rgba(255,255,255,0.08)"}`,borderRadius:999,padding:"5px 10px 5px 6px",fontSize:12,fontWeight:700,color:"#e2e8f0"}}>
            <StockLogo ticker={t} size={18}/>{t}
          </span>
        ))}
      </div>
    </div>
  );
}
function Duel({a,b,livePrices,spy,nav}){
  if(!a||!b) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Duelo inválido. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  const sa=pfStats(a,livePrices), sb=pfStats(b,livePrices);
  const alphaA=spy?a.total-spy.returnFor(a):null, alphaB=spy?b.total-spy.returnFor(b):null;
  const diff=a.total-b.total;
  const leader=diff>=0?a:b, gap=Math.abs(diff);
  const setA=new Set(a.stocks.map(s=>s.ticker)), setB=new Set(b.stocks.map(s=>s.ticker));
  const common=[...setA].filter(t=>setB.has(t));
  const onlyA=[...setA].filter(t=>!setB.has(t));
  const onlyB=[...setB].filter(t=>!setA.has(t));
  return(
    <div style={{maxWidth:980,margin:"0 auto",padding:"40px 20px 80px"}}>
      <button onClick={()=>nav("ranking")}
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,display:"flex",alignItems:"center",gap:6,padding:0}}>
        ← Voltar ao ranking
      </button>

      {/* Cabeçalho do duelo */}
      <div style={{...GLASS,borderRadius:16,padding:28,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:16}}>
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,marginBottom:6}}>
              <span style={{fontSize:16,fontWeight:800,letterSpacing:"-0.3px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.name}</span>
              <span style={{width:9,height:9,borderRadius:"50%",background:DUEL_A,flexShrink:0,boxShadow:`0 0 8px ${DUEL_A}`}}/>
            </div>
            <div style={{fontSize:30,fontWeight:800,fontFamily:"monospace",letterSpacing:"-1px",color:sa.total>=0?"#4ade80":"#f87171"}}>{pct(sa.total)}</div>
          </div>
          <div style={{width:44,height:44,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
            fontSize:13,fontWeight:800,color:"#cbd5e1",letterSpacing:"0.5px",
            background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)"}}>VS</div>
          <div style={{textAlign:"left"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:"50%",background:DUEL_B,flexShrink:0,boxShadow:`0 0 8px ${DUEL_B}`}}/>
              <span style={{fontSize:16,fontWeight:800,letterSpacing:"-0.3px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</span>
            </div>
            <div style={{fontSize:30,fontWeight:800,fontFamily:"monospace",letterSpacing:"-1px",color:sb.total>=0?"#4ade80":"#f87171"}}>{pct(sb.total)}</div>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:18}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",
            borderRadius:999,padding:"7px 18px",fontSize:13,fontWeight:700,color:"#fbbf24"}}>
            {gap<1e-9?"Empate técnico":`🏆 ${leader.name} lidera por ${(gap*100).toFixed(2)}%`}
          </span>
        </div>
      </div>

      {/* Evolução sobreposta */}
      <div style={{...GLASS,borderRadius:16,padding:24,marginBottom:16}}>
        <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Evolução da rentabilidade</h3>
        <DuelChart a={a} b={b} curA={sa.total} curB={sb.total}/>
      </div>

      {/* Confronto de métricas */}
      <div style={{...GLASS,borderRadius:16,padding:"8px 24px 16px",marginBottom:16}}>
        <DuelMetric label="Rentab. média" a={sa.total} b={sb.total} better="high" fmt={pct}/>
        {alphaA!=null&&alphaB!=null&&<DuelMetric label="Alpha" a={alphaA} b={alphaB} better="high" fmt={pct}/>}
        <DuelMetric label="Positivas" a={sa.pos} b={sb.pos} better="high" fmt={v=>String(v)}/>
        <DuelMetric label="Negativas" a={sa.neg} b={sb.neg} better="low" fmt={v=>String(v)}/>
      </div>

      {/* Carteiras: comum vs exclusivas */}
      <div style={{...GLASS,borderRadius:16,padding:24,marginBottom:16}}>
        <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Carteiras</h3>
        <DuelHoldings title="Em comum" tickers={common} color="rgba(255,255,255,0.14)"/>
        <DuelHoldings title={`Só ${a.name}`} tickers={onlyA} color="rgba(59,130,246,0.4)"/>
        <DuelHoldings title={`Só ${b.name}`} tickers={onlyB} color="rgba(245,158,11,0.4)"/>
      </div>

      {/* Exposição por setor lado a lado */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
        <div style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Setores · {a.name}</h3>
          <SectorDonut stocks={a.stocks}/>
        </div>
        <div style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Setores · {b.name}</h3>
          <SectorDonut stocks={b.stocks}/>
        </div>
      </div>
    </div>
  );
}

/* ---- Admin --------------------------------------------------------------- */
function Admin({settings,setSettings,portfolios,ranking,livePrices,reload,showToast}){
  const [authed,setAuthed]=useState(false);
  const [pw,setPw]=useState("");
  const [checking,setChecking]=useState(false);
  // The password is validated server-side; on success we keep it in memory only
  // to authorize subsequent admin actions (it is sent with each request).
  const tryAuth=async()=>{
    if(checking||!pw) return;
    setChecking(true);
    try{
      const res=await fetch("/api/admin/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      if(res.ok) setAuthed(true);
      else showToast("Palavra-passe incorreta.","error");
    }catch{ showToast("Falha de ligação.","error"); }
    finally{ setChecking(false); }
  };

  if(!authed) return(
    <div style={{maxWidth:400,margin:"80px auto",padding:"0 20px"}}>
      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:40}}>
        <div style={{fontSize:32,marginBottom:16}}>🛡</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:8}}>Área de Administração</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Introduz a palavra-passe de administrador.</p>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") tryAuth(); }}
          placeholder="Palavra-passe"
          style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
            padding:"12px 16px",fontSize:15,color:"#e2e8f0",outline:"none",boxSizing:"border-box",marginBottom:12}}/>
        <button onClick={tryAuth} disabled={checking}
          style={{width:"100%",background:"#22c55e",color:"#000",border:"none",borderRadius:10,
            padding:"13px",fontSize:15,fontWeight:700,cursor:checking?"not-allowed":"pointer",opacity:checking?0.6:1}}>
          {checking?"A verificar…":"Entrar"}</button>
      </div>
    </div>
  );
  return <AdminPanel {...{settings,setSettings,portfolios,ranking,livePrices,reload,showToast,pw}}/>;
}

function AdminPanel({settings,setSettings,portfolios,ranking,livePrices,reload,showToast,pw}){
  const [tab,setTab]=useState("portfolios");

  async function saveSt(next){
    setSettings(next);
    try{
      const res=await fetch("/api/admin/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,settings:next})});
      const data=await res.json();
      showToast(res.ok&&data?.ok?"Definições guardadas.":(data?.error||"Falha ao guardar."),res.ok&&data?.ok?"ok":"error");
    }catch{ showToast("Falha de ligação.","error"); }
  }
  async function delPf(p){
    if(!confirm(`Eliminar o portefólio de "${p.name}"?`)) return;
    try{
      const res=await fetch("/api/admin/delete-portfolio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,portfolioId:p.id,userId:p.userId})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível eliminar o portefólio.","error"); return; }
      await reload();
      showToast("Portefólio eliminado.");
    }catch{ showToast("Falha de ligação.","error"); }
  }

  function expSummary(){
    const rows=[["Posição","Nome","Rentabilidade %","Positivas","Negativas","Data submissão"]];
    ranking.forEach((p,i)=>rows.push([i+1,p.name,(p.total*100).toFixed(2),p.pos,p.neg,dt(p.submittedAt)]));
    dlCSV("ranking.csv",rows);
  }
  function expDetail(){
    const rows=[["Membro","Data","Ticker","Empresa","Preço inicial","Preço atual","Rentab. %"]];
    portfolios.forEach(p=>p.stocks.forEach(s=>{
      const cur=curPrice(s.ticker,s.initialPrice,livePrices);
      rows.push([p.name,dt(p.submittedAt),s.ticker,s.companyName,s.initialPrice,cur,((cur/s.initialPrice-1)*100).toFixed(2)]);
    }));
    dlCSV("detalhe.csv",rows);
  }

  const TABS=[["portfolios","👥 Portefólios"],["game","⚙️ Jogo"],["export","⬇️ Exportar"]];

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"40px 20px 80px"}}>
      <h1 style={{fontSize:26,fontWeight:800,marginBottom:24,letterSpacing:"-0.5px"}}>🛡 Administração</h1>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:4,marginBottom:24,flexWrap:"wrap"}}>
        {TABS.map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{flex:1,minWidth:"fit-content",padding:"9px 14px",borderRadius:8,border:"none",
              background:tab===id?"#1e3a2a":"transparent",color:tab===id?"#4ade80":"#6b7280",
              fontSize:13,fontWeight:tab===id?700:400,cursor:"pointer",transition:"all 0.15s"}}>
            {label}
          </button>
        ))}
      </div>

      {/* Portefólios */}
      {tab==="portfolios"&&(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
          {portfolios.length===0?(
            <p style={{padding:40,textAlign:"center",color:"#4b5563"}}>Sem portefólios ainda.</p>
          ):(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 100px 120px 44px",
                padding:"10px 20px",borderBottom:"1px solid #1f2937",
                fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
                <span>Membro</span><span>Ações</span><span style={{textAlign:"right"}}>Rentab.</span>
                <span style={{textAlign:"right"}}>Data</span><span/>
              </div>
              {ranking.map(p=>(
                <div key={p.key} style={{display:"grid",gridTemplateColumns:"1fr 2fr 100px 120px 44px",
                  padding:"12px 20px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
                  <span style={{fontWeight:600,fontSize:14}}>{p.name}</span>
                  <span style={{fontSize:11,color:"#374151",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.stocks.map(s=>s.ticker).join(" · ")}
                  </span>
                  <span style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:p.total>=0?"#4ade80":"#f87171"}}>
                    {pct(p.total)}
                  </span>
                  <span style={{textAlign:"right",fontSize:11,color:"#374151"}}>{dt(p.submittedAt)}</span>
                  <button onClick={()=>delPf(p)}
                    style={{background:"none",border:"none",cursor:"pointer",color:"#374151",padding:8,
                      borderRadius:6,fontSize:16}}
                    title="Eliminar"
                    onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
                    onMouseLeave={e=>e.currentTarget.style.color="#374151"}>
                    🗑
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Jogo */}
      {tab==="game"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
          <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24}}>
            <h3 style={{fontWeight:700,marginBottom:16}}>Submissões</h3>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"rgba(0,0,0,0.18)",
              borderRadius:10,padding:"12px 16px"}}>
              <span style={{fontSize:14,color:settings.submissionsOpen?"#4ade80":"#f87171"}}>
                {settings.submissionsOpen?"Abertas ✓":"Fechadas ✕"}
              </span>
              <button onClick={()=>saveSt({...settings,submissionsOpen:!settings.submissionsOpen})}
                style={{background:settings.submissionsOpen?"rgba(239,68,68,0.1)":"rgba(34,197,94,0.1)",
                  border:`1px solid ${settings.submissionsOpen?"rgba(239,68,68,0.3)":"rgba(34,197,94,0.3)"}`,
                  borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer",
                  color:settings.submissionsOpen?"#f87171":"#4ade80"}}>
                {settings.submissionsOpen?"Fechar":"Abrir"}
              </button>
            </div>
          </div>
          <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24}}>
            <h3 style={{fontWeight:700,marginBottom:16}}>Datas do jogo</h3>
            <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:4}}>Início</label>
            <input type="datetime-local" defaultValue={settings.gameStartDate}
              onBlur={e=>saveSt({...settings,gameStartDate:e.target.value})}
              style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,
                padding:"8px 12px",fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box",marginBottom:12}}/>
            <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:4}}>Fim</label>
            <input type="datetime-local" defaultValue={settings.gameEndDate}
              onBlur={e=>saveSt({...settings,gameEndDate:e.target.value})}
              style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,
                padding:"8px 12px",fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,gridColumn:"1/-1"}}>
            <button onClick={reload}
              style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 18px",
                fontSize:14,color:"#6b7280",cursor:"pointer",fontWeight:600}}>
              🔄 Recarregar dados
            </button>
          </div>
        </div>
      )}

      {/* Exportar */}
      {tab==="export"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {label:"Exportar ranking (CSV)",desc:"Uma linha por membro, ordenado por rentabilidade.",fn:expSummary},
            {label:"Exportar detalhe (CSV)",desc:"Uma linha por ação de cada portefólio.",fn:expDetail},
          ].map(c=>(
            <button key={c.label} onClick={c.fn}
              style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:28,
                textAlign:"left",cursor:"pointer",transition:"border-color 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#22c55e"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="#1f2937"}>
              <div style={{fontSize:28,marginBottom:12}}>⬇️</div>
              <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:"#e2e8f0"}}>{c.label}</div>
              <div style={{fontSize:13,color:"#6b7280"}}>{c.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Reusable button ----------------------------------------------------- */
function Btn({children,onClick,primary,large}){
  return(
    <button onClick={onClick}
      style={{background:primary?"#22c55e":"transparent",color:primary?"#000":"#e2e8f0",
        border:primary?"none":"1px solid #374151",borderRadius:10,
        padding:large?"15px 36px":"10px 22px",fontSize:large?16:14,fontWeight:700,cursor:"pointer",
        transition:"all 0.15s"}}
      onMouseEnter={e=>{ if(primary) e.currentTarget.style.background="#16a34a"; else e.currentTarget.style.borderColor="#6b7280"; }}
      onMouseLeave={e=>{ if(primary) e.currentTarget.style.background="#22c55e"; else e.currentTarget.style.borderColor="#374151"; }}>
      {children}
    </button>
  );
}

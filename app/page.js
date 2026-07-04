"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useId, useRef } from "react";
import { createPortal } from "react-dom";

// useLayoutEffect corre ANTES do paint (mede/posiciona sem flash); no servidor cai para useEffect
// (não há DOM), evitando o aviso de SSR. Usado para centrar o campeão/medalhão no gráfico.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { BUILD_VERSION } from "./version";
import { supabase } from "./supabase";
import { fetchStockInfo, fetchStockPrices, fetchStockHistory, searchTickers } from "./lib/stocks";
import { searchCryptos, isCrypto, cryptoNameFor } from "./lib/crypto";
import { searchPopular } from "./lib/popular";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { toBlob } from "html-to-image";

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

// Offset (ms) do fuso ET num dado instante — trata do horário de verão/inverno.
function etOffsetMs(instant){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(instant);
  const m={}; for(const x of p) m[x.type]=x.value;
  let h=parseInt(m.hour,10); if(h===24) h=0;
  const asUTC=Date.UTC(+m.year,+m.month-1,+m.day,h,+m.minute,+m.second);
  return asUTC-instant.getTime();
}
// Tempo (ms) até à próxima ABERTURA do mercado (09:30 ET em dia de sessão, saltando
// fins-de-semana e feriados). Devolve 0 se o mercado estiver aberto agora.
function msUntilMarketOpen(){
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
// "falta HHmm" no formato 01H02 (<24h) ou "falta Nd 01H02" (>=24h). Sem segundos.
function fmtCountdown(ms){
  if(ms<=0) return "";
  const totalMin=Math.floor(ms/60000);
  const days=Math.floor(totalMin/1440);
  const h=Math.floor((totalMin%1440)/60);
  const m=totalMin%60;
  const hhmm=`${String(h).padStart(2,"0")}H${String(m).padStart(2,"0")}`;
  return days>0?`falta ${days}d ${hhmm}`:`falta ${hhmm}`;
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
// Rentabilidade do portefólio HOJE: média das variações do dia das ações (espelhada p/ shorts).
function pfDayRet(pf,dayChange){
  const dc=dayChange||{};
  const rs=(pf?.stocks||[]).map(s=>{ const d=dc[s.ticker]; return Number.isFinite(d)?(s.side==="short"?-d:d):null; }).filter(x=>x!=null);
  return rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null;
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
function pfStats(p,livePrices){
  const rets=p.stocks.map(s=>stockRet(s,livePrices));
  return{ total:rets.reduce((a,b)=>a+b,0)/rets.length, pos:rets.filter(r=>r>0).length, neg:rets.filter(r=>r<0).length };
}
// Mini-época MENSAL ("Campeão do mês"): MESMA fórmula do total, mas com o baseline do
// início do mês (monthBase[ticker]) em vez do preço de submissão. Justo ao membro — pondera
// cada ação por 1/preço-início-do-mês (não por 1/preço-de-submissão, que sobrevaloriza ações
// que já dispararam desde o arranque). Sem baseline do mês → cai no preço inicial (ex.: julho,
// o mês de arranque, fica = ao total automaticamente).
function pfMonthRet(p,monthBase,livePrices){
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
function pfPeriodRet(p,baseFrom,baseTo){
  const rets=(p?.stocks||[]).map(s=>{
    const a=baseFrom&&baseFrom[s.ticker], b=baseTo&&baseTo[s.ticker];
    if(!(a>0)||!(b>0)) return null;
    const base=b/a-1;
    return s.side==="short"?-base:base;
  }).filter(x=>x!=null);
  return rets.length?rets.reduce((x,y)=>x+y,0)/rets.length:null;
}
function nextPeriod(p){ const [y,m]=p.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; }
function periodLabel(p){ const [y,m]=p.split("-").map(Number); return new Date(Date.UTC(y,m-1,1)).toLocaleDateString("pt-PT",{month:"long"}); }
// Mini-época SEMANAL ("Campeão da semana"). Chave = SEGUNDA-feira (UTC) dessa semana, 'YYYY-MM-DD'.
function weekKey(d){
  const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  const dow=t.getUTCDay(); t.setUTCDate(t.getUTCDate()+(dow===0?-6:1-dow)); // recua até 2ª feira
  return t.toISOString().slice(0,10);
}
function nextWeek(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+7); return t.toISOString().slice(0,10); }
// Semanas numeradas ("Semana 1", "Semana 2", …). Semana 1 = semana de arranque (1–3 jul, parcial;
// semana ISO de 29-jun). Semana 2 = 6–10 jul (1ª semana completa e ao vivo).
const WEEK1_MONDAY="2026-06-29";
const WEEK_LIVE_FROM="2026-07-06"; // jogo semanal ao vivo a partir da Semana 2 (6-jul)
// Semana 1 (1–3 jul) é um registo FIXO (semeado), vencedor Manuel. ret=null → mostra só o nome (sem %).
const WEEK_SEED_CHAMPS=[{period:"2026-06-29", name:"Manuel", ret:null}];
function weekNum(key){ return Math.max(1, Math.round((Date.parse(key+"T00:00:00Z")-Date.parse(WEEK1_MONDAY+"T00:00:00Z"))/(7*86400000))+1); }
function weekLabel(key){ return `Semana ${weekNum(key)}`; }
// Fim da semana = SEXTA-feira (2ª feira + 4). O ranking semanal é 2ª (abertura) → 6ª (fecho).
function weekFriday(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+4); return t.toISOString().slice(0,10); }
// Semana fechada? 6ª feira depois do fecho US (16:00 ET) ou fim de semana → vencedor apurado.
function weekTradingDone(now){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",hour12:false}).formatToParts(now||new Date());
  const wd=parts.find(x=>x.type==="weekday")?.value;
  let h=parseInt(parts.find(x=>x.type==="hour")?.value||"0",10); if(h===24)h=0;
  if(wd==="Sat"||wd==="Sun") return true;   // fim de semana
  if(wd==="Fri"&&h>=16) return true;        // 6ª feira depois do fecho (16:00 ET)
  return false;
}
// Rentabilidade da SEMANA: mesma fórmula do total, mas com o baseline da 2ª feira (weekBase).
function pfWeekRet(p,weekBase,livePrices){
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
function pct(x,dp=2){ const v=(x*100).toFixed(dp); return `${x>=0?"+":""}${v}%`; }
// Odómetro estilo Robinhood: cada dígito rola na vertical até ao valor (na entrada
// e quando o valor muda). Carateres não-dígitos (sinais, ".", "%") ficam estáticos.
function RollDigit({d,dur}){
  const [n,setN]=useState(0);
  useEffect(()=>{ const t=setTimeout(()=>setN(d),20); return()=>clearTimeout(t); },[d]);
  return(
    <span style={{display:"inline-block",height:"1em",lineHeight:1,overflow:"hidden",verticalAlign:"bottom"}}>
      <span style={{display:"block",transform:`translateY(${-n*10}%)`,transition:`transform ${dur}ms cubic-bezier(.2,.85,.25,1)`}}>
        {Array.from({length:10},(_,k)=><span key={k} style={{display:"block",height:"1em",lineHeight:1}}>{k}</span>)}
      </span>
    </span>
  );
}
function Rolling({text,dur=700,style}){
  return(
    <span style={{display:"inline-block",whiteSpace:"pre",lineHeight:1,...style}}>
      {[...String(text)].map((ch,i)=> /[0-9]/.test(ch)
        ? <RollDigit key={i} d={+ch} dur={dur}/>
        : <span key={i}>{ch}</span>)}
    </span>
  );
}
function money(x,cur){
  try{ return new Intl.NumberFormat("en-US",{style:"currency",currency:cur||"USD",minimumFractionDigits:2}).format(x); }
  catch{ return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(x); }
}
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
// Cartão com efeito "carta": inclinação 3D + spotlight a seguir o rato (só desktop).
function TiltCard({children,style}){
  const [enabled,setEnabled]=useState(false);
  const [t,setT]=useState("");
  const [pos,setPos]=useState({x:50,y:50});
  const [hovering,setHovering]=useState(false);
  useEffect(()=>{
    try{ setEnabled(window.matchMedia("(hover:hover) and (pointer:fine)").matches); }catch{ setEnabled(false); }
  },[]);
  const handlers=enabled?{
    onMouseMove:(e)=>{
      const r=e.currentTarget.getBoundingClientRect();
      const fx=(e.clientX-r.left)/r.width, fy=(e.clientY-r.top)/r.height;
      setT(`perspective(900px) rotateY(${((fx-0.5)*12).toFixed(2)}deg) rotateX(${((0.5-fy)*12).toFixed(2)}deg) scale(1.02)`);
      setPos({x:+(fx*100).toFixed(1),y:+(fy*100).toFixed(1)});
      setHovering(true);
    },
    onMouseLeave:()=>{ setT(""); setHovering(false); },
  }:{};
  return(
    <div {...handlers} style={{...style,position:"relative",overflow:"hidden",transform:t||"none",transition:"transform .18s ease",willChange:"transform"}}>
      {enabled&&(
        <div style={{position:"absolute",inset:0,borderRadius:"inherit",pointerEvents:"none",
          background:`radial-gradient(240px circle at ${pos.x}% ${pos.y}%, rgba(255,255,255,0.05), transparent 60%)`,
          opacity:hovering?1:0,transition:"opacity .2s ease"}}/>
      )}
      {children}
    </div>
  );
}

// Estado da faixa de voltar: ativa só em desktop (hover/ponteiro fino) e com margem
// esquerda suficiente. Quando ativa, SUBSTITUI o botão "← Voltar ao ranking".
function useBackRail(){
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

// Faixa lateral esquerda (desktop): ao passar o cursor pela margem vazia à esquerda do
// conteúdo, surge um glow + seta ← para voltar. Ocupa exatamente a margem (nunca sobrepõe
// o cartão). Renderizada só quando useBackRail().active (aí o botão de topo desaparece).
function LeftBackRail({gap,onBack,label="Voltar ao ranking"}){
  const [hover,setHover]=useState(false);
  return(
    <div onClick={onBack} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      role="button" aria-label={label} title={label}
      style={{position:"fixed",left:0,top:0,bottom:0,width:gap,cursor:"pointer",zIndex:40,
        display:"flex",alignItems:"center",justifyContent:"center",
        background:hover?"linear-gradient(90deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 50%, transparent 100%)":"transparent",
        transition:"background .25s ease"}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,padding:8,
        opacity:hover?1:0,transform:hover?"translateX(0)":"translateX(12px)",transition:"opacity .25s ease, transform .25s ease"}}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" style={{filter:"drop-shadow(0 0 10px rgba(255,255,255,0.55))"}}>
          <path d="M15 6l-6 6 6 6"/>
        </svg>
        {gap>=150&&<span style={{fontSize:12,color:"#cbd5e1",fontWeight:600,whiteSpace:"nowrap",letterSpacing:"0.3px",filter:"drop-shadow(0 1px 4px rgba(0,0,0,0.5))"}}>{label}</span>}
      </div>
    </div>
  );
}

// Botão flutuante "voltar ao topo" — só em desktop (hover/ponteiro fino); aparece com scroll.
// Ancorado junto da coluna de conteúdo (maxWidth): fica ao lado da tabela, não no bordo da janela.
function BackToTop({maxWidth}){
  const [show,setShow]=useState(false);
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    let ok=false; try{ ok=window.matchMedia("(hover:hover) and (pointer:fine)").matches; }catch{}
    setEnabled(ok);
    if(!ok) return;
    const onScroll=()=>setShow(window.scrollY>600);
    onScroll();
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>window.removeEventListener("scroll",onScroll);
  },[]);
  if(!enabled) return null;
  const right=maxWidth?`max(16px, calc((100vw - ${maxWidth}px)/2 - 38px))`:"24px";
  return(
    <button onClick={()=>window.scrollTo({top:0,behavior:"smooth"})} aria-label="Voltar ao topo" title="Voltar ao topo"
      style={{position:"fixed",right,bottom:24,zIndex:45,width:46,height:46,borderRadius:"50%",cursor:"pointer",
        background:"rgba(255,255,255,0.08)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
        border:"1px solid rgba(255,255,255,0.18)",boxShadow:"0 8px 24px rgba(0,0,0,0.35)",color:"#e2e8f0",
        display:"flex",alignItems:"center",justifyContent:"center",
        opacity:show?1:0,transform:show?"translateY(0)":"translateY(12px)",pointerEvents:show?"auto":"none",
        transition:"opacity .25s ease, transform .25s ease"}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  );
}

// Confete dourado (sem biblioteca) — celebração do 1º lugar. Dispara 1× ao abrir o detalhe
// do campeão; mais intenso quando o #1 é o próprio. Mobile/tablet/desktop; respeita
// prefers-reduced-motion (quem reduz movimento não vê animação). pointer-events:none.
function Confetti({intense}){
  const ref=useRef(null);
  const [pieces,setPieces]=useState(null);
  // 1) Gera as partículas (uma vez), respeitando prefers-reduced-motion.
  useEffect(()=>{
    let reduce=false;
    try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    if(reduce) return;
    const GOLD=["#facc15","#fcd34d","#f59e0b","#fde68a","#eab308","#fbbf24","#ca8a04"];
    const n=intense?84:46;
    setPieces(Array.from({length:n},(_,i)=>({
      left:Math.random()*100,
      dur:2000+Math.random()*1600,
      delay:Math.random()*(intense?900:600),
      drift:(Math.random()*2-1)*130,
      rot:(Math.random()*2-1)*900,
      size:6+Math.random()*7,
      round:Math.random()<0.35,
      color:GOLD[i%GOLD.length],
    })));
  },[intense]);
  // 2) Anima cada partícula com a Web Animations API (não depende de keyframes CSS).
  useEffect(()=>{
    if(!pieces||!ref.current||typeof window==="undefined") return;
    const H=window.innerHeight||800;
    const anims=[];
    [...ref.current.children].forEach((el,i)=>{
      const p=pieces[i]; if(!p||!el.animate) return;
      anims.push(el.animate([
        {transform:`translate3d(0,${-0.15*H}px,0) rotate(0deg)`,opacity:0},
        {opacity:1,offset:0.06},
        {opacity:1,offset:0.88},
        {transform:`translate3d(${p.drift}px,${1.16*H}px,0) rotate(${p.rot}deg)`,opacity:0},
      ],{duration:p.dur,delay:p.delay,easing:"cubic-bezier(.2,.6,.5,1)",fill:"forwards"}));
    });
    const maxEnd=pieces.reduce((m,p)=>Math.max(m,p.dur+p.delay),0);
    const t=setTimeout(()=>setPieces(null),maxEnd+150);
    return()=>{ clearTimeout(t); anims.forEach(a=>{ try{a.cancel();}catch{} }); };
  },[pieces]);
  if(!pieces) return null;
  return(
    <div ref={ref} aria-hidden="true" style={{position:"fixed",inset:0,zIndex:60,pointerEvents:"none",overflow:"hidden"}}>
      {pieces.map((p,i)=><span key={i} style={{position:"absolute",top:0,left:`${p.left}%`,
        width:p.round?p.size*0.85:p.size,height:p.round?p.size*0.85:p.size*1.6,background:p.color,
        borderRadius:p.round?"50%":"1px",boxShadow:"0 0 4px rgba(245,158,11,0.45)",opacity:0}}/>)}
    </div>
  );
}

// Fundo com CROSS-FADE entre temas (página/lugar). Gradientes não animam por CSS, por isso
// sobrepomos a nova cor por cima da anterior e fazemos fade da opacidade; quando termina,
// removem-se as camadas antigas. Camada fixa atrás do conteúdo.
function BgLayer({bg,isNew,onDone}){
  const [op,setOp]=useState(isNew?0:1);
  useEffect(()=>{
    if(!isNew) return;
    const r=requestAnimationFrame(()=>requestAnimationFrame(()=>setOp(1)));
    return()=>cancelAnimationFrame(r);
  },[isNew]);
  return <div onTransitionEnd={isNew?onDone:undefined}
    style={{position:"absolute",inset:0,background:bg,opacity:op,transition:"opacity .6s ease"}}/>;
}
function BackgroundFade({bg}){
  const [layers,setLayers]=useState(()=>[{id:0,bg}]);
  const nid=useRef(0);
  useEffect(()=>{
    setLayers(prev=>{
      if(prev[prev.length-1].bg===bg) return prev;
      nid.current+=1;
      return [...prev,{id:nid.current,bg}];
    });
  },[bg]);
  const prune=(id)=>setLayers(prev=>{ const i=prev.findIndex(l=>l.id===id); return i<=0?prev:prev.slice(i); });
  return(
    <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:0,pointerEvents:"none"}}>
      {layers.map((l,i)=><BgLayer key={l.id} bg={l.bg} isNew={i>0} onDone={()=>prune(l.id)}/>)}
    </div>
  );
}

// Glow dourado que SEGUE o cursor (só desktop), recortado pela forma da própria imagem
// (máscara). Usado no logo da Home e no troféu do #1. Subtil/premium.
function GoldGlow({src,alt="",maskSrc,wrapStyle,imgStyle,baseFilter="",glow=16}){
  const [on,setOn]=useState(false);
  const [pos,setPos]=useState({x:50,y:50});
  const [hov,setHov]=useState(false);
  useEffect(()=>{ try{ setOn(window.matchMedia("(hover:hover) and (pointer:fine)").matches); }catch{} },[]);
  const handlers=on?{
    onMouseMove:(e)=>{ const r=e.currentTarget.getBoundingClientRect(); setPos({x:((e.clientX-r.left)/r.width)*100,y:((e.clientY-r.top)/r.height)*100}); setHov(true); },
    onMouseLeave:()=>setHov(false),
  }:{};
  const mask=maskSrc?{WebkitMaskImage:`url(${maskSrc})`,maskImage:`url(${maskSrc})`,
    WebkitMaskSize:"100% 100%",maskSize:"100% 100%",WebkitMaskRepeat:"no-repeat",maskRepeat:"no-repeat",
    WebkitMaskPosition:"center",maskPosition:"center"}:{};
  return(
    <span {...handlers} style={{position:"relative",display:"inline-block",lineHeight:0,...wrapStyle}}>
      <img src={src} alt={alt} style={{display:"block",transition:"filter .3s ease",...imgStyle,
        filter:(hov&&on)?`${baseFilter} drop-shadow(0 0 ${glow}px rgba(245,158,11,0.32))`:baseFilter}}/>
      {on&&(
        <span aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
          background:`radial-gradient(circle at ${pos.x}% ${pos.y}%, rgba(253,224,71,0.38), rgba(245,158,11,0.10) 42%, transparent 72%)`,
          mixBlendMode:"screen",opacity:hov?1:0,transition:"opacity .35s ease",...mask}}/>
      )}
    </span>
  );
}

// Aviso de NOVA VERSÃO: compara a versão carregada (BUILD_VERSION) com a do servidor quando o
// separador ganha foco / de 5 em 5 min. Só atua em produção (BUILD_VERSION != "dev"). Ajuda
// quem tem o site aberto há muito tempo a recarregar para a versão mais recente.
function UpdateBanner(){
  const [stale,setStale]=useState(false);
  useEffect(()=>{
    if(BUILD_VERSION==="dev"||typeof window==="undefined") return;
    let stop=false;
    const check=async()=>{
      if(stop||document.hidden) return;
      try{
        const r=await fetch("/api/version",{cache:"no-store"});
        const d=await r.json();
        if(d?.v && d.v!==BUILD_VERSION){ setStale(true); stop=true; }
      }catch{}
    };
    const onVis=()=>{ if(!document.hidden) check(); };
    document.addEventListener("visibilitychange",onVis);
    window.addEventListener("focus",check);
    const id=setInterval(check,5*60*1000);
    check();
    return()=>{ document.removeEventListener("visibilitychange",onVis); window.removeEventListener("focus",check); clearInterval(id); };
  },[]);
  if(!stale) return null;
  return(
    <div role="status" className="cdiBottomFloat" style={{position:"fixed",left:"50%",bottom:24,transform:"translateX(-50%)",zIndex:9990,
      display:"flex",alignItems:"center",gap:12,maxWidth:"92vw",
      background:"rgba(15,30,52,0.96)",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",
      border:"1px solid rgba(96,165,250,0.45)",borderRadius:999,padding:"10px 12px 10px 18px",
      boxShadow:"0 12px 34px rgba(0,0,0,0.5)"}}>
      <span style={{fontSize:13.5,color:"#e2e8f0",fontWeight:600,whiteSpace:"nowrap"}}>Nova versão disponível</span>
      <button onClick={()=>window.location.reload()}
        style={{background:"linear-gradient(180deg,#38bdf8,#0ea5e9)",color:"#04222e",border:"none",
          borderRadius:999,padding:"8px 16px",fontSize:13.5,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap"}}>Atualizar</button>
    </div>
  );
}

// Glow ambiente a respirar/derivar LENTAMENTE (Web Animations API, loop infinito; respeita
// prefers-reduced-motion). BreatheGlow = só a camada de luz; GlowBehind = luz + conteúdo por cima.
function BreatheGlow({color="rgba(64,170,205,0.5)",mid="rgba(56,189,248,0.16)",inset="-14% -10%",blur=46,base=0.45,duration=22000}){
  const ref=useRef(null);
  useEffect(()=>{
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    const el=ref.current; if(!el||reduce||!el.animate) return;
    // Translação + opacidade (sem scale — evita re-rasterizar a desfocagem da própria camada).
    const anim=el.animate([
      {transform:"translate3d(-4%,-3%,0)",opacity:base*0.9},
      {transform:"translate3d(5%,4%,0)",opacity:base*1.25},
      {transform:"translate3d(-4%,-3%,0)",opacity:base*0.9},
    ],{duration,easing:"ease-in-out",iterations:Infinity});
    return()=>{ try{anim.cancel();}catch{} };
  },[]);
  return <div ref={ref} aria-hidden="true" style={{position:"absolute",inset,zIndex:0,pointerEvents:"none",
    background:`radial-gradient(closest-side, ${color}, ${mid} 55%, transparent 76%)`,filter:`blur(${blur}px)`,opacity:base,willChange:"transform,opacity"}}/>;
}
function GlowBehind({children,color,mid}){
  return(
    <div style={{position:"relative"}}>
      <BreatheGlow color={color} mid={mid}/>
      <div style={{position:"relative",zIndex:1}}>{children}</div>
    </div>
  );
}
// Levitação lenta (sobe/desce). cx=true mantém o centramento horizontal translateX(-50%).
function Float({children,style,cx=false,amp=6,duration=4200}){
  const ref=useRef(null);
  useEffect(()=>{
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    const el=ref.current; if(!el||reduce||!el.animate) return;
    const x=cx?"-50%":"0px";
    const anim=el.animate([
      {transform:`translate(${x}, 0px)`},
      {transform:`translate(${x}, -${amp}px)`},
      {transform:`translate(${x}, 0px)`},
    ],{duration,easing:"ease-in-out",iterations:Infinity});
    return()=>{ try{anim.cancel();}catch{} };
  },[]);
  return <div ref={ref} style={{...style,transform:cx?"translateX(-50%)":(style&&style.transform)}}>{children}</div>;
}

// Aurora de fundo: 2 manchas de luz MUITO subtis a derivar devagar atrás de toda a app.
// Fixa, por trás do conteúdo. Respeita prefers-reduced-motion.
function Aurora({page}){
  const r1=useRef(null), r2=useRef(null);
  useEffect(()=>{
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    if(reduce) return;
    const mk=(el,frames,dur)=>el&&el.animate?el.animate(frames,{duration:dur,easing:"ease-in-out",iterations:Infinity}):null;
    const a1=mk(r1.current,[
      {transform:"translate3d(-7%,-5%,0)"},
      {transform:"translate3d(9%,7%,0)"},
      {transform:"translate3d(-7%,-5%,0)"},
    ],42000);
    const a2=mk(r2.current,[
      {transform:"translate3d(7%,5%,0)"},
      {transform:"translate3d(-9%,-7%,0)"},
      {transform:"translate3d(7%,5%,0)"},
    ],50000);
    return()=>{ try{ a1&&a1.cancel(); a2&&a2.cancel(); }catch{} };
  },[]);
  const ath=page==="ath"; // ATH: lavanda no canto sup. direito + violeta à direita (combina com o tema)
  const b1=ath
    ? {top:"-12%",right:"-4%",width:"52vw",height:"52vw",background:"radial-gradient(closest-side, rgba(208,206,232,0.16), transparent 70%)"}
    : {top:"-10%",left:"-6%",width:"48vw",height:"48vw",background:"radial-gradient(closest-side, rgba(56,189,248,0.10), transparent 70%)"};
  const b2=ath
    ? {top:"16%",right:"-12%",width:"40vw",height:"40vw",background:"radial-gradient(closest-side, rgba(134,104,166,0.16), transparent 70%)"}
    : {bottom:"-14%",right:"-8%",width:"44vw",height:"44vw",background:"radial-gradient(closest-side, rgba(45,212,191,0.09), transparent 70%)"};
  return(
    <div aria-hidden="true" style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
      <div ref={r1} style={{position:"absolute",borderRadius:"50%",filter:"blur(40px)",willChange:"transform",...b1}}/>
      <div ref={r2} style={{position:"absolute",borderRadius:"50%",filter:"blur(40px)",willChange:"transform",...b2}}/>
    </div>
  );
}
// Só marca as posições SHORT — long é o normal, não precisa de badge.
// Círculo com seta diagonal para baixo (aposta na queda), junto ao ticker.
function SideBadge({side}){
  if(side!=="short") return null;
  return(
    <span title="Posição short (aposta na queda)" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:"clamp(15px,4.2vw,18px)",height:"clamp(15px,4.2vw,18px)",borderRadius:"50%",flexShrink:0,
      background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.4)"}}>
      <svg style={{width:"clamp(8px,2.3vw,10px)",height:"clamp(8px,2.3vw,10px)"}} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7L17 17"/><path d="M17 10V17H10"/>
      </svg>
    </span>
  );
}
function StockLogo({ticker,size=28}){
  const [err,setErr]=useState(false);
  if(!ticker) return null;
  if(err||!LOGODEV_TOKEN) return <span className="stkLogo"><Monogram ticker={ticker} size={size}/></span>;
  return(
    <span className="stkLogo">
      <img
        src={`https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=${LOGODEV_TOKEN}&size=${size*3}&format=png&retina=true&fallback=404`}
        alt="" width={size} height={size} loading="lazy" onError={()=>setErr(true)}
        style={{width:size,height:size,borderRadius:6,objectFit:"cover",
          background:"#fff",display:"block",flexShrink:0}}/>
    </span>
  );
}

/* ---- Aba ATH: distância ao máximo histórico (S&P 500) -------------------- */
function Skeleton({w="100%",h=12,r=8,style}){
  return <span className="cdiSkeleton" style={{display:"inline-block",width:w,height:h,borderRadius:r,...style}}/>;
}
function fmtCap(v,s="$"){
  if(!Number.isFinite(v)||v<=0) return "—";
  if(v>=1e12) return `${s}${(v/1e12).toFixed(2)}T`;
  if(v>=1e9)  return `${s}${(v/1e9).toFixed(0)}B`;
  if(v>=1e6)  return `${s}${(v/1e6).toFixed(0)}M`;
  return `${s}${v.toFixed(0)}`;
}
const curSym=(c)=>({USD:"$",EUR:"€",GBP:"£",JPY:"¥",CHF:"CHF ",CAD:"C$",AUD:"A$",HKD:"HK$",BRL:"R$"}[c]||"$");
// Moeda inferida pelo sufixo do ticker (sem precisar de coluna na BD). Ex.: .PA/.AS/.DE → EUR.
const SUFFIX_CUR={PA:"EUR",AS:"EUR",BR:"EUR",LS:"EUR",MC:"EUR",MI:"EUR",DE:"EUR",F:"EUR",VI:"EUR",IR:"EUR",HE:"EUR",AT:"EUR",L:"GBP",SW:"CHF",TO:"CAD",V:"CAD",AX:"AUD",HK:"HKD",T:"JPY",SA:"BRL"};
const curForTicker=(sym)=>{ const p=String(sym||"").toUpperCase().split(/[.\-]/); return p.length>1?(SUFFIX_CUR[p[p.length-1]]||"USD"):"USD"; };
function fmtMoney(v){ return Number.isFinite(v)?`$${v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—"; }
function sinceLabel(ts){
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
function fmtMoneyC(v,s="$"){ if(!Number.isFinite(v)) return "—"; return v>=1000?`${s}${Math.round(v).toLocaleString("en-US")}`:`${s}${v.toFixed(2)}`; }
function sinceLabelShort(ts){
  if(!ts) return "—";
  const t=new Date(ts).getTime(); if(!Number.isFinite(t)) return "—";
  const days=Math.floor((Date.now()-t)/86400000);
  if(days<=0) return "hoje"; if(days<31) return `${days}d`;
  const months=Math.round(days/30.44); if(months<12) return `${months}m`;
  return `${Math.round(days/365.25)}a`;
}
const tkNorm=(s)=>String(s||"").toUpperCase().replace(/\./g,"-").trim(); // matching de tickers (BRK.B↔BRK-B)
function ATH({myTickers,auth,showToast,pickCounts,compTickers}){
  const authed=!!(auth&&auth.name&&auth.pin);
  const [rows,setRows]=useState(null);
  const [activeFilter,setActiveFilter]=useState(null); // null | "mine" | listId (watchlist)
  const wlKey=auth?.name?("ci_wl:"+String(auth.name).toLowerCase()):null; // cache local das watchlists
  const [lists,setLists]=useState(()=>{ try{ const c=wlKey?sget(wlKey):null; return Array.isArray(c)?c:[]; }catch{ return []; } }); // watchlists do user: [{id,name,tickers[]}] — arranca do cache p/ aparecer logo
  const [addFor,setAddFor]=useState(null);              // ticker a adicionar a listas (abre modal)
  const [addSel,setAddSel]=useState(()=>new Set());     // listas selecionadas no modal "Adicionar"
  const [menuFor,setMenuFor]=useState(null);            // lista com menu renomear/apagar aberto (hover/long-press)
  const [draftName,setDraftName]=useState(null);        // criação inline: input no lugar da pill (null = sem rascunho)
  const [globalRes,setGlobalRes]=useState([]);          // resultados globais (fora do S&P) p/ adicionar
  const [gLoading,setGLoading]=useState(false);
  const lpTimer=useRef(null), lpFired=useRef(false), canHover=useRef(false), draftCancel=useRef(false);
  const [nameModal,setNameModal]=useState(null);        // criar/renomear: {mode,id?,ticker?,value}
  const [liteQuotes,setLiteQuotes]=useState({});        // tickers fora do S&P: {tkNorm:{name,price}}
  const [q,setQ]=useState("");
  const [sortKey,setSortKey]=useState("marketcap"); // marketcap | down | since
  const [sortDir,setSortDir]=useState("desc"); // asc | desc — clicar na coluna alterna
  const onSort=(k)=>{ if(k===sortKey) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir(k==="down"?"asc":"desc"); } };
  const [updatedAt,setUpdatedAt]=useState(null);
  const [limit,setLimit]=useState(100); // render só N de cada vez (perf); a procura vê as 500
  const [refreshing,setRefreshing]=useState(false);
  const mountedRef=useRef(true);
  useEffect(()=>{ mountedRef.current=true; return ()=>{ mountedRef.current=false; }; },[]);
  // Re-lê a tabela sp500_ath (o que o cron já escreveu). É uma leitura barata ao Supabase —
  // NÃO mexe na API de cotações dos portefólios. Mantém os dados visíveis e só roda o ícone.
  const load=useCallback(async()=>{
    setRefreshing(true);
    try{
      const { data }=await supabase.from("sp500_ath")
        .select("symbol,name,price,marketcap,ath,ath_ts,updated_at,in_sp500");
      if(!mountedRef.current) return;
      const list=(data||[]).map(r=>{
        const price=Number(r.price), ath=Number(r.ath);
        return { symbol:r.symbol, name:r.name||r.symbol, price, ath, marketcap:Number(r.marketcap),
          ath_ts:r.ath_ts, in_sp500:r.in_sp500!==false,
          down:(Number.isFinite(price)&&Number.isFinite(ath)&&ath>0)?(price/ath-1):null };
      });
      setRows(list);
      setUpdatedAt((data||[]).reduce((m,r)=>{ const t=new Date(r.updated_at||0).getTime(); return t>m?t:m; },0)||null);
    } finally { if(mountedRef.current) setRefreshing(false); }
  },[]);
  useEffect(()=>{ load(); },[load]);
  // ---- Watchlists (sincronizadas na conta) ----
  useEffect(()=>{
    if(!authed){ setLists([]); return; }
    try{ const c=wlKey?sget(wlKey):null; if(Array.isArray(c)&&c.length) setLists(c); }catch{} // mostra o cache já, sem esperar pelo servidor
    let cancel=false;
    (async()=>{
      try{
        const r=await fetch("/api/watchlists/list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin})});
        const d=await r.json(); if(cancel) return;
        if(!d?.ok) return;
        if((d.lists||[]).length===0){
          // Garante uma lista por defeito "Watch list" (vazia) para o user.
          try{
            const cr=await fetch("/api/watchlists/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,listName:"Watch list",tickers:[]})});
            const cd=await cr.json(); if(!cancel) setLists(cr.ok&&cd?.ok&&cd.list?[cd.list]:[]);
          }catch{ if(!cancel) setLists([]); }
        } else setLists(d.lists);
      }catch{}
    })();
    return()=>{ cancel=true; };
  },[authed,auth?.name,auth?.pin]);
  useEffect(()=>{ if(wlKey) sset(wlKey,lists); },[lists,wlKey]); // cache local sempre atualizado
  const apiSave=useCallback(async(payload)=>{
    const r=await fetch("/api/watchlists/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,...payload})});
    const d=await r.json(); if(!r.ok||!d?.ok) throw new Error(d?.error||"Não foi possível guardar."); return d.list;
  },[auth]);
  const createList=useCallback(async(nm,ticker)=>{
    try{ const saved=await apiSave({listName:nm,tickers:ticker?[String(ticker).toUpperCase()]:[]}); setLists(ls=>[...ls,saved]); showToast&&showToast("Lista criada"); return saved; }
    catch(e){ showToast&&showToast(e.message,"error"); return null; }
  },[apiSave,showToast]);
  const renameList=useCallback(async(id,nm)=>{
    const l=lists.find(x=>x.id===id); if(!l) return; const prev=l.name;
    setLists(ls=>ls.map(x=>x.id===id?{...x,name:nm}:x));
    try{ await apiSave({id,listName:nm,tickers:l.tickers}); }
    catch(e){ setLists(ls=>ls.map(x=>x.id===id?{...x,name:prev}:x)); showToast&&showToast(e.message,"error"); }
  },[lists,apiSave,showToast]);
  const deleteList=useCallback(async(id)=>{
    const prev=lists; setLists(ls=>ls.filter(x=>x.id!==id)); setActiveFilter(f=>f===id?null:f);
    try{ const r=await fetch("/api/watchlists/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,id})}); const d=await r.json(); if(!r.ok||!d?.ok) throw new Error(d?.error||"Erro"); }
    catch(e){ setLists(prev); showToast&&showToast(e.message,"error"); }
  },[lists,auth,showToast]);
  const toggleTicker=useCallback(async(id,ticker)=>{
    const l=lists.find(x=>x.id===id); if(!l) return;
    const t=tkNorm(ticker), has=l.tickers.some(x=>tkNorm(x)===t);
    const next=has?l.tickers.filter(x=>tkNorm(x)!==t):[...l.tickers,String(ticker).toUpperCase()];
    setLists(ls=>ls.map(x=>x.id===id?{...x,tickers:next}:x));
    showToast&&showToast(`${String(ticker).toUpperCase()} ${has?"removida de":"adicionada a"} ${l.name}`);
    try{ await apiSave({id,listName:l.name,tickers:next}); }
    catch(e){ setLists(ls=>ls.map(x=>x.id===id?{...x,tickers:l.tickers}:x)); showToast&&showToast(e.message,"error"); }
  },[lists,apiSave,showToast]);
  const confirmName=useCallback(async()=>{
    const m=nameModal; if(!m) return; const nm=(m.value||"").trim(); if(!nm) return;
    if(m.mode==="rename"){ await renameList(m.id,nm); }
    else { await createList(nm, m.mode==="create-add"?m.ticker:null); }
    setNameModal(null);
  },[nameModal,renameList,createList]);
  const openAdd=useCallback((ticker)=>{
    const t=tkNorm(ticker);
    setAddSel(new Set(lists.filter(l=>l.tickers.some(x=>tkNorm(x)===t)).map(l=>l.id)));
    setAddFor(ticker);
  },[lists]);
  const applyAdd=useCallback(async()=>{
    const t=addFor; if(!t) return;
    const tasks=[];
    lists.forEach(l=>{ const has=l.tickers.some(x=>tkNorm(x)===tkNorm(t)); const sel=addSel.has(l.id); if(sel!==has) tasks.push(toggleTicker(l.id,t)); });
    const firstSel=[...addSel][0];
    setAddFor(null); setQ(""); setGlobalRes([]); // limpa a pesquisa depois de guardar
    if(firstSel) setActiveFilter(firstSel); // passa para a playlist onde guardou (fica selecionada)
    await Promise.all(tasks);
  },[addFor,addSel,lists,toggleTicker]);
  const activeList=useMemo(()=>activeFilter&&activeFilter!=="mine"?lists.find(l=>l.id===activeFilter)||null:null,[activeFilter,lists]);
  const filterTickers=useMemo(()=>{
    if(activeFilter==="mine") return myTickers||[];
    if(activeFilter==="comp") return compTickers||[];   // só as ações da competição
    if(activeList) return (activeList.tickers||[]).filter(t=>!String(t).includes("=")); // esconde futuros/commodities (ex. CC=F)
    return null; // null => mostrar a tabela toda (S&P 500)
  },[activeFilter,myTickers,activeList,compTickers]);
  // Preço/nome ao vivo dos tickers da lista ativa que NÃO estão no S&P 500 (ex. ASML).
  useEffect(()=>{
    if(!filterTickers||!rows) return;
    const have=new Set(rows.map(r=>tkNorm(r.symbol)));
    // tickers ORIGINAIS (preserva o ponto, ex. RMS.PA) que ainda não têm preço; indexa por tkNorm.
    const seen=new Set(); const missing=[];
    for(const tk of filterTickers){ const k=tkNorm(tk); if(!k||have.has(k)||seen.has(k)) continue; if((k in liteQuotes)&&liteQuotes[k].fetched) continue; seen.add(k); missing.push(tk); }
    if(!missing.length) return;
    let cancel=false;
    (async()=>{
      const cryptos=missing.filter(isCrypto), stocks=missing.filter(t=>!isCrypto(t));
      const out=[];
      if(cryptos.length){
        let cd={};
        try{ const r=await fetch(`/api/crypto/price?tickers=${encodeURIComponent(cryptos.join(","))}`); const d=await r.json(); cd=d.data||{}; }catch{}
        for(const t of cryptos){ const c=cd[String(t).toUpperCase()]; out.push([tkNorm(t),{name:cryptoNameFor(t)||t, price:c?c.price:null, marketcap:c?c.marketcap:null, ath:c?c.ath:null, down:c?c.down:null, ath_ts:c?c.ath_ts:null, fetched:true}]); }
      }
      const se=await Promise.all(stocks.slice(0,40).map(async t=>{
        try{ const info=await fetchStockInfo(t); return [tkNorm(t), {name:(info&&info.name)||t, price:(info&&typeof info.price==="number")?info.price:null, fetched:true}]; }
        catch{ return [tkNorm(t),{name:t,price:null,fetched:true}]; }
      }));
      out.push(...se);
      if(cancel) return;
      setLiteQuotes(prev=>{ const n={...prev}; out.forEach(([k,v])=>{ n[k]=v; }); return n; });
    })();
    return()=>{ cancel=true; };
  },[filterTickers,rows,liteQuotes]);
  useEffect(()=>{ try{ canHover.current=window.matchMedia("(hover:hover)").matches; }catch{} },[]);
  // Procura GLOBAL (debounce) para adicionar tickers fora do S&P (ASML, BTC-USD, etc.) pela barra.
  useEffect(()=>{
    if(!authed){ setGlobalRes([]); return; }
    const term=q.trim();
    if(term.length<2){ setGlobalRes([]); setGLoading(false); return; }
    setGLoading(true);
    let cancel=false;
    const id=setTimeout(async()=>{
      // Os que JÁ aparecem na tabela (com dados) não se repetem no dropdown — o dropdown é só p/ adicionar o que a tabela não mostra.
      const have=rows?new Set(rows.map(r=>tkNorm(r.symbol))):new Set();
      const pop=searchPopular(term);        // populares europeias/internacionais (local)
      const cg=searchCryptos(term);         // cripto (local, fiável)
      let stocks=[];
      try{ const r=await searchTickers(term); stocks=(r||[]).filter(x=>x.ticker); }catch{} // estrangeiras (SEC)
      if(cancel) return;
      const seen=new Set(); const merged=[];
      for(const x of [...pop,...cg,...stocks]){ const k=tkNorm(x.ticker); if(k&&!have.has(k)&&!seen.has(k)){ seen.add(k); merged.push(x); } }
      setGlobalRes(merged.slice(0,8));
      setGLoading(false);
    },350);
    return()=>{ cancel=true; clearTimeout(id); };
  },[q,authed,rows]);
  // Fecha o menu (renomear/apagar) ao tocar/clicar fora de uma pill.
  useEffect(()=>{
    if(!menuFor) return;
    const onDown=(e)=>{ if(!e.target.closest||!e.target.closest(".athPillWrap")) setMenuFor(null); };
    document.addEventListener("pointerdown",onDown);
    return()=>document.removeEventListener("pointerdown",onDown);
  },[menuFor]);
  const view=useMemo(()=>{
    if(!rows) return [];
    let base;
    if(filterTickers){
      const bySym=new Map(rows.map(r=>[tkNorm(r.symbol),r]));
      base=filterTickers.map(tk=>{
        const r=bySym.get(tkNorm(tk)); if(r) return r;
        const lq=liteQuotes[tkNorm(tk)];
        return { symbol:String(tk).toUpperCase(), name:(lq&&lq.name)||String(tk).toUpperCase(),
          price:(lq&&lq.price!=null)?lq.price:null, marketcap:(lq&&lq.marketcap!=null)?lq.marketcap:null,
          ath:(lq&&lq.ath!=null)?lq.ath:null, ath_ts:(lq&&lq.ath_ts)||null, down:(lq&&lq.down!=null)?lq.down:null, lite:true };
      });
    } else base=norm(q)?rows:rows.filter(r=>r.in_sp500!==false); // sem pesquisa = só S&P; a pesquisar = tudo (inclui extras)
    const needle=norm(q);
    let list=needle?base.filter(r=>norm(r.symbol).includes(needle)||norm(r.name).includes(needle)):base;
    const val={
      marketcap:r=>r.marketcap??-Infinity,
      down:r=>r.down??-Infinity,
      since:r=>new Date(r.ath_ts||0).getTime(),
    }[sortKey]||(()=>0);
    const sign=sortDir==="asc"?1:-1;
    return [...list].sort((a,b)=>sign*(val(a)-val(b)));
  },[rows,q,sortKey,sortDir,filterTickers,liteQuotes]);
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  const GREEN="#4ade80"; // verde partilhado: bolinha de seleção + botão Guardar
  const pillStyle=(on)=>({cursor:"pointer",borderRadius:999,padding:"7px 14px",fontSize:13,fontWeight:on?700:600,transition:"all .15s",whiteSpace:"nowrap",
    border:`1px solid ${on?"rgba(74,222,128,0.55)":"rgba(255,255,255,0.14)"}`,background:on?"rgba(34,197,94,0.20)":"rgba(255,255,255,0.05)",color:on?"#bbf7d0":"#cbd5e1"});
  const miniBtn={cursor:"pointer",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:600,border:"1px solid rgba(255,255,255,0.14)",background:"rgba(255,255,255,0.05)",color:"#cbd5e1"};
  const menuItem={cursor:"pointer",textAlign:"left",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,border:"none",background:"transparent",color:"#e2e8f0",whiteSpace:"nowrap"};
  const Hd=({k,children,align="center",cls})=>{
    const active=sortKey===k;
    const ai=align==="right"?"flex-end":align==="left"?"flex-start":"center";
    return(
      <span onClick={()=>onSort(k)} className={"athSortHd"+(active?" on":"")+(cls?" "+cls:"")}
        style={{display:"flex",flexDirection:"column",alignItems:ai,gap:1,cursor:"pointer",userSelect:"none"}}>
        <i className={"athArr"+(active&&sortDir==="asc"?" on":"")} aria-hidden="true">▲</i>
        {children}
        <i className={"athArr"+(active&&sortDir==="desc"?" on":"")} aria-hidden="true">▼</i>
      </span>
    );
  };
  return(
    <div style={{maxWidth:940,margin:"0 auto",padding:"40px 20px 120px"}}>
      <style>{`
        .athRow{display:grid;grid-template-columns:44px 1fr 116px 96px 84px 110px 110px 92px;gap:10px;align-items:center}
        .athPickMini{display:none}
        .athPx{display:contents}            /* desktop: Preço e ATH ocupam 2 pistas reais */
        .athSinceShort{display:none}
        @keyframes athSpin{to{transform:rotate(360deg)}}
        .athSpin{animation:athSpin .8s linear infinite}
        @media(hover:hover){ .athClickable:hover{background:rgba(255,255,255,0.04)} .athPill:hover{filter:brightness(1.18);transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,0.25)} }
        .athSearchBox{max-width:560px}
        @media(min-width:768px){ .athSearchBox{max-width:280px} }
        .athExtGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        @media(max-width:640px){ .athExtGrid{grid-template-columns:1fr} }

        /* Colunas ordenáveis: par de setas (cinza = clicável; ativa acende a direção) */
        .athSortHd{cursor:pointer;user-select:none;color:#94a3b8;transition:color .15s}
        .athSortHd.on{color:#e2e8f0}
        .athArr{font-style:normal;font-size:8px;line-height:1;color:#64748b;transition:color .15s}
        .athArr.on{color:#e2e8f0}
        @media(hover:hover){
          .athSortHd:hover{color:#e2e8f0}
          .athSortHd:hover .athArr{color:#94a3b8}
          .athSortHd:hover .athArr.on{color:#e2e8f0}
        }

        /* TABLET (<=760): mantém as 7 colunas, só aperta */
        @media(max-width:760px){
          .athRow{grid-template-columns:30px 1fr 90px 84px 70px 84px 80px 64px;gap:8px;
            padding-left:14px!important;padding-right:14px!important}
        }

        /* TELEMÓVEL (<=480): 6 pistas — # | Empresa | Marketcap | %abaixo | Preço/ATH | Desde */
        @media(max-width:480px){
          .athRow{grid-template-columns:16px minmax(0,1fr) 56px 60px 52px 38px;gap:6px;
            padding-left:8px!important;padding-right:8px!important}
          .athPick{display:none!important}   /* coluna Membros: cabe só desktop/tablet */
          .athPickMini{display:inline!important}   /* no telemóvel, % ao lado do ticker */
          .athNum{text-align:left!important;padding-left:0!important;font-size:12px!important}
          .athRow .stkLogo>*{width:22px!important;height:22px!important}
          .athRow .stkLogo img{width:22px!important;height:22px!important}
          .athName{display:none!important}
          .athSym{font-size:13px!important}
          .athEmp{gap:6px!important}
          .athPx{display:flex!important;flex-direction:column;align-items:center;line-height:1.12;min-width:0}
          .athPxPrice{font-size:12px!important}
          .athPxAth{font-size:10.5px!important}
          .athHeadAth{display:none!important}
          .athCap{font-size:12px!important}
          .athBadge{font-size:11px!important;padding:3px 5px!important;border-radius:7px!important}
          .athSinceLong{display:none!important}
          .athSinceShort{display:inline!important;font-size:11px!important}
          .athHead{font-size:9px!important;letter-spacing:0!important}
          .athArr{font-size:7px}
        }

        /* 320px: degrada com graça (sem scroll) — cai o logo */
        @media(max-width:359px){
          .athRow{gap:5px;padding-left:6px!important;padding-right:6px!important}
          .athRow .stkLogo{display:none!important}
        }
      `}</style>
      <h1 style={{textAlign:"center",fontSize:28,fontWeight:800,letterSpacing:"-0.5px",margin:"0 0 4px"}}>Máximo histórico</h1>
      <p style={{textAlign:"center",color:"#94a3b8",fontSize:14,margin:"0 0 24px"}}>Preço atual vs. ATH</p>

      {(authed||(compTickers&&compTickers.length>0))&&(
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",alignItems:"center",gap:8,marginBottom:12}}>
          {compTickers&&compTickers.length>0&&(
            <button className="athPill" onClick={()=>setActiveFilter(f=>f==="comp"?null:"comp")} title="Só as ações que os membros escolheram"
              style={pillStyle(activeFilter==="comp")}>{activeFilter==="comp"?"✓ ":""}Competição · {compTickers.length}</button>
          )}
          {myTickers&&myTickers.length>0&&(
            <button className="athPill" onClick={()=>setActiveFilter(f=>f==="mine"?null:"mine")} title="Mostrar só as minhas ações"
              style={pillStyle(activeFilter==="mine")}>{activeFilter==="mine"?"✓ ":""}Minhas {myTickers.length}</button>
          )}
          {lists.map(l=>(
            <span key={l.id} className="athPillWrap" style={{position:"relative",display:"inline-flex"}}
              onMouseEnter={()=>{ if(canHover.current&&activeFilter===l.id) setMenuFor(l.id); }}
              onMouseLeave={()=>{ if(canHover.current) setMenuFor(f=>f===l.id?null:f); }}
              onTouchStart={()=>{ lpFired.current=false; clearTimeout(lpTimer.current); lpTimer.current=setTimeout(()=>{ if(activeFilter!==l.id) return; lpFired.current=true; setMenuFor(l.id); },480); }}
              onTouchEnd={()=>clearTimeout(lpTimer.current)} onTouchMove={()=>clearTimeout(lpTimer.current)}>
              <button className="athPill" onClick={()=>{ if(lpFired.current){ lpFired.current=false; return; } setActiveFilter(f=>f===l.id?null:l.id); }} title={`Ver "${l.name}"`}
                style={pillStyle(activeFilter===l.id)}>{activeFilter===l.id?"✓ ":""}{l.name}{l.tickers.length?` · ${l.tickers.length}`:""}</button>
              {menuFor===l.id&&activeFilter===l.id&&(
                <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",zIndex:40,paddingTop:6}}>
                  {/* paddingTop é a "ponte" invisível: o cursor passa da pill para o menu sem atravessar vão */}
                  <div style={{background:"rgba(20,26,42,0.98)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:12,padding:6,
                    display:"flex",flexDirection:"column",gap:2,minWidth:150,boxShadow:"0 10px 30px rgba(0,0,0,0.5)"}}>
                    <button onClick={()=>{ setMenuFor(null); setNameModal({mode:"rename",id:l.id,value:l.name}); }} style={menuItem}>✎ Renomear</button>
                    <button onClick={()=>{ setMenuFor(null); if(typeof window==="undefined"||window.confirm(`Apagar a lista "${l.name}"?`)) deleteList(l.id); }} style={menuItem}>🗑 Apagar</button>
                  </div>
                </div>
              )}
            </span>
          ))}
          {authed&&(draftName!==null?(
            <input autoFocus value={draftName} onChange={e=>setDraftName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } else if(e.key==="Escape"){ draftCancel.current=true; e.currentTarget.blur(); } }}
              onBlur={()=>{ if(draftCancel.current){ draftCancel.current=false; setDraftName(null); return; } const nm=(draftName||"").trim(); if(nm) createList(nm); setDraftName(null); }}
              placeholder="Nome da lista…"
              style={{borderRadius:999,padding:"6px 14px",fontSize:13,fontWeight:600,width:130,
                border:"1px solid rgba(96,165,250,0.55)",background:"rgba(0,0,0,0.25)",color:"#e2e8f0",outline:"none"}}/>
          ):(
            <button onClick={()=>setDraftName("")} title="Criar nova watchlist"
              style={{cursor:"pointer",background:"none",border:"none",color:"#94a3b8",fontSize:22,lineHeight:1,padding:"2px 8px",fontWeight:400}}>+</button>
          ))}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginBottom:14}}>
        <div className="athSearchBox" style={{position:"relative",width:"100%"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input value={q} onChange={e=>{ const v=e.target.value; setQ(v); if(v.trim()) setActiveFilter(null); }} placeholder="Procurar ticker ou empresa…"
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.12)",boxSizing:"border-box",
              borderRadius:16,padding:"12px 36px",fontSize:14,color:"#e2e8f0",outline:"none",textAlign:"center"}}/>
          {q&&(
            <button onClick={()=>{ setQ(""); setGlobalRes([]); }} title="Limpar" aria-label="Limpar pesquisa"
              style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",display:"flex",alignItems:"center",justifyContent:"center",
                width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"none",color:"#cbd5e1",cursor:"pointer",padding:0}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
        <div style={{width:"100%",maxWidth:560,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12.5,color:"#94a3b8",whiteSpace:"nowrap"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#34d399",flexShrink:0,boxShadow:"0 0 8px rgba(52,211,153,0.6)"}}/>
            {rows?(updatedAt?`Atualizado ${new Date(updatedAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}`:""):"A carregar…"}
          </span>
          <button onClick={load} disabled={refreshing} title="Atualizar dados" aria-label="Atualizar dados"
            style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:38,height:38,borderRadius:14,flexShrink:0,
              background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",color:"#cbd5e1",padding:0,
              cursor:refreshing?"default":"pointer",opacity:refreshing?0.6:1}}>
            <svg className={refreshing?"athSpin":""} width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
            </svg>
          </button>
        </div>
      </div>

      <div style={{...GLASS,borderRadius:16,overflow:"hidden"}}>
        <div className="athRow" style={{padding:"10px 18px",borderBottom:"1px solid rgba(255,255,255,0.10)",
          fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600,color:"#94a3b8"}}>
          <span aria-hidden="true"/><span className="athHead">Empresa</span>
          <Hd k="marketcap" align="center"><span className="athHead">Marketcap</span></Hd>
          <Hd k="down" align="center"><span className="athHead">% abaixo</span></Hd>
          <span className="athPick athHead" style={{textAlign:"center"}}>Membros</span>
          <span className="athPx athHead" style={{textAlign:"center"}}>
            <span style={{textAlign:"center"}}>Preço</span>
            <span className="athHeadAth" style={{textAlign:"center"}}>ATH</span>
          </span>
          <Hd k="since" align="center"><span className="athHead">Desde</span></Hd>
        </div>
        {rows===null?(
          Array.from({length:12},(_,i)=>(
            <div key={i} className="athRow" style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
              <span className="athNum" style={{textAlign:"center"}}><Skeleton w={16} h={12}/></span>
              <span className="athEmp" style={{display:"flex",alignItems:"center",gap:10}}>
                <Skeleton w={30} h={30} r={6}/>
                <span style={{display:"flex",flexDirection:"column",gap:6}}>
                  <Skeleton w={54} h={11}/><span className="athName"><Skeleton w={108} h={9}/></span>
                </span>
              </span>
              <span style={{textAlign:"center"}}><Skeleton w={70} h={13}/></span>
              <span style={{textAlign:"center"}}><Skeleton w={58} h={20}/></span>
              <span className="athPx">
                <span style={{textAlign:"center"}}><Skeleton w={56} h={12}/></span>
                <span style={{textAlign:"center"}}><Skeleton w={48} h={11}/></span>
              </span>
              <span style={{textAlign:"center"}}><Skeleton w={34} h={11}/></span>
            </div>
          ))
        ):view.length===0?(
          <div style={{padding:50,textAlign:"center",color:"#64748b",fontSize:14}}>
            {rows.length===0?"Ainda sem dados — a tabela vai ser preenchida em breve.":q.trim()?"Nenhuma ação do S&P 500 corresponde.":"Sem resultados."}
          </div>
        ):(<>{view.slice(0,limit).map((r,i)=>{
          const up=r.down!=null&&r.down>=0;
          const col=r.down==null?"#94a3b8":up?"#4ade80":"#f87171";
          const bg=r.down==null?"transparent":up?"rgba(34,197,94,0.10)":"rgba(248,113,113,0.10)";
          const bd=r.down==null?"rgba(255,255,255,0.12)":up?"rgba(34,197,94,0.35)":"rgba(248,113,113,0.35)";
          const picks=pickCounts?.[tkNorm(r.symbol)]||0;
          const mine=!!(myTickers&&myTickers.some(t=>tkNorm(t)===tkNorm(r.symbol)));
          return(
            <div key={r.symbol} className={"athRow"+(authed?" athClickable":"")} onClick={authed?()=>openAdd(r.symbol):undefined} title={authed?"Adicionar a uma watchlist":undefined} style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)",cursor:authed?"pointer":"default",boxShadow:mine?"inset 3px 0 0 rgba(34,197,94,0.6)":"none"}}>
              <span className="athNum" style={{textAlign:"center",fontSize:13,color:"#64748b",fontWeight:700}}>{i+1}</span>
              <span className="athEmp" style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                <StockLogo ticker={r.symbol} size={30}/>
                <span style={{minWidth:0,display:"flex",flexDirection:"column",lineHeight:1.15}}>
                  <span className="athSym" style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{r.symbol}</span>
                    {picks>0&&<span className="athPickMini" style={{fontSize:10.5,color:"#94a3b8",fontWeight:700,flexShrink:0}}>{picks}</span>}
                  </span>
                  <span className="athName" style={{fontSize:12,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                </span>
              </span>
              <span className="athCap" style={{textAlign:"center",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{fmtCap(r.marketcap,curSym(curForTicker(r.symbol)))}</span>
              <span style={{textAlign:"center"}}>
                <span className="athBadge" style={{display:"inline-block",fontFamily:"monospace",fontSize:13,fontWeight:800,color:col,
                  background:bg,border:`1px solid ${bd}`,borderRadius:8,padding:"4px 8px"}}>
                  {r.down==null?"—":`${up?"+":""}${(r.down*100).toFixed(1)}%`}
                </span>
              </span>
              <span className="athPick" style={{textAlign:"center",fontFamily:"monospace",fontSize:13,fontWeight:700,color:picks>0?"#94a3b8":"#475569"}} title={picks>0?`${picks} membro(s) têm esta ação`:"Ninguém na competição tem esta ação"}>
                {picks>0?picks:"—"}
              </span>
              <span className="athPx">
                <span className="athPxPrice" style={{textAlign:"center",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{fmtMoneyC(r.price,curSym(curForTicker(r.symbol)))}</span>
                <span className="athPxAth" style={{textAlign:"center",fontFamily:"monospace",fontSize:13,color:"#94a3b8"}}>{fmtMoneyC(r.ath,curSym(curForTicker(r.symbol)))}</span>
              </span>
              <span style={{textAlign:"center",fontSize:12.5,color:"#94a3b8"}}>
                <span className="athSinceLong">{sinceLabel(r.ath_ts)}</span>
                <span className="athSinceShort">{sinceLabelShort(r.ath_ts)}</span>
              </span>
            </div>
          );
        })}
        {view.length>limit&&(
          <div style={{padding:"14px",textAlign:"center"}}>
            <button onClick={()=>setLimit(l=>l+150)}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:999,
                padding:"9px 18px",fontSize:13,fontWeight:600,color:"#cbd5e1",cursor:"pointer"}}>
              Mostrar mais ({view.length-limit})
            </button>
          </div>
        )}
        </>)}
      </div>

      {authed&&q.trim().length>=2&&(globalRes.length>0||gLoading)&&(
        <div style={{marginTop:14}}>
          <div style={{fontSize:11,color:"#64748b",textAlign:"center",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>
            Fora do S&P 500 · adiciona à watchlist para ver valores
          </div>
          <div className="athExtGrid">
            {globalRes.map((res,i)=>(
              <button key={`${res.ticker}-${i}`}
                onClick={()=>{ const tk=String(res.ticker||"").toUpperCase(); setLiteQuotes(qq=>({...qq,[tkNorm(tk)]:{...(qq[tkNorm(tk)]||{}),name:res.name||tk}})); openAdd(tk); }}
                style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",textAlign:"left",borderRadius:10,padding:"8px 12px",
                  border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#cbd5e1"}}>
                <StockLogo ticker={res.ticker} size={22}/>
                <span style={{minWidth:0,flex:1,display:"flex",flexDirection:"column",lineHeight:1.2}}>
                  <span style={{fontWeight:700,fontSize:12.5}}>{res.ticker}</span>
                  <span style={{fontSize:11,color:"#8792a3",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{res.name}{res.exchange?` · ${res.exchange}`:""}</span>
                </span>
                <span style={{color:"#4ade80",fontWeight:800,fontSize:15,flexShrink:0}}>+</span>
              </button>
            ))}
            {gLoading&&!globalRes.length&&<span style={{fontSize:11,color:"#64748b",textAlign:"center",gridColumn:"1/-1"}}>A procurar…</span>}
          </div>
        </div>
      )}

      {addFor&&(
        <div onClick={()=>setAddFor(null)} style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS,borderRadius:18,padding:18,width:"100%",maxWidth:340,maxHeight:"80vh",overflow:"auto"}}>
            <h3 style={{margin:"0 0 12px",fontSize:16,fontWeight:800}}>Adicionar {addFor}</h3>
            {lists.length===0&&<p style={{fontSize:13,color:"#94a3b8",margin:"0 0 10px"}}>Ainda não tens listas. Cria uma com "+".</p>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {lists.map(l=>{
                const inList=l.tickers.some(x=>tkNorm(x)===tkNorm(addFor)); // pertence já à lista?
                return(
                  <button key={l.id} onClick={()=>toggleTicker(l.id,addFor)}
                    style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",textAlign:"left",
                      borderRadius:10,padding:"10px 12px",fontSize:14,fontWeight:600,transition:"all .15s",
                      border:`1px solid ${inList?"rgba(74,222,128,0.5)":"rgba(255,255,255,0.12)"}`,
                      background:inList?"rgba(34,197,94,0.14)":"rgba(255,255,255,0.04)",color:"#e2e8f0"}}>
                    <span aria-hidden="true" style={{flexShrink:0,width:20,height:20,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
                      border:`2px solid ${inList?GREEN:"rgba(255,255,255,0.28)"}`,background:inList?GREEN:"transparent",transition:"all .15s"}}>
                      {inList&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06281a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>}
                    </span>
                    <span style={{flex:1,minWidth:0}}>{l.name}</span>
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button onClick={()=>setNameModal({mode:"create-add",ticker:addFor,value:"Watch list"})}
                style={{flex:1,padding:"12px",borderRadius:14,fontSize:14,fontWeight:700,cursor:"pointer",
                  background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.14)",color:"#cbd5e1"}}>+ Nova lista</button>
              <button onClick={()=>{ setAddFor(null); setQ(""); setGlobalRes([]); }}
                style={{flex:1,padding:"12px",borderRadius:14,fontSize:14,fontWeight:800,cursor:"pointer",
                  background:GREEN,border:`1px solid ${GREEN}`,color:"#06281a"}}>Concluído</button>
            </div>
          </div>
        </div>
      )}
      {nameModal&&(
        <div onClick={()=>setNameModal(null)} style={{position:"fixed",inset:0,zIndex:9001,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS,borderRadius:18,padding:18,width:"100%",maxWidth:320}}>
            <h3 style={{margin:"0 0 12px",fontSize:16,fontWeight:800}}>{nameModal.mode==="rename"?"Renomear lista":"Nova lista"}</h3>
            <input autoFocus value={nameModal.value} onChange={e=>setNameModal(m=>({...m,value:e.target.value}))}
              onKeyDown={e=>{ if(e.key==="Enter") confirmName(); }}
              style={{width:"100%",background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"10px 12px",fontSize:14,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
              <button onClick={()=>setNameModal(null)} style={miniBtn}>Cancelar</button>
              <button onClick={confirmName} style={{...miniBtn,background:"rgba(34,197,94,0.18)",border:"1px solid rgba(34,197,94,0.4)",color:"#86efac"}}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Shared game settings (Supabase) ------------------------------------- */
const DEFAULT_SETTINGS={submissionsOpen:true,gameStartDate:"",gameEndDate:"",competitionStarted:false,baselinesLockedAt:null};
async function loadGameSettings(){
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
function isPreLaunch(s){ return !!s && s.competitionStarted!==true; }
// Submissões fechadas se desligadas, já arrancou, ou passou o prazo (game_start_date).
function submissionsClosed(s){
  if(Date.now()>=SUBMISSIONS_CLOSE_MS) return true; // prazo (22:00 PT, 30 jun) — não reabre
  if(!s) return false;
  if(s.competitionStarted) return true;
  if(!s.submissionsOpen) return true;
  if(s.gameStartDate){ const d=new Date(s.gameStartDate); if(!isNaN(d)&&Date.now()>=d.getTime()) return true; }
  return false;
}
function fmtDateShort(iso){
  try{ return new Intl.DateTimeFormat("pt-PT",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(iso)); }
  catch{ return ""; }
}
// Contador da competição: antes do arranque conta até ao fim das submissões;
// depois mostra a data do vencedor + contagem decrescente. Elegante e responsivo.
function CompetitionTimer({settings,period,hasWeek}){
  const [now,setNow]=useState(null);
  useEffect(()=>{
    setNow(Date.now());
    const id=setInterval(()=>setNow(Date.now()),3600_000); // 1×/hora — os dias só mudam à meia-noite
    return()=>clearInterval(id);
  },[]);
  if(!settings||now==null) return null;
  const started=settings.competitionStarted;
  const dayDiff=(a,b)=>Math.floor((Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())-Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()))/86400000);
  let label, d;
  if(started&&period==="week"){
    // Mini-época semanal: 2ª (abertura) → 6ª (fecho). Vencedor apurado 6ª ao fecho; fim de semana = fechada.
    const nd=new Date(now);
    const wk=weekKey(nd); // 2ª feira desta semana (UTC)
    if(!hasWeek){
      const todayYMD=nd.toISOString().slice(0,10);
      const startStr=(todayYMD<WEEK_LIVE_FROM)?WEEK_LIVE_FROM:nextWeek(wk); // pré-arranque → 13-jul; depois → próxima 2ª
      const start=new Date(startStr+"T00:00:00Z");
      d=dayDiff(start,nd);
      label=`Arranca 2ª feira, ${fmtDateShort(startStr)}`;
    }else if(weekTradingDone(nd)){
      label=`${weekLabel(wk)} · vencedor apurado`;
      d=null; // semana fechada → sem contagem
    }else{
      const fri=weekFriday(wk);
      d=dayDiff(new Date(fri+"T00:00:00Z"),nd);
      label=`Vencedor a ${fmtDateShort(fri)}`;
    }
  }else if(started&&period==="month"){
    // Mini-época mensal: vencedor apurado no ÚLTIMO dia do mês. Faltam = (último dia − dia de hoje).
    const nd=new Date(now);
    const lastNum=new Date(nd.getFullYear(),nd.getMonth()+1,0).getDate(); // ex.: 31 (julho)
    d=lastNum-nd.getDate();                                               // 31 − 3 = 28
    const endStr=`${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,"0")}-${String(lastNum).padStart(2,"0")}`;
    label=`Vencedor a ${fmtDateShort(endStr)}`;
  }else{
    const targetStr=started?settings.gameEndDate:settings.gameStartDate;
    if(!targetStr) return null;
    const target=new Date(targetStr).getTime();
    if(isNaN(target)) return null;
    const diff=target-now;
    if(diff<=0) return null;
    d=Math.ceil(diff/86400000);
    label=started?`Vencedor a ${fmtDateShort(settings.gameEndDate)}`:"";
  }
  const accent=started?"#fbbf24":"#fcd34d";
  return(
    <div style={{display:"flex",justifyContent:"center"}}>
      <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap",
        maxWidth:"100%",padding:"8px 16px",borderRadius:999,textAlign:"center",
        background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",
        border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"}}>
        {label&&<span style={{fontSize:13,color:"#cbd5e1",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>}
        {d!=null&&<span style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:accent,whiteSpace:"nowrap"}}>{d<=0?"apura-se hoje":`faltam ${d===1?"1 dia":`${d} dias`}`}</span>}
      </div>
    </div>
  );
}
// Contador ao segundo até ao FECHO das submissões (22h PT de 30 jun).
// Só na homepage, e só enquanto a competição ainda não arrancou (pré-lançamento).
// 22:00 PT (WEST, UTC+1) de 30 jun 2026 = 21:00 UTC — instante absoluto, à prova do fuso do visitante.
const SUBMISSIONS_CLOSE_MS=Date.UTC(2026,5,30,21,0,0);
function SubmissionCountdown({settings}){
  const [now,setNow]=useState(null);
  useEffect(()=>{
    if(!isPreLaunch(settings)) return; // pós-arranque: contador obsoleto → nem arranca o timer
    setNow(Date.now());
    const id=setInterval(()=>setNow(Date.now()),1000); // a cada segundo — relógio HH:MM:SS
    return()=>clearInterval(id);
  },[settings]);
  // Depois de a competição arrancar, este contador já não faz sentido.
  if(!isPreLaunch(settings)||now==null) return null;
  const diff=SUBMISSIONS_CLOSE_MS-now;
  if(diff<=0) return null;
  const totalSec=Math.floor(diff/1000);
  const h=Math.floor(totalSec/3600);
  const m=Math.floor((totalSec%3600)/60);
  const s=totalSec%60;
  const hh=String(h).padStart(2,"0"), mm=String(m).padStart(2,"0"), ss=String(s).padStart(2,"0");
  return(
    <div style={{display:"flex",justifyContent:"center"}}>
      <style>{`@keyframes cdtPulse{0%,100%{transform:scale(1);opacity:0.92}50%{transform:scale(1.04);opacity:1}}
        @media(max-width:760px){.scPill{flex-wrap:nowrap!important;gap:5px!important;padding:6px 10px!important}.scTxt{font-size:11px!important}.scClock{font-size:13px!important}}`}</style>
      <div className="scPill" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap",
        maxWidth:"100%",padding:"8px 16px",borderRadius:999,textAlign:"center",animation:"cdtPulse 2.4s ease-in-out infinite",
        background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",
        border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"}}>
        <span className="scTxt" style={{fontSize:13,color:"#cbd5e1",fontWeight:600,whiteSpace:"nowrap"}}>Falta</span>
        <span className="scClock" style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:"#fcd34d",whiteSpace:"nowrap"}}>{hh}:{mm}:{ss}</span>
        <span className="scTxt" style={{fontSize:13,color:"#cbd5e1",fontWeight:600,whiteSpace:"nowrap"}}>para fechar as submissões de portefólio</span>
      </div>
    </div>
  );
}

// Settings are written through the admin API route (service_role key); the
// browser only reads them via loadGameSettings above.

/* ---- Keys ---------------------------------------------------------------- */
const K={MYNAME:"ci_myname",MYPIN:"ci_mypin"};

/* ============================================================================
   ROOT
   ============================================================================ */
/* ---- Routing por hash: URL = fonte de verdade (back/forward + links partilháveis) ----
   Os links usam o SLUG do nome (ex.: #p/tiago-almeida), resolvido AO VIVO a partir da lista
   de membros — vale para os atuais e os futuros. Aceita ainda links antigos por id (UUID).
   O duelo separa os dois slugs por "~". */
const keyToId=(k)=>k?String(k).replace(/^pf_/,""):"";
const slugify=(s)=>norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
function findBySlug(list,slug){ return slug?(list||[]).find(p=>slugify(p.name)===slug||keyToId(p.key)===slug)||null:null; }
function routeToPath(r){
  if(r.page==="detail") return r.detailSlug?`/p/${r.detailSlug}`:"/minhas"; // sem slug = "Minhas 8" (deslogado → Área bloqueada)
  if(r.page==="duel"&&r.duelSlugs?.[0]&&r.duelSlugs?.[1]) return `/duel/${r.duelSlugs[0]}~${r.duelSlugs[1]}`;
  if(r.page==="ranking") return "/ranking";
  if(r.page==="ath")     return "/ath";
  if(r.page==="create")  return "/criar";
  if(r.page==="confirm") return "/confirmar";
  if(r.page==="admin")   return "/admin";
  return "/"; // home
}
function parseRoute(){
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

export default function App(){
  const [page,setPage]=useState("home"); // home|create|confirm|ranking|detail|admin
  const [loading,setLoading]=useState(true);
  const [settings,setSettings]=useState(null);
  const [portfolios,setPortfolios]=useState([]);
  const [spyHist,setSpyHist]=useState(null);
  const [monthBase,setMonthBase]=useState({}); // {ticker:preço} baseline do mês atual (mini-época mensal)
  const [pastBaselines,setPastBaselines]=useState({}); // {period:{ticker:preço}} p/ campeões de meses fechados
  const [rankPeriod,setRankPeriod]=useState("total"); // toggle Geral|Mensal|Semanal — elevado p/ o Shell trocar o fundo
  const [weekBase,setWeekBase]=useState({}); // {ticker:abertura} da semana atual (rentabilidade ao vivo)
  const [weekOpens,setWeekOpens]=useState({}); // {weekKey:{ticker:abertura}} todas as semanas
  const [weekCloses,setWeekCloses]=useState({}); // {weekKey:{ticker:fecho}} semanas já fechadas (6ª ao fecho)
  const [myName,setMyName]=useState(null);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [livePrices,setLivePrices]=useState({});
  const [dayChange,setDayChange]=useState({}); // variação do dia por ticker
  const [pricesLoading,setPricesLoading]=useState(false);
  const [detailSlug,setDetailSlug]=useState(null);
  const [duelSlugs,setDuelSlugs]=useState(null); // [slugA, slugB] para o duelo 1v1
  const [toast,setToast]=useState(null);
  const [rankHighlight,setRankHighlight]=useState(null); // key da linha a destacar ao VOLTAR de um detalhe
  const rankHighlightRef=useRef(null); rankHighlightRef.current=rankHighlight;

  const showToast=useCallback((msg,kind="ok")=>{ setToast({msg,kind}); setTimeout(()=>setToast(null),3500); },[]);

  // Routing por caminho (URLs limpos, sem #); navegar empurra o caminho (back/forward funciona).
  const applyRoute=useCallback(()=>{
    const r=parseRoute();
    setPage(r.page);
    setDetailSlug(r.detailSlug??null);
    setDuelSlugs(r.duelSlugs??null);
  },[]);
  const goRoute=useCallback((r)=>{
    if(typeof window!=="undefined") window.history.pushState(null,"",routeToPath(r));
    applyRoute();
  },[applyRoute]);
  const slugForKey=useCallback((key)=>{ const pf=portfolios.find(p=>p.key===key); return pf?(slugify(pf.name)||keyToId(key)):keyToId(key); },[portfolios]);
  const nav=useCallback((p)=>{ setRankHighlight(null); goRoute({page:p}); },[goRoute]);
  // Ir DIRETO a um separador do Ranking (Geral/Mensal/Semanal) a partir do menu de topo.
  const navRank=useCallback((per)=>{ setRankHighlight(null); setRankPeriod(per); goRoute({page:"ranking"}); },[goRoute]);
  const openDetail=useCallback((k)=>{ setRankHighlight(null); goRoute({page:"detail",detailSlug:slugForKey(k)}); },[goRoute,slugForKey]);
  const openDuel=useCallback((a,b)=>goRoute({page:"duel",duelSlugs:[slugForKey(a),slugForKey(b)]}),[goRoute,slugForKey]);

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
        official,
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
          side,
          currency
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
      // Pré-lançamento: as ações dos oficiais estão ocultas ao anon (privacidade).
      // Buscar as TUAS próprias (nome + código) para o teu detalhe funcionar.
      if(isPreLaunch(gs)&&mn?.trim()){
        const myPin=sget(K.MYPIN);
        if(myPin){
          try{
            const r=await fetch("/api/portfolio/mine",{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({name:mn.trim(),pin:String(myPin)})});
            const d=await r.json();
            if(d?.ok&&Array.isArray(d.stocks)&&d.stocks.length){
              const mine=d.stocks.map(s=>({ticker:s.ticker,companyName:s.company_name,exchange:"",
                side:s.side==="short"?"short":"long",initialPrice:Number(s.initial_price),
                initialWeight:Number(s.initial_weight)/100,currency:s.currency||"USD",allocated:PER_STOCK}));
              const i=pfs.findIndex(p=>p.normName===norm(mn.trim()));
              if(i>=0) pfs[i]={...pfs[i],stocks:mine};
            }
          }catch{}
        }
      }
      setPortfolios(pfs);
      await refreshLivePrices(pfs);
    }

    // S&P 500 benchmark history (cached server-side). Non-blocking failure: if
    // unavailable, the benchmark simply doesn't render.
    fetchStockHistory("SPY").then(h=>setSpyHist(h&&h.length?h:null)).catch(()=>{});

    // Baselines mensais (mini-época "Campeão do mês"). Falha em silêncio → cai no total.
    supabase.from("monthly_baselines").select("period,ticker,price").then(({data})=>{
      const period=new Date().toISOString().slice(0,7); // 'YYYY-MM' (UTC)
      const cur={}, past={};
      (data||[]).forEach(r=>{ const price=Number(r.price); if(!(price>0)) return;
        (past[r.period]=past[r.period]||{})[r.ticker]=price;
        if(r.period===period) cur[r.ticker]=price; });
      setMonthBase(cur); setPastBaselines(past);
    }).catch(()=>{});

    // Baselines semanais (mini-época "Vencedor da Semana"): abertura (2ª) + fecho (6ª). Falha em silêncio.
    supabase.from("weekly_baselines").select("period,ticker,price,close_price").then(({data})=>{
      const wk=weekKey(new Date()); // 2ª feira UTC da semana atual
      const cur={}, opens={}, closes={};
      (data||[]).forEach(r=>{ const o=Number(r.price); const c=r.close_price==null?null:Number(r.close_price);
        if(o>0){ (opens[r.period]=opens[r.period]||{})[r.ticker]=o; if(r.period===wk) cur[r.ticker]=o; }
        if(c>0){ (closes[r.period]=closes[r.period]||{})[r.ticker]=c; } });
      setWeekBase(cur); setWeekOpens(opens); setWeekCloses(closes);
    }).catch(()=>{});

    let submitted=false;
    if(mn?.trim()){
      const { data: userRow, error: userError }=await supabase
        .from("users")
        .select("has_submitted_portfolio")
        .eq("telegram_name_lower", mn.trim().toLowerCase())
        .maybeSingle();
      if(!userError&&userRow) submitted=userRow.has_submitted_portfolio===true;
    }
    setHasSubmitted(submitted);
    setLoading(false);
  },[refreshLivePrices]);

  useEffect(()=>{ load(); },[load]);
  // Ao mudar de ecrã (ou de portefólio aberto), começa no topo do scroll.
  // Scroll para o topo ao mudar de página — EXCETO ao voltar ao ranking com uma linha a destacar
  // (nesse caso o Ranking faz scroll para essa linha).
  useEffect(()=>{ if(typeof window!=="undefined" && !(page==="ranking"&&rankHighlightRef.current)) window.scrollTo(0,0); },[page,detailSlug,duelSlugs]);

  // Routing por caminho: aplica a rota no arranque e em back/forward.
  // Inclui a entrada de admin (/admin) e os links partilháveis (/p/<slug>, /duel/<a>~<b>).
  useEffect(()=>{
    // Migra links antigos com hash (/#p/...) para caminho limpo, sem recarregar.
    if(typeof window!=="undefined" && window.location.hash){
      window.history.replaceState(null,"",routeToPath(parseRoute()));
    }
    applyRoute();
    window.addEventListener("popstate",applyRoute);
    return()=>{ window.removeEventListener("popstate",applyRoute); };
  },[applyRoute]);

  const myPf=useMemo(()=>{
    if(!myName) return null;
    const n=norm(myName);
    return portfolios.find(p=>p.normName===n)||null;
  },[myName,portfolios]);
  const openMyPortfolio=useCallback(()=>{ if(myPf?.key) openDetail(myPf.key); else nav("detail"); },[myPf,openDetail,nav]);

  const submitted=hasSubmitted;

  const ranking=useMemo(()=>
    portfolios.map(p=>({...p,...pfStats(p,livePrices)}))
      .sort((a,b)=>(Number.isFinite(b.total)?b.total:-Infinity)-(Number.isFinite(a.total)?a.total:-Infinity))
  ,[portfolios,livePrices]);
  // Vencedores das mini-épocas JÁ FECHADAS (mês/semana) → badge na página de portefólio do vencedor.
  const winners=useMemo(()=>{
    const map={}; const add=(key,kind,label)=>{ (map[key]=map[key]||{monthly:[],weekly:[]})[kind].push(label); };
    const offs=ranking.filter(p=>p.official);
    // Mensal: mês fechado = já existe o baseline do mês seguinte. Vencedor = melhor open→open seguinte.
    const curM=new Date().toISOString().slice(0,7);
    for(const per of Object.keys(pastBaselines).sort()){ if(per>=curM) continue;
      const from=pastBaselines[per], to=pastBaselines[nextPeriod(per)]; if(!from||!to) continue;
      let best=null; for(const p of offs){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best) add(best.p.key,"monthly",periodLabel(per)); }
    // Semanal: semana fechada = tem fecho de 6ª feira (weekCloses); + semeadas (WEEK_SEED_CHAMPS).
    const curW=weekKey(new Date()); const seen=new Set();
    for(const per of Object.keys(weekCloses).sort()){ if(per>=curW) continue;
      const from=weekOpens[per], to=weekCloses[per]; if(!from||!to) continue;
      let best=null; for(const p of offs){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best){ add(best.p.key,"weekly",weekLabel(per)); seen.add(per); } }
    for(const seed of WEEK_SEED_CHAMPS){ if(seen.has(seed.period)) continue;
      const p=offs.find(x=>x.normName===norm(seed.name)); if(p) add(p.key,"weekly",weekLabel(seed.period)); }
    return map;
  },[ranking,pastBaselines,weekOpens,weekCloses]);
  // Popularidade por ação na competição (liga a aba ATH ao jogo): quantos oficiais têm cada ticker.
  const compStats=useMemo(()=>{
    const off=ranking.filter(p=>p.official); const counts={};
    for(const p of off) for(const s of (p.stocks||[])){ const k=tkNorm(s.ticker); if(k) counts[k]=(counts[k]||0)+1; }
    return { counts, members:off.length, tickers:Object.keys(counts) };
  },[ranking]);

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
    return { now, returnFor, priceAt: closeOnOrBefore };
  },[livePrices,spyHist]);

  async function doSubmit(name,stocks,pin){
    // All validation + the authoritative price snapshot happen server-side
    // (/api/portfolio/submit) using the service_role key — the browser never
    // writes to the database directly, so initial_price can't be forged.
    const trimmedName=name.trim();
    if(!trimmedName) return{error:"Escreve o teu nome."};
    if(!/^\d{3}$/.test(String(pin||""))) return{error:"Escolhe um código de 3 dígitos (só números)."};
    let res,data;
    try{
      res=await fetch("/api/portfolio/submit",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name:trimmedName, pin:String(pin), stocks:stocks.map(s=>({ticker:s.ticker,name:s.name,side:s.side==="short"?"short":"long"})) }),
      });
      data=await res.json();
    }catch{
      return{error:"Falha de ligação. Tenta novamente."};
    }
    if(!res.ok||!data?.ok) return{error:data?.error||"Não foi possível submeter o portefólio."};

    sset(K.MYNAME, trimmedName);
    sset(K.MYPIN, String(pin)); // teu próprio código, no teu dispositivo (para veres o teu portefólio no pré-lançamento)
    setMyName(trimmedName);
    await load();
    setHasSubmitted(true);
    nav("ranking");
    return{ok:true};
  }

  // Returning member (closed window / outro dispositivo): re-identifica por nome
  // + código de 3 dígitos (anti-impersonação), validado no servidor.
  async function recoverByName(rawName,pin){
    const name=(rawName||"").trim();
    if(!name) return{error:"Escreve o teu nome."};
    if(!/^\d{3}$/.test(String(pin||""))) return{error:"Escreve o teu código de 3 dígitos."};
    let res,data;
    try{
      res=await fetch("/api/portfolio/recover",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name, pin:String(pin) }),
      });
      data=await res.json();
    }catch{ return{error:"Falha de ligação. Tenta novamente."}; }
    if(!res.ok||!data?.ok) return{error:data?.error||"Não foi possível verificar o nome/código."};
    sset(K.MYNAME, data.name||name);
    sset(K.MYPIN, String(pin));
    setMyName(data.name||name);
    await load(); // recarrega já com o código guardado → junta as tuas ações (sem 2º pedido)
    setHasSubmitted(true);
    nav("ranking");
    return{ok:true};
  }

  if(loading) return(
    <div style={{minHeight:"100vh",
      background:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",
      backgroundAttachment:"fixed",
      display:"flex",alignItems:"center",justifyContent:"center",color:"#4b5563",fontFamily:"var(--font-app), system-ui, sans-serif"}}>
      <style>{`@keyframes cdiPulse{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
      <img src="/logo.png" alt="A carregar…"
        style={{width:"clamp(96px,16vw,140px)",height:"auto",animation:"cdiPulse 1.4s ease-in-out infinite"}}/>
    </div>
  );

  // Lugar (rank) do portefólio em detalhe — ao vivo, dentro do grupo (demo/oficial).
  // 0 = sem classificação ("em espera"). Usado para o tema da página e pelo <Detail>.
  const detailPf=findBySlug(portfolios,detailSlug)||myPf;
  const detailRank=(()=>{
    if(!detailPf) return 0;
    if(detailPf.official&&isPreLaunch(settings)) return 0;
    const group=ranking.filter(r=>r.official===detailPf.official);
    const i=group.findIndex(r=>r.key===detailPf.key);
    return i>=0?i+1:0;
  })();
  const detailIsOwn=detailPf?detailPf.normName===norm(myName):false;
  // Cor do hover das linhas de ação, a condizer com o tema da página (JS = ganha sempre).
  const rowHover=detailRank===1?"#1d1407":detailRank===2?"#12151c":detailRank===3?"#1a0f06":"#0a1120";

  const sh=(children)=><Shell page={page} rankPeriod={rankPeriod} detailRank={detailRank} detailIsOwn={detailIsOwn} nav={nav} navRank={navRank} submitted={submitted} toast={toast}
    onMyPortfolio={openMyPortfolio}
    myPortfolioActive={page==="detail" && !!detailPf && !!myPf && detailPf.key===myPf.key}>{children}</Shell>;

  if(page==="home")   return sh(<Home nav={nav} submitted={submitted} settings={settings} ranking={ranking} livePrices={livePrices} onMyPortfolio={openMyPortfolio}/>);
  if(page==="create") return sh(submitted?<AlreadySubmitted nav={nav} name={myName}/>:<Create settings={settings} doSubmit={doSubmit} onDone={()=>nav("ranking")} showToast={showToast}/>);
  if(page==="confirm")return sh(<Confirm nav={nav} name={myName}/>);
  if(page==="ath")    return sh(<ATH myTickers={submitted&&myPf?(myPf.stocks||[]).map(s=>s.ticker):null} auth={submitted&&myName?{name:myName,pin:sget(K.MYPIN)}:null} pickCounts={compStats.counts} compTickers={compStats.tickers} showToast={showToast}/>);
  if(page==="ranking")return sh(<Ranking ranking={ranking} myNorm={norm(myName)} pricesLoading={pricesLoading} spy={spy} dayChange={dayChange} livePrices={livePrices} preLaunch={isPreLaunch(settings)} settings={settings} monthBase={monthBase} pastBaselines={pastBaselines} weekBase={weekBase} weekOpens={weekOpens} weekCloses={weekCloses} period={rankPeriod} setPeriod={setRankPeriod} onSelect={openDetail} onCompare={openDuel} highlightKey={rankHighlight} clearHighlight={()=>setRankHighlight(null)} showToast={showToast}/>);
  if(page==="duel")   return sh(submitted?<Duel a={findBySlug(ranking,duelSlugs?.[0])} b={findBySlug(ranking,duelSlugs?.[1])} livePrices={livePrices} spy={spy} dayChange={dayChange} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="detail") return sh(submitted?<Detail pf={detailPf} rank={detailRank} rowHover={rowHover} livePrices={livePrices} dayChange={dayChange} spy={spy} nav={nav} onBack={()=>{ setRankHighlight(detailPf?.key||null); goRoute({page:"ranking"}); }} myNorm={norm(myName)} preLaunch={isPreLaunch(settings)} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""} winners={winners} reload={load} showToast={showToast}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="admin")  return sh(<Admin settings={settings} setSettings={setSettings} portfolios={portfolios} ranking={ranking} livePrices={livePrices} reload={load} showToast={showToast}/>);
  return null;
}

/* ---- Shell --------------------------------------------------------------- */
function Shell({children,page,rankPeriod,detailRank,detailIsOwn,nav,navRank,submitted,toast,onMyPortfolio,myPortfolioActive}){
  // Premium (ouro/prata/bronze) SÓ no detalhe do Top 3. Tudo o resto — ranking, 4º+,
  // o próprio portefólio (quando fora do pódio), homepage, etc. — fica AZUL original.
  // Mesma lógica de degradê (brilho radial no topo + fade vertical).
  const GOLD={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(250,204,21,0.32) 0%, rgba(245,158,11,0.13) 38%, transparent 72%), linear-gradient(180deg,#261c0a 0%,#1c150b 55%,#120d08 80%,#0c0905 100%)",color:"#0c0905",tint:"rgba(250,204,21,0.16)",hover:"#33260a"};
  const SILVER={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(226,232,240,0.16) 0%, rgba(203,213,225,0.06) 38%, transparent 72%), linear-gradient(180deg,#1e222a 0%,#171b22 55%,#0f1216 80%,#0a0c0f 100%)",color:"#0a0c0f",tint:"rgba(203,213,225,0.15)",hover:"#161a22"};
  const BRONZE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(217,119,6,0.26) 0%, rgba(180,83,9,0.10) 38%, transparent 72%), linear-gradient(180deg,#241608 0%,#1b1109 55%,#120c07 80%,#0c0805 100%)",color:"#0c0805",tint:"rgba(217,119,6,0.18)",hover:"#2e1a0a"};
  const BLUE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",color:"#070d1c",tint:"rgba(59,130,246,0.16)",hover:"#0a1120"};
  // Tema ROXO da mini-época mensal (fundo muda em modo "Mensal") — escuro e sóbrio (deep indigo-purple).
  const PURPLE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(88,60,160,0.24) 0%, rgba(67,42,130,0.10) 42%, transparent 72%), linear-gradient(180deg,#1e1640 0%,#181230 52%,#110c24 80%,#0c0819 100%)",color:"#0c0819",tint:"rgba(109,80,200,0.16)",hover:"#140e2a"};
  // Tema TEAL da mini-época SEMANAL (fundo muda em modo "Semanal") — deep teal/esmeralda escuro e sóbrio.
  const TEAL={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(20,160,150,0.22) 0%, rgba(13,120,120,0.09) 42%, transparent 72%), linear-gradient(180deg,#0c2e2e 0%,#0a2626 52%,#071c1d 80%,#051315 100%)",color:"#051315",tint:"rgba(45,212,191,0.15)",hover:"#0a2422"};
  // TESTE: azul-petróleo/teal (referência) — só no ranking.
  const BLUE_REF={bg:"radial-gradient(1600px 1000px at 50% -6%, rgba(64,170,205,0.20) 0%, rgba(44,130,170,0.07) 40%, transparent 72%), linear-gradient(180deg,#16526a 0%,#123f52 50%,#0d2d3c 78%,#091e29 100%)",color:"#091e29",tint:"rgba(64,170,205,0.17)",hover:"#0a2430"};
  // ATH: brilho lavanda no canto superior direito + toque roxo à direita, azul-marinho a escurecer para quase preto.
  const ATHBG={bg:"radial-gradient(1500px 1150px at 82% -2%, rgba(210,208,230,0.42) 0%, rgba(150,150,192,0.16) 30%, transparent 58%), radial-gradient(1200px 1000px at 104% 30%, rgba(120,96,152,0.26) 0%, transparent 56%), radial-gradient(1300px 1000px at 20% 14%, rgba(86,104,168,0.18) 0%, transparent 60%), linear-gradient(165deg,#1e2540 0%,#151b2f 44%,#0a0e1c 78%,#060810 100%)",color:"#060810",tint:"rgba(170,158,214,0.18)"};
  // Pódio → ouro/prata/bronze. Ranking + detalhe de OUTROS (4º+/em espera) → azul
  // petróleo novo. O PRÓPRIO portefólio (fora do pódio) e a homepage → azul original.
  const medal=page==="detail"?(detailRank===1?GOLD:detailRank===2?SILVER:detailRank===3?BRONZE:null):null;
  // ATH = tema roxo; pódio (top-3) = medal (ouro/prata/bronze) acima; TUDO o resto
  // (homepage, ranking, duel, "Minhas 8" e os restantes portefólios) = o mesmo azul-marinho.
  const theme=medal||(page==="ath"?ATHBG:(page==="ranking"&&rankPeriod==="week"?TEAL:page==="ranking"&&rankPeriod==="month"?PURPLE:BLUE));
  return(
    <div style={{minHeight:"100vh",position:"relative","--row-hover":theme.hover||"#0a1120",
      backgroundColor:theme.color,transition:"background-color .6s ease",
      color:"#e2e8f0",fontFamily:"var(--font-app), system-ui, -apple-system, sans-serif",overflowX:"clip"}}>
      <BackgroundFade bg={theme.bg}/>
      <Aurora page={page}/>
      <style>{`
        @media(max-width:640px){.navWide{display:none}}
        .cdiNav{justify-content:center}
        .cdiClock{position:absolute;top:12px;right:14px}
        @media(max-width:640px){
          /* MOBILE: abas numa pílula liquid-glass no TOPO (sticky), com blur forte —
             o conteúdo passa de desfocado a nítido ao deslizar por baixo. Relógio por baixo. */
          .cdiClock{position:static;display:flex;justify-content:center;margin-top:10px}
          .cdiNav{
            width:max-content;max-width:calc(100% - 16px);margin:0 auto;
            justify-content:center;align-items:center;gap:4px;padding:3px 5px;border-radius:22px;flex-wrap:nowrap;
            background-color:var(--nav-tint,rgba(255,255,255,0.06));
            transition:background-color .6s ease;
            backdrop-filter:blur(42px) saturate(180%);-webkit-backdrop-filter:blur(42px) saturate(180%);
            border:1px solid rgba(255,255,255,0.14);
            box-shadow:0 8px 28px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.16);
          }
          .cdiNav>button{padding:6px 13px!important;font-size:13px!important}
          /* pílula selecionada mais alta que a barra → fica sobreposta/saliente.
             a margem negativa impede a barra de crescer (mantém-na fina). */
          .cdiNavSel{padding-top:12px!important;padding-bottom:12px!important;margin:-7px 0!important;
            box-shadow:0 7px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.22)!important}
        }
      `}</style>
      <header style={{position:"sticky",top:0,zIndex:50,padding:"12px 14px 20px"}}>
        {/* Vidro fosco estilo Apple: desfoca o conteúdo que passa por trás das abas e dissolve-se
            no fundo (máscara), sem tom escuro. Camada dedicada → não afeta as abas. */}
        <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:-1,pointerEvents:"none",
          backdropFilter:"blur(18px) saturate(160%)",WebkitBackdropFilter:"blur(18px) saturate(160%)",
          WebkitMaskImage:"linear-gradient(180deg,#000 0%,#000 58%,transparent 100%)",maskImage:"linear-gradient(180deg,#000 0%,#000 58%,transparent 100%)"}}/>
        <Nav page={page} nav={nav} navRank={navRank} rankPeriod={rankPeriod} submitted={submitted} onMyPortfolio={onMyPortfolio} myPortfolioActive={myPortfolioActive} tint={theme.tint} />
        <div className="cdiClock"><MarketStatus/></div>
      </header>
      <main className="cdiMain" style={{position:"relative",zIndex:1}}>{children}</main>
      <BackToTop maxWidth={page==="ranking"?900:page==="detail"?1320:(page==="ath"||page==="home")?940:null}/>
      <UpdateBanner/>
      {toast&&(
        <div className="cdiBottomFloat" style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:9999,
          width:"max-content",maxWidth:"min(92vw,440px)",
          background:toast.kind==="error"?"#1a0a0a":"#0a1a0f",border:`1px solid ${toast.kind==="error"?"#ef4444":"#22c55e"}`,
          borderRadius:12,padding:"12px 18px",fontSize:14,lineHeight:1.45,color:toast.kind==="error"?"#fca5a5":"#86efac",
          textAlign:"center",boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
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
  const countdown=st.open?"":fmtCountdown(msUntilMarketOpen());
  return(
    <>
      <style>{`
        @keyframes mktPulse{0%{box-shadow:0 0 8px var(--mk),0 0 0 0 var(--mk)}70%{box-shadow:0 0 8px var(--mk),0 0 0 6px transparent}100%{box-shadow:0 0 8px var(--mk),0 0 0 0 transparent}}
        @media(max-width:480px){.mktLabel{display:none}}
      `}</style>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
        <div title={st.label} style={{display:"inline-flex",alignItems:"center",gap:9,flexShrink:0,
          padding:"6px 13px 6px 11px",borderRadius:999,
          background:"rgba(255,255,255,0.05)",backdropFilter:"blur(18px) saturate(170%)",WebkitBackdropFilter:"blur(18px) saturate(170%)",
          border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10)"}}>
          <span style={{"--mk":`${c}90`,width:8,height:8,borderRadius:"50%",background:c,flexShrink:0,
            boxShadow:`0 0 8px ${c}`,animation:st.open?"mktPulse 2s ease-out infinite":"none"}}/>
          <span className="mktLabel" style={{fontSize:12,fontWeight:600,color:"#cbd5e1",letterSpacing:"0.2px",whiteSpace:"nowrap"}}>{st.label}</span>
          <span style={{fontSize:11,fontWeight:600,fontFamily:"monospace",color:"#94a3b8",whiteSpace:"nowrap"}}>
            {st.et} ET
          </span>
        </div>
        {countdown&&(
          <span style={{fontSize:10.5,fontFamily:"monospace",color:"#94a3b8",letterSpacing:"0.2px",whiteSpace:"nowrap"}}>
            {countdown}
          </span>
        )}
      </div>
    </>
  );
}

/* ---- Nav ----------------------------------------------------------------- */
function Nav({page,nav,navRank,rankPeriod,submitted,onMyPortfolio,myPortfolioActive,tint}){
  return(
    <div className="cdiNav" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"nowrap","--nav-tint":tint}}>
      <NavLink label="Início" active={page==="home"} onClick={()=>nav("home")}/>
      <RankingNav active={page==="ranking"} rankPeriod={rankPeriod} navToRanking={()=>nav("ranking")} navRank={navRank}/>
      <NavLink label="ATH" active={page==="ath"} onClick={()=>nav("ath")}/>
      <NavLink label="Minhas 8" active={submitted?myPortfolioActive:page==="detail"} onClick={onMyPortfolio} locked={!submitted}/>
    </div>
  );
}
// "Ranking" com submenu ao passar o rato: Geral / Mensal / Semanal → vai direto a esse separador.
function RankingNav({active,rankPeriod,navToRanking,navRank}){
  const [open,setOpen]=useState(false);
  const items=[["total","Geral"],["month","Mensal"],["week","Semanal"]];
  return(
    <div style={{position:"relative"}} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
      {/* Vindo de outra aba → vai direto ao Ranking Geral (e fecha o submenu). Já no Ranking →
          mantém o separador atual. */}
      <NavLink label="Ranking" active={active} onClick={()=>{ setOpen(false); active?navToRanking():navRank("total"); }} caret/>
      {open&&(
        // paddingTop = ponte invisível entre o botão e o menu → o rato não "sai" no espaço vazio.
        <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",paddingTop:8,zIndex:80}}>
          {/* Mesmo liquid glass do botão "Ranking" (fundo translúcido + blur + realce interior),
              mas estreito e centrado sob a palavra — lê-se como um submenu. */}
          <div style={{display:"flex",flexDirection:"column",gap:3,padding:5,borderRadius:16,
            background:"rgba(255,255,255,0.08)",backdropFilter:"blur(16px) saturate(180%)",WebkitBackdropFilter:"blur(16px) saturate(180%)",
            border:"1px solid rgba(255,255,255,0.14)",boxShadow:"0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.16)"}}>
            {items.map(([k,lbl])=>{
              const sel=active&&rankPeriod===k;
              return(
                <button key={k} onClick={()=>{ setOpen(false); navRank(k); }}
                  onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background="rgba(255,255,255,0.10)"; }}
                  onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background="transparent"; }}
                  style={{cursor:"pointer",textAlign:"center",fontSize:13.5,fontWeight:sel?700:600,whiteSpace:"nowrap",
                    padding:"7px 18px",borderRadius:11,border:"none",transition:"background .12s,color .12s",
                    color:sel?"#0a0a0a":"#e2e8f0",background:sel?"#4ade80":"transparent"}}>
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
// Plain text link; only the page we're on gets the liquid-glass pill.
function NavLink({label,active,onClick,locked,caret}){
  return(
    <button onClick={onClick} className={active?"cdiNavSel":undefined}
      onMouseEnter={e=>{ if(!active) e.currentTarget.style.color="#e2e8f0"; }}
      onMouseLeave={e=>{ if(!active) e.currentTarget.style.color="#9aa4b2"; }}
      style={{cursor:"pointer",fontSize:14,fontWeight:active?600:500,padding:"8px 16px",borderRadius:999,
        color:active?"#e2e8f0":"#9aa4b2",
        background:active?"rgba(255,255,255,0.08)":"transparent",
        backdropFilter:active?"blur(16px) saturate(180%)":"none",
        WebkitBackdropFilter:active?"blur(16px) saturate(180%)":"none",
        border:`1px solid ${active?"rgba(255,255,255,0.14)":"transparent"}`,
        boxShadow:active?"0 4px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.16)":"none",
        transition:"color 0.15s",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",flexShrink:0}}>
      {label}{caret&&<span style={{fontSize:9,opacity:0.65,marginLeft:1}}>▾</span>}{locked&&<span style={{fontSize:10,opacity:0.5}}>🔒</span>}
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
        @media(max-width:768px){.cdiWinners{grid-template-columns:repeat(2,minmax(0,1fr))}.winMetric{text-align:center}.winMetric>div{justify-content:center}}
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
  1:{background:"linear-gradient(145deg,#fde68a,#f59e0b)",color:"#3a2800",boxShadow:"0 0 14px rgba(245,158,11,0.55), 0 3px 12px rgba(245,158,11,0.4)"},
  2:{background:"linear-gradient(145deg,#f8fafc,#94a3b8)",color:"#1e293b",boxShadow:"0 0 12px rgba(203,213,225,0.5), 0 3px 10px rgba(148,163,184,0.3)"},
  3:{background:"linear-gradient(145deg,#fcd9a8,#b45309)",color:"#2e1800",boxShadow:"0 0 12px rgba(217,119,6,0.5), 0 3px 10px rgba(180,83,9,0.3)"},
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
    <div onClick={onClick} className="winCard"
      onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=isTop?"0 18px 46px rgba(251,191,36,0.16), 0 0 0 1px rgba(251,191,36,0.32), inset 0 1px 0 rgba(255,255,255,0.16)":"0 18px 46px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow=baseShadow; }}
      style={{cursor:"pointer",borderRadius:22,padding:22,
        background:isTop
          ? "linear-gradient(160deg, rgba(251,191,36,0.12) 0%, rgba(255,255,255,0.045) 38%, rgba(255,255,255,0.025) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.028) 100%)",
        backdropFilter:"blur(22px) saturate(170%)",WebkitBackdropFilter:"blur(22px) saturate(170%)",
        border:`1px solid ${isTop?"rgba(251,191,36,0.38)":"rgba(255,255,255,0.10)"}`,
        boxShadow:baseShadow,transition:"transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:18}}>
        <div style={{width:32,height:32,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:13,fontWeight:800,...badge}}>{rank}</div>
        <span style={{fontWeight:700,fontSize:"clamp(12.5px,3.4vw,16px)",letterSpacing:"-0.4px",flex:1,minWidth:0,lineHeight:1.2,overflowWrap:"anywhere"}}>{p.name}</span>
      </div>
      <div className="winMetric" style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:13,color:col}}>{up?"▲":"▼"}</span>
          <span style={{fontFamily:"'SF Mono',ui-monospace,monospace",fontWeight:800,fontSize:30,letterSpacing:"-1.5px",color:col}}>
            <Rolling text={pct(Math.abs(p.total)).replace(/[+-]/,"")}/>
          </span>
        </div>
        <span style={{display:"block",fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",marginTop:2}}>rentab. média</span>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {p.stocks.map(s=>{ const g=stockRet(s,livePrices)>=0; return(
          <span key={s.ticker} title={s.companyName||s.ticker} style={{flex:1,height:6,borderRadius:999,
            background:g?"linear-gradient(180deg,#34d399,#10b981)":"linear-gradient(180deg,#fb7185,#ef4444)",
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.25)"}}/>
        ); })}
      </div>
      <MiniSparkline series={series} current={p.total}/>
    </div>
  );
}

function MiniSparkline({series,current,height=48,fill=true,flat=false}){
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={(isEx||flat)?undefined:"winSpark"} style={{width:"100%",height,display:"block",opacity:isEx?0.55:undefined}}>
      {fill&&!flat&&<>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity={isEx?0.16:0.32}/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`}/>
      </>}
      <path d={line} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"
        strokeDasharray={isEx?"5 4":undefined} vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

// Contagem animada 0 → alvo (ease-out), que ARRANCA quando entra no ecrã (scroll).
// Número da secção "competição em números" — SEM animação: mostra o valor de imediato.
function CountUp({to=0}){
  return <span>{Number(to||0).toLocaleString("pt-PT")}</span>;
}
function Home({nav,submitted,settings,ranking,livePrices,onMyPortfolio}){
  const officialCount=(ranking||[]).filter(p=>p.official).length;
  const compDay=(()=>{ const d=settings?.gameStartDate?new Date(settings.gameStartDate):null; if(!d||isNaN(d)) return 1; return Math.max(1,Math.min(365,Math.floor((Date.now()-d.getTime())/86400000)+1)); })();
  const iconProps={viewBox:"0 0 24 24",fill:"none",stroke:"#8ea2bf",strokeWidth:1.6,strokeLinecap:"round",strokeLinejoin:"round",width:22,height:22,"aria-hidden":true};
  return(
    <div>
      {/* Hero */}
      <section style={{position:"relative",overflow:"hidden",textAlign:"center",padding:"clamp(72px,11vw,116px) 24px 80px",maxWidth:900,margin:"0 auto"}}>
        {/* grelha de fundo subtil (esbatida nas bordas) */}
        <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:0,pointerEvents:"none",
          backgroundImage:"linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize:"clamp(34px,7vw,54px) clamp(34px,7vw,54px)",
          WebkitMaskImage:"radial-gradient(120% 90% at 50% 34%, #000 30%, transparent 78%)",
          maskImage:"radial-gradient(120% 90% at 50% 34%, #000 30%, transparent 78%)"}}/>
        <div style={{position:"relative",zIndex:1}}>
          <span style={{position:"relative",display:"inline-block",margin:"0 auto 32px"}}>
            <BreatheGlow color="rgba(245,200,80,0.5)" mid="rgba(245,158,11,0.16)" inset="-34% -16%" base={0.4} duration={9000}/>
            <span style={{position:"relative",zIndex:1,display:"inline-block"}}>
              <GoldGlow src="/logo.png" alt="Conversas de Investidores" maskSrc="/logo.png" glow={20}
                wrapStyle={{display:"block"}}
                imgStyle={{width:"clamp(120px,18vw,180px)",height:"auto"}}/>
            </span>
          </span>
          <h1 className="heroTitle" style={{fontSize:"clamp(46px,11vw,104px)",fontWeight:800,lineHeight:0.98,letterSpacing:"-0.03em",margin:"0 0 20px"}}>
            <span style={{display:"block",color:"#f1f5f9"}}>Conversas de</span>
            <span style={{display:"block",backgroundImage:"linear-gradient(180deg,#4ade80 0%,#22c55e 52%,#16a34a 100%)",
              WebkitBackgroundClip:"text",backgroundClip:"text",color:"transparent",paddingBottom:"0.08em"}}>Investidores.</span>
          </h1>
          <div style={{marginBottom:12}}><SubmissionCountdown settings={settings}/></div>
          <div style={{display:"inline-flex",alignItems:"center",gap:10,maxWidth:"min(92vw,460px)",
            background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.22)",borderRadius:999,
            padding:"8px 16px",marginBottom:24}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#22c55e",display:"inline-block",flexShrink:0}}/>
            <span style={{fontSize:"clamp(12px,3.4vw,13.5px)",lineHeight:1.4,color:"#86efac",fontWeight:600,textAlign:"center"}}>
              {isPreLaunch(settings)?<>Submissões encerradas · Competição começa 1 de julho</>:"Competição a decorrer"}
            </span>
          </div>
          <p style={{fontSize:"clamp(16px,2.4vw,20px)",color:"#94a3b8",lineHeight:1.55,maxWidth:600,margin:"0 auto 40px"}}>
            O <strong style={{color:"#e2e8f0",fontWeight:700}}>jogo de portefólios</strong> da nossa comunidade.{" "}<br className="heroBrk"/>
            Acompanha <strong style={{color:"#e2e8f0",fontWeight:700}}>ao vivo</strong> o ranking e a evolução ao longo da época.
          </p>
          <style>{`@media(max-width:520px){.heroTitle{letterSpacing:-0.02em;line-height:1.02}.heroBtns{flex-wrap:nowrap;gap:10px;align-items:stretch}.heroBtns>button{flex:1;min-width:0;padding:14px 10px!important;font-size:15px!important;line-height:1.2}.heroBrk{display:none}} `}</style>
          <div className="heroBtns" style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
            {submitted?(
              <>
                <Btn onClick={()=>nav("ranking")} primary large><span style={{display:"inline-flex",alignItems:"center",gap:9}}>Ver Ranking <Arrow/></span></Btn>
                <Btn onClick={onMyPortfolio} large>Minhas 8</Btn>
              </>
            ):(
              <>
                <Btn onClick={onMyPortfolio} primary large><span style={{display:"inline-flex",alignItems:"center",gap:9}}><LockIcon/> Minhas 8</span></Btn>
                <Btn onClick={()=>nav("ranking")} large><span style={{display:"inline-flex",alignItems:"center",gap:9}}>Ver Ranking <Arrow/></span></Btn>
              </>
            )}
          </div>
          {officialCount>0&&<p style={{marginTop:22,fontSize:13,color:"#6b7280"}}>{officialCount} {officialCount===1?"portefólio":"portefólios"} já submetidos</p>}
        </div>
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
          <WinnersGrid top={ranking.filter(p=>Number.isFinite(p.total)).slice(0,5)} livePrices={livePrices} nav={nav}/>
        </section>
      )}

      {/* A competição em números (métricas reais do jogo) */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <style>{`
          .statGrid{display:grid;grid-template-columns:1fr 1fr 1fr}
          .statGrid .statCell + .statCell{border-left:1px solid rgba(255,255,255,0.08)}
          @media(max-width:640px){.statGrid{grid-template-columns:1fr}.statGrid .statCell + .statCell{border-left:none;border-top:1px solid rgba(255,255,255,0.08)}}
        `}</style>
        <div style={{background:"transparent"}}>
          <div className="statGrid">
            {[
              {icon:<svg {...iconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,val:<CountUp to={officialCount}/>,label:"Participantes"},
              {icon:<svg {...iconProps}><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></svg>,val:<CountUp to={officialCount*8}/>,label:"Ações escolhidas"},
              {icon:<svg {...iconProps}><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,val:<><CountUp to={compDay}/><span style={{color:"#4b5563",fontWeight:700}}>/<CountUp to={365}/></span></>,label:"Dia da competição"},
            ].map((s,i)=>(
              <div key={i} className="statCell" style={{padding:"28px 20px",textAlign:"center"}}>
                <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:42,height:42,borderRadius:12,
                  background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",marginBottom:14}}>{s.icon}</div>
                <div style={{fontSize:"clamp(30px,7vw,44px)",fontWeight:800,letterSpacing:"-1.5px",lineHeight:1,color:"#e2e8f0",fontVariantNumeric:"tabular-nums"}}>{s.val}</div>
                <div style={{fontSize:11,color:"#6b7280",textTransform:"uppercase",letterSpacing:"1.5px",fontWeight:600,marginTop:10}}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <h2 style={{textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:40}}>Como funciona</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {n:"01",icon:"✏️",t:"Inscreveram-se",d:"Cada membro entrou com o mesmo nome que tem no grupo de Telegram da comunidade."},
            {n:"02",icon:"🔍",t:"Escolheram 8 ações",d:"Cada participante selecionou exatamente 8 ações do S&P 500 (peso igual)."},
            {n:"03",icon:"🚀",t:"Em competição",d:"As submissões estão encerradas e os portefólios bloqueados; a competição arranca a 1 de julho."},
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
        <div style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"clamp(22px,5vw,40px)"}}>
          <h2 style={{fontSize:22,fontWeight:700,marginBottom:28,letterSpacing:"-0.3px",textAlign:"center"}}>Regras do Jogo</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(260px,100%),1fr))",gap:"12px 40px"}}>
            {[
              "Cada participante criou 1 portefólio com 8 ações",
              "Cada ação representa 12,5% do portefólio (peso igual)",
              "Cada um podia abrir até 2 posições short",
              "Os portefólios dos outros só ficam visíveis quando a competição começar, a 1 de julho de 2026",
              "Depois de submetidos, os portefólios ficaram bloqueados",
              "As posições arrancam ao preço de abertura do mercado de 1 de julho",
              "A rentabilidade é calculada como a média das 8 ações",
              "A rentabilidade não inclui dividendos — conta só a variação de preço",
              "O ranking usa os preços de mercado mais recentes",
              "A competição dura 1 ano: o vencedor é apurado a 30 de junho de 2027",
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
            <h2 style={{fontSize:26,fontWeight:700,marginBottom:8,letterSpacing:"-0.5px"}}>A competição arranca a 1 de julho</h2>
            <p style={{fontSize:15,color:"#6b7280",marginBottom:28}}>As submissões estão encerradas. Entra com o teu nome e código para veres o teu portefólio, ou acompanha o ranking ao vivo.</p>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <Btn onClick={onMyPortfolio} primary large>Minhas 8 🔒</Btn>
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
  const [pin,setPin]=useState("");
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [picked,setPicked]=useState([]);
  const [submitting,setSubmitting]=useState(false);
  const [addingManual,setAddingManual]=useState(false);
  const [shortMode,setShortMode]=useState(false); // próxima posição: false=long, true=short
  const [checkingName,setCheckingName]=useState(false);
  const shortCount=picked.filter(p=>p.side==="short").length;

  // Valida o nome cedo (passo 1) para o utilizador não escolher 8 ações em vão.
  const proceedToStocks=async()=>{
    if(checkingName) return;
    const nm=name.trim();
    if(nm.length<2||!/^\d{3}$/.test(pin)) return;
    setCheckingName(true);
    try{
      const r=await fetch("/api/portfolio/check-name",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:nm})});
      const d=await r.json().catch(()=>({}));
      if(d.available===false){
        showToast("Já existe um portefólio registado com esse nome. Por favor, usa outro nome.","error");
        return;
      }
    }catch{ /* se a verificação falhar, deixa avançar; o submit valida na mesma */ }
    finally{ setCheckingName(false); }
    setStep(2);
  };

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
    let info=await fetchStockInfo(ticker);
    let resolved=ticker;
    // Se o ticker simples não resolver, tenta sufixos de bolsas europeias/globais
    // (ex.: RMS → RMS.PA = Hermès). Só quando não foi indicado um sufixo.
    if(info==null&&!ticker.includes(".")){
      const SUFFIXES=["PA","AS","DE","MC","MI","LS","L","SW","BR","ST","HE","CO","OL","VI","IR"];
      for(const sfx of SUFFIXES){
        const cand=`${ticker}.${sfx}`;
        const r=await fetchStockInfo(cand);
        if(r){ info=r; resolved=cand; break; }
      }
    }
    setAddingManual(false);
    if(info==null){
      showToast(`Não encontrámos cotação para "${ticker}". Verifica o ticker (ex.: AAPL, RMS.PA, GALP.LS).`,"error");
      return;
    }
    if(has(resolved)){ setQuery(""); return; }
    add({ ticker:resolved, name: info.name||resolved, exchange: info.exchange||"", currency: info.currency||"USD" });
  };
  const rem=t=>setPicked(p=>p.filter(s=>s.ticker!==t));
  const progress=picked.length/PORTFOLIO_SIZE;
  const submClosed=submissionsClosed(settings);

  async function submit(){
    if(picked.length!==PORTFOLIO_SIZE||!name.trim()||submitting) return;
    setSubmitting(true);
    const r=await doSubmit(name,picked,pin);
    setSubmitting(false);
    if(r.error){ showToast(r.error,"error"); return; }
    onDone();
  }

  if(submClosed) return(
    <div style={{maxWidth:680,margin:"0 auto",padding:"60px 20px 100px",textAlign:"center"}}>
      <div style={{fontSize:40,marginBottom:16}}>🔒</div>
      <h1 style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",marginBottom:10}}>Submissões encerradas</h1>
      <p style={{fontSize:15,color:"#94a3b8",lineHeight:1.6,marginBottom:28}}>O prazo de submissões já terminou — a competição arranca a 1 de julho. Acompanha tudo no ranking.</p>
      <Btn onClick={onDone} primary>Ver Ranking</Btn>
    </div>
  );
  return(
    <div style={{maxWidth:680,margin:"0 auto",padding:"40px 20px 80px"}}>
      <h1 style={{textAlign:"center",fontSize:32,fontWeight:800,letterSpacing:"-1px",marginBottom:8}}>Criar Portefólio</h1>
      <p style={{textAlign:"center",color:"#6b7280",marginBottom:40,fontSize:15}}>Escolhe as tuas 8 ações e entra no jogo</p>

      {/* Stepper */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:40}}>
        <StepDot n={1} active={step===1} done={step>1} label={step>1&&name.trim()?name.trim():"O teu nome"}/>
        <div style={{flex:1,maxWidth:80,height:1,background:step>1?"#22c55e":"#1f2937"}}/>
        <StepDot n={2} active={step===2} done={false} label="Escolher ações"/>
      </div>

      {submClosed&&(
        <div style={{background:"#1a1200",border:"1px solid rgba(251,191,36,0.3)",borderRadius:12,padding:"12px 16px",
          fontSize:14,color:"#fbbf24",marginBottom:20}}>
          🔒 As submissões estão fechadas de momento.
        </div>
      )}

      {/* Step 1 — nome + código */}
      {step===1&&(()=>{
        const pinOk=/^\d{3}$/.test(pin);
        const step1ok=name.trim().length>=2&&pinOk;
        return(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:32}}>
          <h2 style={{fontSize:18,fontWeight:700,marginBottom:6}}>O teu nome no Telegram</h2>
          <p style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Escreve exatamente o mesmo nome que aparece no grupo de Telegram da comunidade.</p>
          <input value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&step1ok) proceedToStocks(); }}
            placeholder="Ex: João Silva"
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:`1px solid ${name.trim().length>=2?"#22c55e":"#1f2937"}`,
              borderRadius:10,padding:"14px 16px",fontSize:16,color:"#e2e8f0",outline:"none",
              boxSizing:"border-box",transition:"border-color 0.2s",marginBottom:20}}/>
          <h2 style={{fontSize:18,fontWeight:700,marginBottom:6}}>Código de 3 dígitos</h2>
          <p style={{fontSize:14,color:"#6b7280",marginBottom:12}}>Escolhe um código secreto de 3 números. Vais precisar dele (com o teu nome) para voltares a aceder ao teu portefólio.</p>
          <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,3))}
            onKeyDown={e=>{ if(e.key==="Enter"&&step1ok) proceedToStocks(); }}
            type="password" inputMode="numeric" autoComplete="off" placeholder="• • •" maxLength={3}
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:`1px solid ${pinOk?"#22c55e":"#1f2937"}`,
              borderRadius:10,padding:"14px 16px",fontSize:22,letterSpacing:"6px",fontFamily:"monospace",color:"#e2e8f0",outline:"none",
              boxSizing:"border-box",transition:"border-color 0.2s"}}/>
          <p style={{fontSize:12,color:"#fbbf24",marginTop:10,lineHeight:1.5}}>
            ⚠ Guarda bem este código — só números, sem ele não consegues recuperar o teu portefólio noutro dispositivo.
          </p>
          <button onClick={()=>{ if(step1ok) proceedToStocks(); }}
            disabled={!step1ok||submClosed||checkingName}
            style={{width:"100%",marginTop:16,background:step1ok&&!submClosed?"#22c55e":"#1f2937",
              color:step1ok&&!submClosed?"#000":"#4b5563",border:"none",borderRadius:10,
              padding:"14px",fontSize:16,fontWeight:700,cursor:step1ok&&!checkingName?"pointer":"not-allowed",
              transition:"background 0.2s",opacity:checkingName?0.7:1}}>
            {checkingName?"A verificar…":"Continuar →"}
          </button>
        </div>
        );
      })()}

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
      <span style={{fontSize:14,fontWeight:active||done?600:400,color:active||done?"#e2e8f0":"#4b5563",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160}}>{label}</span>
    </div>
  );
}

/* ---- AlreadySubmitted ---------------------------------------------------- */
function AlreadySubmitted({nav,name}){
  return(
    <div style={{maxWidth:500,margin:"40px auto 80px",padding:"0 20px"}}>
      <button onClick={()=>nav("home")} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:20,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Voltar ao início
      </button>
      <div style={{textAlign:"center",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Já tens um portefólio submetido</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:28,lineHeight:1.6}}>
          Submeteste como <strong style={{color:"#e2e8f0"}}>{name}</strong>.<br/>
          O portefólio fica bloqueado após a submissão — só um administrador o pode alterar.
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
  const [pin,setPin]=useState("");
  const [busy,setBusy]=useState(false);
  const canRecover=name.trim().length>=2&&/^\d{3}$/.test(pin);
  async function recover(){
    if(busy||!canRecover) return;
    setBusy(true);
    const r=await recoverByName(name,pin);
    setBusy(false);
    if(r?.error) showToast(r.error,"error");
  }
  return(
    <div style={{maxWidth:480,margin:"40px auto 80px",padding:"0 20px"}}>
      <button onClick={()=>nav("ranking")} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:20,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Ranking
      </button>
      <div style={{textAlign:"center",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Área bloqueada</h1>
        <p style={{fontSize:14,color:"#94a3b8",marginBottom:0,lineHeight:1.6}}>
          As submissões estão encerradas e a competição já está a decorrer.<br/>
          Os portefólios dos membros só ficam visíveis para quem participa.
        </p>

        <div style={{marginTop:32,paddingTop:24,borderTop:"1px solid #1f2937"}}>
          <p style={{fontSize:13,color:"#94a3b8",marginBottom:12,lineHeight:1.6}}>
            Já submeteste o teu portefólio?<br/>
            Insere o teu nome de registo e o código de 3 dígitos para voltares a aceder.
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:8,maxWidth:260,margin:"0 auto"}}>
            <input value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") recover(); }}
              placeholder="O teu nome no Telegram"
              style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
                padding:"11px 14px",fontSize:14,color:"#e2e8f0",outline:"none",boxSizing:"border-box",textAlign:"center"}}/>
            <div style={{display:"flex",gap:8,alignItems:"stretch"}}>
              <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,3))}
                onKeyDown={e=>{ if(e.key==="Enter") recover(); }}
                type="text" inputMode="numeric" autoComplete="off" maxLength={3} placeholder="Código"
                style={{width:120,flexShrink:0,background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
                  padding:"11px 14px",fontSize:16,letterSpacing:"6px",fontFamily:"monospace",color:"#e2e8f0",outline:"none",boxSizing:"border-box",
                  textAlign:"center",WebkitTextSecurity:"disc",textSecurity:"disc"}}/>
              <button onClick={recover} disabled={busy||!canRecover}
                style={{flex:1,background:"#1a2a1a",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,
                  padding:"11px 14px",fontSize:14,color:"#4ade80",fontWeight:700,
                  cursor:busy||!canRecover?"default":"pointer",opacity:busy||!canRecover?0.5:1,whiteSpace:"nowrap"}}>
                {busy?"A verificar…":"Aceder"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Season Race (evolução multi-linha, estilo "season race") ------------ */
// Cores por posição: 1º ouro, 2º cinzento-claro, 3º bronze; 4º–10º cores bem distintas
// (sem tons parecidos entre si nem próximos do fundo azul-escuro). Usadas no gráfico Season
// Race, na legenda e no snapshot (via raceColorOf) → tudo coerente. O próprio ("tu") = branco.
const RACE_COLORS=["#facc15","#cbd5e1","#d97706","#4ade80","#2dd4bf","#38bdf8","#818cf8","#c084fc","#f472b6","#fb7185"];
// Eixo X: só dia (DD/MM). Tooltip: dia + hora (DD/MM HH:mm), em hora local.
function raceTick(iso){ const d=new Date(iso); if(Number.isNaN(d.getTime())) return String(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)}`; }
function raceFull(iso){ const d=new Date(iso); if(Number.isNaN(d.getTime())) return String(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; }
// Ignora pontos gravados com o mercado US fechado (cotações repetidas → linhas
// "achatadas"). Dias úteis, 9:30–16:15 ET (DST automático via fuso New York).
function isMktOpen(iso){
  const d=new Date(iso); if(Number.isNaN(d.getTime())) return false;
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(d);
  const v=k=>parts.find(x=>x.type===k)?.value;
  const wd=v("weekday"); if(wd==="Sat"||wd==="Sun") return false;
  let h=parseInt(v("hour"),10); if(h===24) h=0;
  const m=h*60+parseInt(v("minute"),10);
  return m>=570&&m<=975;
}
function SeasonRaceTooltip({active,payload,label}){
  if(!active||!payload||!payload.length) return null;
  const rows=[...payload].filter(p=>p.value!=null).sort((a,b)=>b.value-a.value);
  return(
    <div style={{background:"rgba(8,15,32,0.95)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"8px 11px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.45)"}}>
      <div style={{color:"#94a3b8",marginBottom:6,fontFamily:"monospace"}}>{raceFull(label)}</div>
      {rows.map(p=>(
        <div key={p.dataKey} style={{display:"flex",alignItems:"center",gap:8,lineHeight:1.6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
          <span style={{color:"#cbd5e1",flex:1,whiteSpace:"nowrap"}}>{p.dataKey}</span>
          <span style={{fontFamily:"monospace",fontWeight:700,color:p.value>=0?"#4ade80":"#f87171"}}>{p.value>=0?"+":""}{p.value.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
}
const raceColorOf=(p,i)=> p._me?"#ffffff":RACE_COLORS[i%RACE_COLORS.length];
// Cartão de partilha do Top 10 (fundos SÓLIDOS, sem blur → captura limpa com html-to-image).
const SNAP_W=1000;
function SnapshotCard({cardRef,shown,data,raceYMin,raceYMax,dateStr,compDay,dayTicks,hasSpy,valueOf}){
  const top10=shown.slice(0,10);
  return(
    <div ref={cardRef} style={{width:SNAP_W,boxSizing:"border-box",padding:34,
      background:"radial-gradient(1200px 700px at 50% -10%, rgba(37,99,235,0.22), transparent 70%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 100%)",
      color:"#e2e8f0",fontFamily:"system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
        <img src="/logo.png" alt="" width={52} height={52} style={{display:"block",flexShrink:0}}/>
        <div style={{display:"flex",flexDirection:"column",lineHeight:1.15}}>
          <span style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px"}}>CDI PICKER</span>
          <span style={{fontSize:14,color:"#94a3b8",fontWeight:600}}>Top 10 · {dateStr} · Dia {compDay}/365</span>
        </div>
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,padding:"14px 10px 4px"}}>
        <LineChart width={912} height={330} data={data} margin={{top:8,right:16,left:-6,bottom:0}}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
          <XAxis dataKey="t" tickFormatter={raceTick} ticks={dayTicks} tick={{fill:"#94a3b8",fontSize:12}} minTickGap={28} axisLine={false} tickLine={false}/>
          <YAxis domain={[raceYMin,raceYMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:12}} width={48} axisLine={false} tickLine={false}/>
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
          {shown.map((p,i)=>(
            <Line key={p.key} type="monotone" dataKey={p.name} stroke={raceColorOf(p,i)}
              strokeWidth={p._me?3.5:2.4} dot={false} connectNulls isAnimationActive={false}/>
          ))}
          {hasSpy&&<Line type="monotone" dataKey="S&P 500" stroke="#ffffff" strokeWidth={2} strokeDasharray="6 5" strokeOpacity={0.8} dot={false} connectNulls isAnimationActive={false}/>}
        </LineChart>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gridTemplateRows:"repeat(5,auto)",gridAutoFlow:"column",gap:"0 28px",marginTop:18}}>
        {top10.map((p,i)=>{ const v=valueOf?valueOf(p):p.total; return (
          <div key={p.key} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 4px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
            <span style={{width:22,textAlign:"center",fontWeight:800,fontSize:15,color:i===0?"#facc15":i===1?"#e2e8f0":i===2?"#d97706":"#94a3b8"}}>{i+1}</span>
            <span style={{width:10,height:10,borderRadius:"50%",background:raceColorOf(p,i),flexShrink:0}}/>
            <span style={{flex:1,minWidth:0,fontWeight:600,fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p._me?`${p.name} (tu)`:p.name}</span>
            <span style={{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontWeight:800,fontSize:15,color:v>=0?"#4ade80":"#f87171"}}>{v>=0?"+":""}{(v*100).toFixed(2)}%</span>
          </div>
        ); })}
      </div>
      <div style={{textAlign:"center",marginTop:32,fontSize:13,color:"#64748b",fontWeight:600,letterSpacing:.3}}>Conversas de Investidores</div>
    </div>
  );
}
function SeasonRace({ranking,preLaunch,myNorm,spy,competitionStarted,gameStartDate,periodStart,periodLabelText,frameStart,periodRetOf}){
  const [snaps,setSnaps]=useState([]); // [] em vez de null → o gráfico desenha logo (baseline início→agora)
  const nowIso=useMemo(()=>new Date().toISOString(),[]); // "agora" fixo → conteúdo do data estável (não re-anima)
  const [mounted,setMounted]=useState(false);
  const [hi,setHi]=useState(null); // portefólio em destaque (hover no nome ou na linha)
  const [snapOpen,setSnapOpen]=useState(false); // modal do snapshot (desktop)
  const [snapUrl,setSnapUrl]=useState("");      // data-URL (pré-visualização + descarregar)
  const [snapBlob,setSnapBlob]=useState(null);  // blob (copiar — sem fetch, seguro com o CSP)
  const [snapMsg,setSnapMsg]=useState("");
  const cardRef=useRef(null);
  useEffect(()=>{ setMounted(true); },[]);
  useEffect(()=>{
    if(!snapOpen){ setSnapUrl(""); setSnapBlob(null); setSnapMsg(""); return; }
    let cancel=false;
    const t=setTimeout(async()=>{
      try{
        if(!cardRef.current) return;
        // toBlob → blob direto (para copiar, sem fetch a data: que o CSP bloqueia);
        // FileReader → data-URL (para <img> e descarregar; img-src permite data:).
        const blob=await toBlob(cardRef.current,{pixelRatio:2,cacheBust:true,backgroundColor:"#0b1730"});
        if(cancel) return;
        if(!blob){ setSnapMsg("Falha ao gerar a imagem."); return; }
        setSnapBlob(blob);
        const rd=new FileReader();
        rd.onload=()=>{ if(!cancel) setSnapUrl(String(rd.result||"")); };
        rd.readAsDataURL(blob);
      }catch{ if(!cancel) setSnapMsg("Falha ao gerar a imagem."); }
    },300); // dá tempo ao gráfico/logo renderizarem antes de capturar
    return()=>{ cancel=true; clearTimeout(t); };
  },[snapOpen]);
  // Pré-1jul: linhas dos DEMOS (pré-visualização). Depois: Top 10 oficiais.
  // O próprio é SEMPRE incluído (mesmo fora do Top 10), com a linha destacada.
  const shown=useMemo(()=>{
    const pool=preLaunch
      ? ranking.filter(p=>!p.official&&Number.isFinite(p.total))
      : ranking.filter(p=>p.official&&Number.isFinite(p.total));
    let list=pool.slice(0,10);
    const me=myNorm?pool.find(p=>p.normName===myNorm):null; // só se estiver no mesmo grupo (tem dados)
    if(me&&!list.some(p=>p.id===me.id)) list=[...list,{...me,_me:true}];
    return list.map(p=>({...p,_me:p._me||(myNorm&&p.normName===myNorm)}));
  },[ranking,preLaunch,myNorm]);
  const ids=shown.map(p=>p.id).join(",");
  useEffect(()=>{
    const idList=ids?ids.split(","):[];
    if(!idList.length){ setSnaps([]); return; }
    let cancel=false;
    (async()=>{
      const { data }=await supabase
        .from("portfolio_snapshots").select("portfolio_id,captured_at,total_return")
        .in("portfolio_id",idList).order("captured_at",{ascending:true});
      if(!cancel) setSnaps(data||[]);
    })();
    return()=>{ cancel=true; };
  },[ids]);

  // MODO PERÍODO (mês OU semana): re-baseia ao início do período. A âncora de cada membro é o total
  // "trancado" no início do período = total_atual − rentabilidade_do_período (pfMonthRet/pfWeekRet, o
  // MESMO valor da coluna da tabela). Assim o ponto "agora" do gráfico iguala EXATAMENTE a tabela.
  // No mês de arranque (baseline do mês = preço de submissão → rentab. do mês = total) a âncora dá 0
  // → o gráfico Mensal fica = ao Geral (correto). Em agosto, a âncora = ganho submissão→1-ago, logo
  // as timelines divergem do Geral. (Antes ancorava ao 1.º snapshot do período — ex.: +7% — e
  // subvalorizava; era diferença-de-snapshots, o método injusto.)
  const rebase=useMemo(()=>{
    const t0Base=periodStart?`${periodStart}T00:00:00.000Z`:null;
    const ref={};
    if(t0Base&&periodRetOf){ shown.forEach(p=>{
      if(!Number.isFinite(p.total)) return;
      const pr=periodRetOf(p);
      if(Number.isFinite(pr)) ref[p.name]=p.total-pr; // âncora = total no início do período
    }); }
    return {t0Base,ref};
  },[shown,periodStart,periodRetOf]);
  const snapValueOf=(p)=> rebase.t0Base?(p.total-(rebase.ref[p.name]??0)):p.total; // valor por membro no snapshot
  const dataRaw=useMemo(()=>{
    const nameById={}; shown.forEach(p=>{ nameById[p.id]=p.name; });
    // Arranque de cada linha: 1 jul (oficial) / submissão (demos); em período, o início do período.
    const baseOf=()=> (competitionStarted&&gameStartDate)?`${String(gameStartDate).slice(0,10)}T00:00:00.000Z`:null;
    const {t0Base,ref}=rebase;
    const bases=shown.map(p=>baseOf()||p.submittedAt).filter(Boolean).sort();
    const t0=t0Base||bases[0]||null;
    const byT={};
    for(const s of (snaps||[])){
      const nm=nameById[s.portfolio_id]; if(!nm) continue;
      const t=s.captured_at; if(!t||!isMktOpen(t)) continue;   // ignora mercado fechado
      if(t0&&t<t0) continue;                                    // ignora antes do arranque
      // Geral: valor real. Período: re-baseado ao início (subtrai o valor de arranque do período).
      (byT[t]=byT[t]||{t})[nm]=(t0Base?(Number(s.total_return)-(ref[nm]??0)):Number(s.total_return))*100;
    }
    // ponto de "agora" (ao vivo). Timestamp FIXO (nowIso) → conteúdo estável.
    const nowRow=byT[nowIso]||{t:nowIso};
    shown.forEach(p=>{ if(Number.isFinite(p.total)) nowRow[p.name]=(t0Base?(p.total-(ref[p.name]??0)):p.total)*100; });
    byT[nowIso]=nowRow;
    // âncora a 0% no arranque comum (todas começam juntas).
    if(t0){
      const a=byT[t0]||{t:t0};
      shown.forEach(p=>{ if(!Number.isFinite(a[p.name])) a[p.name]=0; });
      byT[t0]=a;
    }
    // Benchmark S&P 500 ancorado a 0 no t0. Período: base = SPY no início; senão = spyInitialPrice.
    const spyBase=t0Base?(spy&&spy.priceAt?spy.priceAt(t0Base):null):(()=>{ for(const p of shown){ const b=p.spyInitialPrice; if(Number.isFinite(b)&&b>0) return b; } return null; })();
    if(spy&&spyBase>0&&!preLaunch){
      for(const t of Object.keys(byT)){
        if(t===t0){ byT[t]["S&P 500"]=0; continue; }
        const px=(t===nowIso)?spy.now:(spy.priceAt?spy.priceAt(t):null);
        if(Number.isFinite(px)&&px>0) byT[t]["S&P 500"]=(px/spyBase-1)*100;
      }
    }
    return Object.values(byT).sort((a,b)=>a.t<b.t?-1:1);
  },[snaps,shown,competitionStarted,gameStartDate,nowIso,spy,preLaunch,rebase]);
  // Referência estável: se o conteúdo não mudou (ex.: snapshots vazios a chegar no dia 1),
  // devolve o array anterior → o Recharts não re-desenha/re-anima a linha.
  const dataStable=useRef(null);
  const data=useMemo(()=>{
    const key=JSON.stringify(dataRaw);
    if(dataStable.current&&dataStable.current.key===key) return dataStable.current.val;
    dataStable.current={key,val:dataRaw};
    return dataRaw;
  },[dataRaw]);

  // MODO "GRELHA DE PARTIDA" (semana ainda não arrancou): desenha o gráfico VAZIO já com as
  // proporções certas — eixo X = 2ª→6ª feira da semana que vai começar, todos a 0%. Quando chegar
  // 2ª feira e o cron capturar os baselines, o pai passa a NÃO enviar frameStart → entra o gráfico
  // ao vivo com os dados reais (transição automática, mesmo componente).
  const frameMode=!!frameStart;
  const frameDays=useMemo(()=>{
    if(!frameStart) return null;
    const base=Date.parse(`${frameStart}T00:00:00.000Z`);
    return Array.from({length:5},(_,i)=>new Date(base+i*86400000).toISOString()); // 2ª..6ª (UTC)
  },[frameStart]);
  const frameData=useMemo(()=>{
    if(!frameDays) return null;
    return frameDays.map(t=>{ const row={t}; shown.forEach(p=>{ row[p.name]=0; }); return row; });
  },[frameDays,shown]);

  if(!shown.length) return null;
  const enoughData=data&&data.length>=2;
  // Uma marca por DIA no eixo X (evita "01/07" repetido: arranque 00:00 + abertura do dia 1).
  const dayTicks=(()=>{ const seen=new Set(),out=[]; for(const r of (data||[])){ const day=String(r.t).slice(0,10); if(!seen.has(day)){ seen.add(day); out.push(r.t); } } return out; })();
  const hasSpy=enoughData&&data.some(r=>Number.isFinite(r["S&P 500"]));
  // Domínio Y com folga moderada — inclui o S&P para a linha ficar sempre visível.
  const allVals=enoughData?data.flatMap(r=>[...shown.map(p=>r[p.name]),r["S&P 500"]]).filter(Number.isFinite):[];
  const yLo=Math.min(0,...allVals,0), yHi=Math.max(0,...allVals,0);
  const ySpan=Math.max(yHi-yLo,1);
  const raceYMin=Math.floor(yLo-Math.min(Math.max(ySpan*0.25,0.8),1.5));
  const raceYMax=Math.ceil(yHi+Math.min(Math.max(ySpan*0.12,0.4),1.5));

  const snapDate=fmtDateShort(nowIso);
  const snapDay=(()=>{ const d=gameStartDate?new Date(gameStartDate):null; if(!d||isNaN(d)) return 1; return Math.max(1,Math.min(365,Math.floor((Date.now()-d.getTime())/86400000)+1)); })();
  const snapDownload=()=>{ if(!snapUrl) return; const a=document.createElement("a"); a.href=snapUrl; a.download=`cdi-picker-top10-${nowIso.slice(0,10)}.png`; a.click(); };
  const snapCopy=async()=>{
    if(!snapBlob) return;
    try{
      if(!navigator.clipboard||typeof window.ClipboardItem==="undefined") throw new Error("no-api");
      // blob JÁ pronto (dentro do gesto do clique, sem fetch) → funciona em Chrome/Edge/Safari.
      await navigator.clipboard.write([new window.ClipboardItem({[snapBlob.type||"image/png"]:snapBlob})]);
      setSnapMsg("Imagem copiada ✓");
    }catch(e){ console.error("snapshot copy failed:",e); setSnapMsg("O browser não deixou copiar — descarrega em vez disso."); }
  };
  return(<>
    <style>{`.raceLegendV{display:none;flex-direction:column;gap:2px}@media(max-width:640px){.snapBtn{display:none}.raceLegendH{display:none}.raceLegendV{display:flex}}`}</style>
    <div style={{position:"relative",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:"20px 16px 12px"}}>
      {!frameMode&&(
      <button className="snapBtn" onClick={()=>setSnapOpen(true)} title="Guardar imagem do Top 10"
        style={{position:"absolute",top:12,right:12,zIndex:2,display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:9,cursor:"pointer",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",color:"#cbd5e1"}}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>)}
      <p style={{fontSize:12,margin:"0 0 12px",textAlign:"center",minHeight:17,lineHeight:1.4}}>
        {(()=>{
          const hp=hi&&shown.find(p=>p.name===hi);
          if(hp&&Number.isFinite(hp.total)) return(<>
            <span style={{color:"#e2e8f0",fontWeight:700}}>{hp._me?`${hp.name} (tu)`:hp.name}</span>
            {" · "}
            <span style={{fontFamily:"ui-monospace, monospace",fontWeight:800,color:hp.total>=0?"#4ade80":"#f87171"}}>{hp.total>=0?"+":""}{(hp.total*100).toFixed(2)}%</span>
          </>);
          return <span style={{color:"#94a3b8"}}>{preLaunch?"Pré-visualização com os portefólios demo. A partir de 1 de julho mostrará o Top 10 oficial":(periodStart||frameMode)?`Top 10 — ${periodLabelText}`:"Top 10 — rentabilidade ao longo da competição"}</span>;
        })()}
      </p>
      {!mounted?(
        <div style={{height:320}}/>
      ):frameMode?(
        // Grelha de partida: frame completo (2ª→6ª feira), todos a 0% — pronto a preencher 2ª feira.
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={frameData} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} ticks={frameDays} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={20} axisLine={false} tickLine={false}/>
            <YAxis domain={[-2,2]} ticks={[-2,-1,0,1,2]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            {/* Sem linhas nem legenda de nomes antes de a semana arrancar — só a moldura (eixos +
                grelha + linha dos 0%). As linhas e os nomes entram 2ª feira, com os dados reais. */}
          </LineChart>
        </ResponsiveContainer>
      ):!enoughData?(
        <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#4b5563",textAlign:"center"}}>
          Ainda sem histórico suficiente — o gráfico preenche-se a partir dos próximos dias.
        </div>
      ):(
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} ticks={dayTicks} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
            <YAxis domain={[raceYMin,raceYMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            <Tooltip content={<SeasonRaceTooltip/>}/>
            {shown.map((p,i)=>{
              const dim=hi&&hi!==p.name;
              return(
                <Line key={p.key} type="monotone" dataKey={p.name} name={p._me?`${p.name} (tu)`:p.name}
                  stroke={raceColorOf(p,i)}
                  strokeWidth={hi===p.name?(p._me?4.5:3.2):(p._me?3.5:2)}
                  strokeOpacity={dim?0.15:1}
                  dot={false} connectNulls isAnimationActive={true} animationDuration={1000} animationEasing="ease-out" animationBegin={i*30}
                  activeDot={hi===p.name?{r:4}:(p._me?{r:3.5}:false)}/>
              );
            })}
            {hasSpy&&<Line type="monotone" dataKey="S&P 500" name="S&P 500" stroke="#ffffff" strokeWidth={1.8} strokeDasharray="6 5" strokeOpacity={0.75} dot={false} connectNulls isAnimationActive={true} animationDuration={1000} animationEasing="ease-out"/>}
          </LineChart>
        </ResponsiveContainer>
      )}
      {mounted&&enoughData&&!frameMode&&(()=>{
        const item=(p,i)=>{
          const dim=hi&&hi!==p.name;
          return(
            <span key={p.key} onMouseEnter={()=>setHi(p.name)} onMouseLeave={()=>setHi(null)}
              style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"default",
                opacity:dim?0.3:1,transition:"opacity .15s ease"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:raceColorOf(p,i),flexShrink:0,
                boxShadow:hi===p.name?`0 0 0 3px ${raceColorOf(p,i)}33`:"none",transition:"box-shadow .15s ease"}}/>
              <span style={{fontSize:12.5,letterSpacing:.2,whiteSpace:"nowrap",
                color:hi===p.name?"#f1f5f9":"#94a3b8",fontWeight:hi===p.name?600:400,transition:"color .15s ease"}}>
                {p._me?`${p.name} (tu)`:p.name}
              </span>
            </span>
          );
        };
        const rowStyle={display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"6px 16px",padding:"0 4px"};
        return(
          <div style={{marginTop:14}}>
            {/* Desktop: legenda horizontal (nomes; hover destaca a linha). Top 3 na 1ª linha. */}
            <div className="raceLegendH">
              <div style={rowStyle}>{shown.slice(0,3).map((p,i)=>item(p,i))}</div>
              {shown.length>3&&<div style={{...rowStyle,marginTop:8}}>{shown.slice(3).map((p,i)=>item(p,i+3))}</div>}
            </div>
            {/* Mobile: lista vertical SEMPRE visível com a rentabilidade (não depende de ter o dedo
                no gráfico — o tooltip continua a funcionar ao tocar, para o valor num instante). */}
            <div className="raceLegendV">
              {shown.map((p,i)=>(
                <div key={p.key} style={{display:"flex",alignItems:"center",gap:9,padding:"5px 2px",borderTop:i===0?"none":"1px solid rgba(255,255,255,0.06)"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:raceColorOf(p,i),flexShrink:0}}/>
                  <span style={{flex:1,minWidth:0,fontSize:13.5,color:p._me?"#f1f5f9":"#cbd5e1",fontWeight:p._me?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p._me?`${p.name} (tu)`:p.name}</span>
                  <span style={{fontFamily:"ui-monospace, monospace",fontSize:13.5,fontWeight:800,color:(frameMode||!Number.isFinite(p.total))?"#64748b":(p.total>=0?"#4ade80":"#f87171")}}>{frameMode?"—":(Number.isFinite(p.total)?`${p.total>=0?"+":""}${(p.total*100).toFixed(2)}%`:"—")}</span>
                </div>
              ))}
            </div>
            {hasSpy&&!frameMode&&(
              <div style={{display:"flex",justifyContent:"center",marginTop:10}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:11.5,color:"#94a3b8"}}>
                  <span aria-hidden="true" style={{width:22,borderTop:"2px dashed #ffffff",opacity:0.8}}/>
                  S&amp;P 500 (benchmark)
                </span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
    {snapOpen && (<>
      <div aria-hidden="true" style={{position:"fixed",left:-99999,top:0,pointerEvents:"none"}}>
        <SnapshotCard cardRef={cardRef} shown={shown} data={data} raceYMin={raceYMin} raceYMax={raceYMax} dateStr={snapDate} compDay={snapDay} dayTicks={dayTicks} hasSpy={hasSpy} valueOf={snapValueOf}/>
      </div>
      <div onClick={()=>setSnapOpen(false)} style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(3,7,18,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#0a1428",border:"1px solid rgba(255,255,255,0.12)",borderRadius:16,padding:18,maxWidth:"min(94vw,720px)",width:"100%",maxHeight:"92vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <span style={{fontSize:15,fontWeight:800}}>Snapshot do Top 10</span>
            <button onClick={()=>setSnapOpen(false)} style={{background:"none",border:"none",color:"#94a3b8",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
          {snapUrl
            ? <img src={snapUrl} alt="Top 10" style={{display:"block",width:"100%",borderRadius:12,border:"1px solid rgba(255,255,255,0.10)"}}/>
            : <div style={{height:260,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontSize:14}}>A gerar imagem…</div>}
          <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:14,justifyContent:"center"}}>
            <button onClick={snapDownload} disabled={!snapUrl} style={{padding:"11px 20px",borderRadius:12,fontSize:14,fontWeight:800,cursor:snapUrl?"pointer":"default",background:"#22c55e",border:"none",color:"#06281a",opacity:snapUrl?1:0.5}}>Descarregar PNG</button>
            <button onClick={snapCopy} disabled={!snapUrl} style={{padding:"11px 20px",borderRadius:12,fontSize:14,fontWeight:700,cursor:snapUrl?"pointer":"default",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.16)",color:"#e2e8f0",opacity:snapUrl?1:0.5}}>Copiar imagem</button>
          </div>
          {snapMsg && <div style={{textAlign:"center",marginTop:10,fontSize:13,color:"#94a3b8"}}>{snapMsg}</div>}
        </div>
      </div>
    </>)}
  </>);
}

/* ---- Ranking ------------------------------------------------------------- */
// ⓘ com tooltip — hover (desktop) e toque (mobile). O popover abre PARA BAIXO
// para não ser cortado pelo overflow:hidden do cartão.
// Tooltip INSTANTÂNEO (sem o atraso do title nativo). Via portal p/ o body → não é recortado
// pelos painéis (overflow:hidden + backdrop-filter). Estado por-ícone: só re-renderiza este nó.
function HoverName({label,children,ring}){
  const [pos,setPos]=useState(null);
  const ref=useRef(null);
  const show=()=>{ const r=ref.current?.getBoundingClientRect(); if(r) setPos({x:r.left+r.width/2,y:r.top}); };
  return(
    <span ref={ref} onMouseEnter={show} onMouseLeave={()=>setPos(null)} style={{display:"flex",flexShrink:0,borderRadius:ring?8:undefined,boxShadow:ring?"0 0 0 2px #4ade80":undefined}}>
      {children}
      {pos&&typeof document!=="undefined"&&createPortal(
        <div style={{position:"fixed",left:pos.x,top:pos.y-8,transform:"translate(-50%,-100%)",zIndex:9999,pointerEvents:"none",
          background:"rgba(8,15,32,0.97)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:8,padding:"5px 9px",
          fontSize:11.5,lineHeight:1.3,color:"#e2e8f0",whiteSpace:"nowrap",fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
          {label}
        </div>, document.body)}
    </span>
  );
}
function InfoTip({text,children}){
  const [open,setOpen]=useState(false);
  return(
    <span style={{position:"relative",display:"inline-flex",verticalAlign:"middle"}}
      onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
      <span onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}
        style={children
          ?{display:"inline-flex",alignItems:"center",cursor:"help"}
          :{display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,
            width:14,height:14,borderRadius:"50%",border:"1px solid currentColor",fontSize:9,lineHeight:1,fontWeight:700,opacity:0.65}}>{children||"i"}</span>
      {open&&(
        <span onClick={e=>e.stopPropagation()} style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:100,width:230,
          background:"rgba(8,15,32,0.97)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"9px 12px",
          fontSize:11.5,lineHeight:1.45,color:"#cbd5e1",fontWeight:400,textTransform:"none",letterSpacing:"normal",whiteSpace:"pre-line",textAlign:"left",
          boxShadow:"0 10px 28px rgba(0,0,0,0.5)"}}>
          {text}
        </span>
      )}
    </span>
  );
}
function Ranking({ranking,myNorm,pricesLoading,spy,dayChange,livePrices,preLaunch,settings,monthBase,pastBaselines,weekBase,weekOpens,weekCloses,period,setPeriod,onSelect,onCompare,highlightKey,clearHighlight,showToast}){
  const [cmp,setCmp]=useState(false);
  const [sel,setSel]=useState([]);
  // Mini-curva por linha: snapshots por portefólio (histórico). Recarrega só quando o
  // conjunto de portefólios muda (não a cada atualização de preços).
  const [seriesById,setSeriesById]=useState({});
  const idsKey=ranking.map(p=>p.id).filter(Boolean).join(",");
  useEffect(()=>{
    let cancel=false;
    const ids=idsKey?idsKey.split(","):[];
    if(!ids.length){ setSeriesById({}); return; }
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
  },[idsKey]);
  const toggleSel=k=>setSel(s=>s.includes(k)?s.filter(x=>x!==k):(s.length>=2?[s[1],k]:[...s,k]));
  const nameByKey=k=>ranking.find(p=>p.key===k)?.name||"";
  const demos=ranking.filter(p=>!p.official);
  const officials=ranking.filter(p=>p.official);
  // Render progressivo: mostra o topo primeiro e anexa o resto DEPOIS do 1º paint → a aba
  // entra logo (não monta as 124 linhas de uma vez). Re-monta a cada entrada → rápido sempre.
  // Se vamos destacar uma linha (voltar de um detalhe), monta TUDO já — para poder fazer scroll até lá.
  const [shownRows,setShownRows]=useState(highlightKey?100000:24);
  const [query,setQuery]=useState(""); // pesquisa de membros (na caixa que substitui "#"/"Membro")
  const [posQuery,setPosQuery]=useState(""); // pesquisa por posição/empresa/ticker (coluna "Posições")
  const [sortKey,setSortKey]=useState("total"); // total (Rentab.) | day (Diário) — colunas ordenáveis
  const [sortDir,setSortDir]=useState("desc");  // desc = melhor no topo; 2º clique inverte (▲/▼)
  const onSort=(k)=>{ if(sortKey===k) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir("desc"); } };
  // Mini-época mensal ('total'=Ranking Geral, 'month'=corrida do mês): period/setPeriod vêm do App
  // (elevados para o Shell poder trocar o fundo para roxo em modo mensal).
  const monthOf=(p)=>pfMonthRet(p,monthBase,livePrices);
  const hasMonth=!!(monthBase&&Object.keys(monthBase).length); // só há corrida mensal distinta quando há baselines do mês (a partir de agosto)
  const hasWeek=!!(weekBase&&Object.keys(weekBase).length); // baseline da semana capturado (a partir de 2ª feira)
  // Pré-arranque (fim de semana): sem baseline da semana → devolve null (coluna "—", ordem geral).
  const weekOf=(p)=>hasWeek?pfWeekRet(p,weekBase,livePrices):null;
  const curWk=weekKey(new Date());                                  // 2ª feira UTC da semana atual
  // 2ª feira em que a semana VAI arrancar (grelha de partida do gráfico, pré-arranque semanal):
  // antes do arranque ao vivo → WEEK_LIVE_FROM; ao fim de semana → próxima 2ª; num dia útil → esta 2ª.
  const frameWk=(()=>{ const n=new Date(); const ymd=n.toISOString().slice(0,10); const dow=n.getUTCDay();
    if(ymd<WEEK_LIVE_FROM) return WEEK_LIVE_FROM; return (dow===0||dow===6)?nextWeek(curWk):curWk; })();
  const curMonthYM=new Date().toISOString().slice(0,7);             // 'YYYY-MM' (chave do monthBase)
  const curMonthStartIso=`${curMonthYM}-01T00:00:00.000Z`;         // abertura do mês (p/ spy.priceAt)
  const curMonthDateOnly=`${curMonthYM}-01`;                        // início do mês (p/ periodStart do gráfico)
  const preStartWk=period==="week"&&!hasWeek;                       // Semanal antes de arrancar (fim de semana)
  // Rentabilidade do JOGO ATIVO por membro (null no pré-arranque semanal → linhas/widgets neutros).
  const metricOf=(p)=>period==="week"?weekOf(p):period==="month"?monthOf(p):p.total;
  // Baseline do período para a rentabilidade de UMA ação (widget Performance). Cai no preço inicial se faltar.
  const baseForStock=(rawTicker,init)=>{
    if(period==="week"){ const b=weekBase&&weekBase[rawTicker]; return (Number.isFinite(b)&&b>0)?b:init; }
    if(period==="month"){ const b=monthBase&&monthBase[rawTicker]; return (Number.isFinite(b)&&b>0)?b:init; }
    return init; // total → desde o arranque
  };
  // S&P do período (linha "S&P 500" do widget vs S&P).
  const spyMetric=()=>{
    if(!spy) return null;
    if(period==="week"){ if(!hasWeek) return null; const b=spy.priceAt(`${curWk}T00:00:00.000Z`); return (Number.isFinite(b)&&b>0)?spy.now/b-1:null; }
    if(period==="month"){ const b=spy.priceAt(curMonthStartIso); return (Number.isFinite(b)&&b>0)?spy.now/b-1:null; }
    return officials.length?spy.returnFor(officials[0]):null; // total (como hoje)
  };
  // Coluna do nome = largura do NOME MAIS COMPRIDO (medido na fonte real) → todas as linhas
  // alinhadas e as sparklines começam todas no MESMO sítio (logo a seguir ao maior nome).
  const [nameW,setNameW]=useState(190);
  const namesKey=officials.map(p=>p.name).join("|");
  useEffect(()=>{
    if(typeof document==="undefined"||!officials.length) return;
    const el=document.createElement("span");
    el.style.cssText="position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font-weight:600;font-size:15px;font-family:var(--font-app),system-ui,-apple-system,sans-serif";
    document.body.appendChild(el);
    let max=0;
    for(const p of officials){ el.textContent=p.name||""; if(el.offsetWidth>max) max=el.offsetWidth; }
    document.body.removeChild(el);
    if(max>0) setNameW(Math.min(190,Math.ceil(max)+12)); // +12: respiro antes da linha + margem p/ o "Tu"
  },[namesKey]);
  // "Atualizado …" — igual ao ATH: o updated_at mais recente do sp500_ath (fonte dos preços).
  const [pricesAt,setPricesAt]=useState(null);
  useEffect(()=>{
    let cancel=false;
    supabase.from("sp500_ath").select("updated_at").order("updated_at",{ascending:false}).limit(1).maybeSingle()
      .then(({data})=>{ if(!cancel&&data?.updated_at) setPricesAt(data.updated_at); }).catch(()=>{});
    return()=>{cancel=true;};
  },[]);
  useEffect(()=>{
    if(shownRows>=officials.length) return;
    // ~150ms antes de montar o resto: dá tempo à rolagem dos números do TOPO arrancar. Como
    // a rolagem é uma transição de `transform` (corre no compositor/GPU), continua fluida mesmo
    // durante o render pesado do resto → deixa de haver o "0.00%" parado nas linhas visíveis.
    const t=setTimeout(()=>setShownRows(officials.length),150);
    return()=>clearTimeout(t);
  },[shownRows,officials.length]);
  // Voltar de um detalhe: faz scroll até à linha de origem e dá-lhe um destaque subtil (flash).
  const highlightRef=useRef(null);
  // "A tua posição": clicar faz scroll suave até à minha linha no ranking + flash subtil.
  const meRowRef=useRef(null);
  const [meFlash,setMeFlash]=useState(false);
  // Cartão do campeão (direita) e medalhão de vencedor (esquerda) alinhados ao CENTRO do gráfico
  // (medido em runtime; a legenda varia). Ambos mantêm o sticky — só desloca a posição inicial para
  // o meio do gráfico. Partilham o mesmo topo de célula (linha 1), só diferem na altura do conteúdo.
  const raceWrapRef=useRef(null), railChampRef=useRef(null), champStickyRef=useRef(null);
  const railBadgeRef=useRef(null), badgeStickyRef=useRef(null);
  const [champTop,setChampTop]=useState(0);
  const [badgeTop,setBadgeTop]=useState(0);
  // Altura das células laterais (linha do cabeçalho) = do TOPO da linha até ao FUNDO da box do gráfico.
  // Como o cartão é sticky, cede (sai de cena) exatamente quando o seu fundo encontra o fundo do
  // gráfico → é aí que "descolam" e sobem com o gráfico. null = ainda não medido / rail escondido.
  const [railH,setRailH]=useState(null);
  useIsoLayoutEffect(()=>{
    if(typeof window==="undefined") return;
    const measure=()=>{
      const race=raceWrapRef.current;
      if(!race) return;
      const r=race.getBoundingClientRect();
      if(r.height<=0) return;
      const mid=r.top+r.height/2; // centro vertical do gráfico (a "linha rosa" da guia)
      // As duas células estão na mesma linha (mesmo topo). Mede a partir do campeão (sempre presente).
      const champA=railChampRef.current;
      if(champA && champA.offsetParent!==null){
        setRailH(Math.max(0, Math.round(r.bottom - champA.getBoundingClientRect().top)));
      }
      const place=(aside,card,set)=>{
        if(!aside||!card) return;
        if(aside.offsetParent===null){ set(0); return; } // rail escondido (<1440px)
        if(card.offsetHeight<=0){ return; } // cartão vazio (ex.: medalhão no "Geral") → não mexe
        const a=aside.getBoundingClientRect();
        set(Math.max(0, Math.round(mid - a.top - card.offsetHeight/2)));
      };
      place(railChampRef.current, champStickyRef.current, setChampTop);
      place(railBadgeRef.current, badgeStickyRef.current, setBadgeTop);
    };
    measure();                                // síncrono, ANTES do paint → sem salto ao trocar de aba
    const raf=requestAnimationFrame(measure); // reforço p/ layout tardio (Recharts/imagens a carregar)
    const ro=new ResizeObserver(measure);
    if(raceWrapRef.current) ro.observe(raceWrapRef.current);
    if(champStickyRef.current) ro.observe(champStickyRef.current);
    if(badgeStickyRef.current) ro.observe(badgeStickyRef.current);
    window.addEventListener("resize",measure);
    return()=>{ cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("resize",measure); };
  },[period,hasWeek,preLaunch,officials.length,ranking.length]);
  const scrollToMe=()=>{
    const el=meRowRef.current; if(!el) return;
    el.scrollIntoView({behavior:"smooth",block:"center"});
    setMeFlash(true); setTimeout(()=>setMeFlash(false),2600);
  };
  useEffect(()=>{
    if(!highlightKey) return;
    let cancelled=false;
    const doScroll=()=>{ if(!cancelled&&highlightRef.current) highlightRef.current.scrollIntoView({block:"center",behavior:"auto"}); };
    // Re-centra a MESMA linha várias vezes enquanto o layout assenta: o gráfico (Recharts mede e
    // re-renderiza) e as imagens/sparklines carregam DEPOIS do 1.º paint e empurram a linha para
    // baixo — uma só tentativa cairia no sítio errado. Como é sempre a mesma linha + behavior:auto,
    // o membro fica visualmente centrado o tempo todo (sem solavancos).
    const rafs=[requestAnimationFrame(()=>{ doScroll(); rafs.push(requestAnimationFrame(doScroll)); })];
    const timers=[90,220,420,650].map(ms=>setTimeout(doScroll,ms));
    const tc=setTimeout(()=>{ if(!cancelled) clearHighlight&&clearHighlight(); },2600); // limpa o destaque no fim do flash
    return()=>{ cancelled=true; rafs.forEach(cancelAnimationFrame); timers.forEach(clearTimeout); clearTimeout(tc); };
  },[highlightKey]);
  const pfDayReturn=(p)=>pfDayRet(p,dayChange);
  const SortHd=({k,children})=>{
    const active=sortKey===k;
    return(
      <span onClick={()=>onSort(k)} title="Ordenar" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3,cursor:"pointer",userSelect:"none",color:active?"#e2e8f0":undefined}}>
        {children}
        <span aria-hidden="true" style={{fontSize:8,lineHeight:1,color:active?"#e2e8f0":"#475569"}}>{active?(sortDir==="asc"?"▲":"▼"):"▼"}</span>
      </span>
    );
  };
  const tableFor=(list,{searchable=false}={})=>{
    const perActive=searchable&&(period==="month"||period==="week"); // mini-época ativa (mês ou semana)
    const valForPeriod=period==="week"?weekOf:monthOf;
    // Semanal ANTES de arrancar (fim de semana): sem ranking/medalhas/Top10, sem Diário, sem 🟢/🔴 —
    // só fazem sentido a partir de 2ª feira, com a rentabilidade da semana. É um roster neutro.
    const preStartWk=searchable&&period==="week"&&!hasWeek;
    // Mini-época: reordena a base pela rentabilidade do período → o nº do lugar (#) reflete a
    // CLASSIFICAÇÃO da mini-época (corrida nova), não a geral. Geral: ordem tal como vem (por total).
    const src=perActive?[...list].sort((a,b)=>{ const va=valForPeriod(a),vb=valForPeriod(b); if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return vb-va; }):list;
    // Rank REAL anotado antes de ordenar/filtrar (a ordenação/filtro NÃO estraga o nº do lugar).
    const ranked=src.map((p,i)=>({...p,_rank:i+1}));
    const q=norm(query), pq=norm(posQuery);
    const matchesPos=(p)=>(p.stocks||[]).some(s=>norm(s.ticker).includes(pq)||norm(s.companyName).includes(pq));
    const posCount=(searchable&&pq)?ranked.filter(matchesPos).length:0; // quantos membros têm a posição
    // Demos (searchable=false): tudo, como antes. Oficiais: filtra (nome + posição) → ordena (coluna)
    // → fatia (render progressivo, só quando não há pesquisa nenhuma → a pesquisa vê a lista toda).
    let shown=ranked;
    if(searchable){
      if(q) shown=shown.filter(p=>norm(p.name).includes(q));
      if(pq) shown=shown.filter(matchesPos);
      const valOf=perActive?(sortKey==="day"?pfDayReturn:valForPeriod):(sortKey==="day"?pfDayReturn:(p=>p.total));
      const sign=sortDir==="asc"?1:-1;
      shown=[...shown].sort((a,b)=>{ const va=valOf(a),vb=valOf(b); if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return (va-vb)*sign; });
      if(!q&&!pq) shown=shown.slice(0,shownRows);
    }
    return(
    <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
      <div className="rkRow" style={{padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",
        fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600,alignItems:"center"}}>
        {searchable ? (
          <>
          <span className="rkSearchCell" style={{gridColumn:"span 2",position:"relative",display:"flex",alignItems:"center",minWidth:0}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Pesquisar membro…" aria-label="Pesquisar membro"
              style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.12)",boxSizing:"border-box",
                borderRadius:12,padding:"8px 32px 8px 34px",fontSize:13,color:"#e2e8f0",outline:"none",textTransform:"none",letterSpacing:"normal",fontWeight:500}}/>
            {query&&(
              <button onClick={()=>setQuery("")} title="Limpar" aria-label="Limpar pesquisa"
                style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",display:"flex",alignItems:"center",justifyContent:"center",
                  width:22,height:22,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"none",color:"#cbd5e1",cursor:"pointer",padding:0}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </span>
          <span className="rkNarrowHd" style={{textAlign:"center"}}>#</span>
          <span className="rkNarrowHd">Membro</span>
          </>
        ) : (<><span style={{textAlign:"center"}}>#</span><span>Membro</span></>)}
        <span className="rkSpark"></span>
        {searchable?<SortHd k="total">{period==="week"?"Semana":period==="month"?"Mês":"Rentab."}</SortHd>:<span style={{textAlign:"center"}}>Rentab.</span>}
        {searchable?<SortHd k="day">Diário</SortHd>:<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>Diário<InfoTip text="Rentabilidade do portefólio hoje (média diária das ações; espelhada para shorts)."/></span>}
        <span style={{display:"flex",alignItems:"center",justifyContent:"center"}}><InfoTip text="🟢/🔴 = nº de ações em ganho / em perda (não são posições long/short).">🟢/🔴</InfoTip></span>
        {searchable ? (
          <span className="rkHide" style={{position:"relative",display:"flex",alignItems:"center",minWidth:0}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
            </svg>
            <input value={posQuery} onChange={e=>setPosQuery(e.target.value)} placeholder="Posição…" aria-label="Pesquisar posição, empresa ou ticker"
              style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.12)",boxSizing:"border-box",
                borderRadius:10,padding:"7px 22px 7px 24px",fontSize:12,color:"#e2e8f0",outline:"none",textTransform:"none",letterSpacing:"normal",fontWeight:500}}/>
            {posQuery&&(
              <button onClick={()=>setPosQuery("")} title="Limpar" aria-label="Limpar pesquisa"
                style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",display:"flex",alignItems:"center",justifyContent:"center",
                  width:18,height:18,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"none",color:"#cbd5e1",cursor:"pointer",padding:0}}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </span>
        ) : (<span className="rkHide" style={{textAlign:"left"}}>Posições</span>)}
      </div>
      {searchable&&pq&&posCount>0&&(
        <div style={{padding:"9px 20px",borderBottom:"1px solid rgba(255,255,255,0.08)",fontSize:12.5,color:"#94a3b8",background:"rgba(34,197,94,0.06)",textAlign:"right"}}>
          <strong style={{color:"#e2e8f0",fontWeight:800}}>{posCount}</strong> {posCount===1?"membro tem":"membros têm"} <strong style={{color:"#4ade80",fontWeight:700}}>{posQuery.trim()}</strong>
        </div>
      )}
      {shown.map((p)=>{
        const i=p._rank-1; // rank real (mantém nº do lugar e estilos Top 3/Top 10 mesmo ao filtrar)
        const me=p.normName===myNorm;
        const dayRet=pfDayReturn(p);
        const rentVal=perActive?valForPeriod(p):p.total; // valor mostrado na coluna Rentab./Mês/Semana
        const picked=cmp&&sel.includes(p.key);
        // Top 3: ouro (1º, amarelo vivo) / prata (2º) / bronze-âmbar (3º). 4º-10º: cor geral.
        const rr=(!preStartWk&&i<3)?[
          {bg:"rgba(250,204,21,0.12)",hov:"rgba(250,204,21,0.18)",bar:"#facc15"},
          {bg:"rgba(241,245,249,0.12)",hov:"rgba(241,245,249,0.18)",bar:"#e2e8f0"},
          {bg:"rgba(245,158,11,0.11)",hov:"rgba(245,158,11,0.17)",bar:"#d97706"},
        ][i]:null;
        const inTop10=!preStartWk&&i>=3&&i<10;          // 4º–10º (o Top 3 são as medalhas)
        const barColor=rr?rr.bar:(inTop10?"#22c55e":null);
        // Top 3 e 4–10: só a barra em repouso (sem fundo); o tom verde aparece só no hover.
        const baseBg=picked?"rgba(59,130,246,0.16)":me?"rgba(34,197,94,0.04)":"transparent";
        const hoverBg=picked?baseBg:rr?rr.hov:inTop10?"rgba(34,197,94,0.10)":me?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.05)";
        return(
          <div key={p.key} ref={(me||p.key===highlightKey)?((el)=>{ if(me) meRowRef.current=el; if(p.key===highlightKey) highlightRef.current=el; }):null} className={"rkRow rkDataRow"+((p.key===highlightKey||(me&&meFlash))?" rkHiFlash":"")} onClick={()=>cmp?toggleSel(p.key):onSelect(p.key)}
            style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",cursor:"pointer",
              background:baseBg,boxShadow:picked?"inset 3px 0 0 #3b82f6":barColor?`inset 3px 0 0 ${barColor}`:"none",transition:"background 0.15s"}}
            onMouseEnter={e=>{ if(!picked) e.currentTarget.style.background=hoverBg; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=baseBg; }}>
            <span style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              {(!preStartWk&&i<3)
                ? <span className="rankShine rankBreathe" style={{width:22,height:22,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0,...RANK_BADGE[i+1],"--shine-delay":`${i*1.2}s`}}>{i+1}</span>
                : <span style={{fontSize:13,color:"#94a3b8",fontWeight:700}}>{preStartWk?"·":i+1}</span>}
            </span>
            <span style={{fontWeight:600,fontSize:"clamp(11.5px,3.1vw,15px)",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{overflowWrap:"normal",wordBreak:"normal",lineHeight:1.2}}>{p.name}</span>
              {me&&<span style={{fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",borderRadius:999,padding:"2px 8px",fontWeight:700,flexShrink:0}}>Tu</span>}
            </span>
            <span className="rkSpark">
              {/* Sem sparkline no pré-arranque semanal — ainda não há histórico da semana. */}
              {!preStartWk&&<MiniSparkline series={seriesById[p.id]||[]} current={p.total} height={24}/>}
            </span>
            <span style={{textAlign:"center",alignSelf:"center",fontWeight:800,fontFamily:"monospace",fontSize:"clamp(12.5px,3.6vw,15px)",color:(rentVal??0)>=0?"#4ade80":"#f87171"}}>{rentVal==null?"—":<Rolling text={pct(rentVal)}/>}</span>
            <span style={{textAlign:"center",alignSelf:"center",fontFamily:"monospace",fontSize:"clamp(11px,3vw,13px)",fontWeight:600,
              color:(preStartWk||dayRet==null)?"#4b5563":dayRet>=0?"#4ade80":"#f87171"}}>{(preStartWk||dayRet==null)?"—":<Rolling text={pct(dayRet)}/>}</span>
            <span style={{textAlign:"center",alignSelf:"center",fontFamily:"monospace",fontSize:"clamp(11px,3vw,14px)",fontWeight:700}}>
              {preStartWk?<span style={{color:"#4b5563"}}>—</span>:<><span style={{color:"#4ade80"}}>{p.pos}</span><span style={{color:"#94a3b8"}}>/</span><span style={{color:"#f87171"}}>{p.neg}</span></>}
            </span>
            <span className="rkHide" style={{display:"flex",alignItems:"center",justifyContent:"flex-start",gap:2,flexWrap:"nowrap",overflow:"hidden"}}>
              {(p.stocks||[]).map(s=>({s,r:stockRet(s,livePrices)})).sort((a,b)=>b.r-a.r).map(({s,r})=>(
                <HoverName key={s.ticker} label={`${s.companyName||s.ticker} · ${pct(r)}`} ring={!!pq&&(norm(s.ticker).includes(pq)||norm(s.companyName).includes(pq))}><StockLogo ticker={s.ticker} size={16}/></HoverName>
              ))}
            </span>
          </div>
        );
      })}
      {searchable&&(q||pq)&&shown.length===0&&(
        <div style={{padding:"28px 20px",textAlign:"center",color:"#64748b",fontSize:13}}>{pq?<>Nenhum membro tem “{posQuery.trim()}”.</>:<>Nenhum membro encontrado para “{query.trim()}”.</>}</div>
      )}
    </div>
    );
  };
  // Lista de inscritos (em espera): sem classificação; só o próprio dono vê o seu.
  const pendingList=(list)=>(
    <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
      {list.map(p=>{
        const me=p.normName===myNorm;
        return(
          <div key={p.key} onClick={me?()=>onSelect(p.key):undefined}
            style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
              padding:"14px 20px",borderBottom:"1px solid #0f172a",cursor:me?"pointer":"default",
              background:me?"rgba(34,197,94,0.04)":"transparent",transition:"background 0.15s"}}
            onMouseEnter={me?(e=>e.currentTarget.style.background="rgba(34,197,94,0.08)"):undefined}
            onMouseLeave={me?(e=>e.currentTarget.style.background="rgba(34,197,94,0.04)"):undefined}>
            <span style={{fontWeight:600,fontSize:"clamp(11.5px,3.1vw,15px)",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{overflowWrap:"normal",wordBreak:"normal",lineHeight:1.2}}>{p.name}</span>
              {me&&<span style={{fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",borderRadius:999,padding:"2px 8px",fontWeight:700,flexShrink:0}}>Tu</span>}
            </span>
            <span style={{fontSize:12,color:me?"#4ade80":"#94a3b8",whiteSpace:"nowrap",flexShrink:0}}>
              {me?"Ver o teu →":"🔒 oculto até 1 jul"}
            </span>
          </div>
        );
      })}
    </div>
  );
  const sectionTitle=(txt,sub,subColor)=>(
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"center",gap:10,margin:"0 0 12px",flexWrap:"wrap"}}>
      <h2 style={{fontSize:18,fontWeight:800,letterSpacing:"-0.3px",margin:0,textAlign:"center"}}>{txt}</h2>
      {sub&&<span style={{fontSize:12,fontWeight:700,color:subColor||"#94a3b8"}}>{sub}</span>}
    </div>
  );
  // ---- Widgets das laterais (desktop) ----------------------------------------
  // Ordem pelo JOGO ATIVO (consistente com a tabela em tableFor). Total → ordem que já vem do App.
  const rankedByMetric=useMemo(()=>{
    if(period==="total") return officials;
    return [...officials].sort((a,b)=>{ const va=metricOf(a),vb=metricOf(b);
      if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return vb-va; });
  },[officials,period,monthBase,weekBase,livePrices,hasWeek]);
  const myRow=myNorm?officials.find(p=>p.normName===myNorm):null;
  const myRank=(myRow&&!preStartWk)?rankedByMetric.indexOf(myRow)+1:0;
  const myDay=myRow?pfDayReturn(myRow):null;
  const stats=useMemo(()=>{
    const off=officials.map(p=>({p,m:metricOf(p)})).filter(x=>Number.isFinite(x.m));
    if(!off.length) return null;
    off.sort((a,b)=>b.m-a.m);
    const avg=off.reduce((a,x)=>a+x.m,0)/off.length;
    const spyRet=spyMetric();
    let beating=null;
    if(period==="total"&&spy){ beating=0; for(const x of off){ const s=spy.returnFor(x.p); if(s!=null&&x.m>s) beating++; } } // Geral: S&P por-submissão (como antes)
    else if(spyRet!=null){ beating=0; for(const x of off) if(x.m>spyRet) beating++; } // mês/semana: S&P único do período
    return { n:off.length, avg, spyRet, beating, leader:off[0].p, leaderM:off[0].m };
  },[officials,spy,period,monthBase,weekBase,livePrices,hasWeek]);
  const topPicks=useMemo(()=>{
    const c={};
    for(const p of officials) for(const s of (p.stocks||[])){ const t=(s.ticker||"").toUpperCase().trim(); if(t) c[t]=(c[t]||0)+1; }
    const tot=officials.length||1;
    return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([ticker,cnt])=>({ticker,cnt,frac:cnt/tot}));
  },[officials]);
  const dayExtremes=useMemo(()=>{
    if(!dayChange) return null; let best=null,worst=null;
    for(const p of officials){
      const day=pfDayRet(p,dayChange);
      if(day==null) continue;
      if(!best||day>best.day) best={p,day};
      if(!worst||day<worst.day) worst={p,day};
    }
    return {best,worst};
  },[officials,dayChange]);
  // Maior subida no ranking do JOGO ATIVO: lugar agora (por metricOf) vs lugar no início do período
  // (1º snapshot >= início do período; total → 1º snapshot de sempre), via seriesById.
  const topClimber=useMemo(()=>{
    if(preStartWk) return null;
    const periodStart=period==="week"?curWk:period==="month"?curMonthDateOnly:null;
    const nowOrder=[...officials].sort((a,b)=>{ const va=metricOf(a),vb=metricOf(b);
      if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return vb-va; });
    const nowRank=new Map(nowOrder.map((p,i)=>[p.id,i+1]));
    const startRet=new Map(); let withHist=0;
    for(const p of officials){
      const s=seriesById[p.id]; let sr=null;
      if(s&&s.length){ if(!periodStart){ sr=s[0].r; withHist++; } else { const first=s.find(x=>x.date>=periodStart); if(first){ sr=first.r; withHist++; } } }
      const m=metricOf(p);
      startRet.set(p.id, sr!=null?sr:(Number.isFinite(m)?m:0));
    }
    if(withHist<3) return null; // histórico insuficiente → não mostra
    const startOrder=[...officials].sort((a,b)=>startRet.get(b.id)-startRet.get(a.id));
    const startRank=new Map(startOrder.map((p,i)=>[p.id,i+1]));
    let best=null;
    for(const p of officials){
      const climb=startRank.get(p.id)-nowRank.get(p.id); // >0 = subiu lugares
      if(climb>0&&(!best||climb>best.climb)) best={p,climb};
    }
    return best;
  },[officials,seriesById,period,monthBase,weekBase,livePrices,hasWeek]);
  // Melhores/piores AÇÕES do JOGO ATIVO (retorno da própria ação desde o baseline do período).
  const stockPerf=useMemo(()=>{
    const seen={};
    for(const p of officials) for(const s of (p.stocks||[])){
      const raw=(s.ticker||"").trim(); const t=raw.toUpperCase();
      if(t && !seen[t] && Number.isFinite(s.initialPrice) && s.initialPrice>0) seen[t]={ticker:t,raw,init:s.initialPrice};
    }
    const arr=Object.values(seen).map(o=>{ const base=baseForStock(o.raw,o.init); const cur=curPrice(o.raw,o.init,livePrices); return {...o,ret:(Number.isFinite(cur)&&base)?cur/base-1:0}; });
    arr.sort((a,b)=>b.ret-a.ret);
    return { best:arr.slice(0,5), worst:arr.slice(-5).reverse() };
  },[officials,livePrices,period,monthBase,weekBase]);
  const railCard=(title,children,info)=>(
    <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:14,padding:"14px 15px",boxShadow:"0 6px 20px rgba(0,0,0,0.22)"}}>
      <div style={{fontSize:10.5,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:800,marginBottom:12,display:"flex",alignItems:"center",gap:6}}>{title}{info&&<InfoTip text={info}/>}</div>
      {children}
    </div>
  );
  const mono=(v,pos)=><span style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:pos?"#4ade80":"#f87171"}}>{v}</span>;
  const hiRow=(label,p,valueEl,first)=> p?(
    <div onClick={()=>onSelect(p.key)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"7px 0",borderTop:first?"none":"1px solid rgba(255,255,255,0.07)"}}>
      <span style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px",width:70,flexShrink:0}}>{label}</span>
      <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
      {valueEl}
    </div>
  ):null;
  const myM=myRow?metricOf(myRow):null;
  const wYou=myRow?railCard("A tua posição",(
    <div onClick={preStartWk?undefined:scrollToMe} title={preStartWk?undefined:"Ver a minha posição no ranking"} style={{cursor:preStartWk?"default":"pointer"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:2}}>
        <span style={{fontSize:32,fontWeight:800,letterSpacing:"-1px"}}>{preStartWk?"—":myRank}</span>
        <span style={{fontSize:15,color:"#64748b",fontWeight:700}}>/ {stats?stats.n:officials.length}</span>
      </div>
      <div style={{fontSize:13,color:"#cbd5e1",fontWeight:600,marginBottom:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{myRow.name}</div>
      <div style={{display:"flex",gap:14,fontFamily:"monospace",fontSize:14,fontWeight:800,marginBottom:8}}>
        <span style={{color:(myM??0)>=0?"#4ade80":"#f87171"}}>{myM==null?"—":pct(myM)}</span>
        {!preStartWk&&myDay!=null&&<span title="Rentabilidade de hoje" style={{color:myDay>=0?"#4ade80":"#f87171"}}>Diário {pct(myDay)}</span>}
      </div>
      <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>
        {preStartWk
          ? "Ranking semanal arranca 2ª feira."
          : myRank===1
            ? "És o líder do ranking."
            : <>{((metricOf(rankedByMetric[myRank-2])-myM)*100).toFixed(2)} pp do lugar acima<br/>{stats&&`${((stats.leaderM-myM)*100).toFixed(2)} pp do 1º`}</>}
      </div>
    </div>
  )):null;
  const wHi=(!preStartWk&&stats)?railCard("Destaques",(
    <div style={{marginTop:-3}}>
      {hiRow("Líder",stats.leader,mono(pct(stats.leaderM),stats.leaderM>=0),true)}
      {dayExtremes?.best&&hiRow("Subida do dia",dayExtremes.best.p,mono(pct(dayExtremes.best.day),dayExtremes.best.day>=0))}
      {dayExtremes?.worst&&dayExtremes.worst.p.id!==dayExtremes.best?.p.id&&hiRow("Queda do dia",dayExtremes.worst.p,mono(pct(dayExtremes.worst.day),dayExtremes.worst.day>=0))}
      {topClimber&&hiRow("Maior subida",topClimber.p,<span title={`Subiu ${topClimber.climb} ${topClimber.climb===1?"lugar":"lugares"} ${period==="week"?"esta semana":period==="month"?"este mês":"desde o arranque"}`} style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:"#4ade80",whiteSpace:"nowrap"}}>▲ {topClimber.climb}</span>)}
    </div>
  )):null;
  const wVsSp=(!preStartWk&&stats)?railCard("Comunidade vs S&P 500",(
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:10}}>
        <span style={{fontSize:30,fontWeight:800,letterSpacing:"-1px",color:"#4ade80"}}>{stats.beating!=null?Math.round(stats.beating/stats.n*100):"—"}%</span>
        <span style={{fontSize:12.5,color:"#94a3b8"}}>batem o mercado</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,padding:"6px 0",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
        <span style={{color:"#94a3b8"}}>Média comunidade</span><span style={{fontFamily:"monospace",fontWeight:800,color:stats.avg>=0?"#4ade80":"#f87171"}}>{pct(stats.avg)}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,padding:"6px 0",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
        <span style={{color:"#94a3b8"}}>S&P 500</span><span style={{fontFamily:"monospace",fontWeight:800,color:stats.spyRet==null?"#64748b":stats.spyRet>=0?"#4ade80":"#f87171"}}>{stats.spyRet!=null?pct(stats.spyRet):"—"}</span>
      </div>
    </div>
  )):null;
  const wPicks=topPicks.length?railCard("Mais escolhidas",(
    <div style={{display:"flex",flexDirection:"column",gap:9}}>
      {topPicks.map(t=>(
        <div key={t.ticker} style={{display:"flex",alignItems:"center",gap:8}}>
          <StockLogo ticker={t.ticker} size={20}/>
          <span style={{fontWeight:700,fontSize:12.5,width:50,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis"}}>{t.ticker}</span>
          <div style={{flex:1,height:6,borderRadius:999,background:"rgba(255,255,255,0.07)",overflow:"hidden",minWidth:0}}>
            <div style={{height:"100%",width:`${Math.max(5,Math.round(t.frac*100))}%`,background:"linear-gradient(90deg,#16a34a,#4ade80)",borderRadius:999}}/>
          </div>
          <span style={{fontSize:11.5,color:"#94a3b8",fontFamily:"monospace",width:30,textAlign:"right",flexShrink:0}}>{Math.round(t.frac*100)}%</span>
        </div>
      ))}
    </div>
  )):null;
  const perfRow=(o)=>(
    <div key={o.ticker} style={{display:"flex",alignItems:"center",gap:8}}>
      <StockLogo ticker={o.ticker} size={20}/>
      <span style={{fontWeight:700,fontSize:12.5,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.ticker}</span>
      <span style={{fontFamily:"ui-monospace, monospace",fontWeight:800,fontSize:12.5,color:o.ret>=0?"#4ade80":"#f87171"}}>{o.ret>=0?"+":""}{(o.ret*100).toFixed(2)}%</span>
    </div>
  );
  const wStocks=(!preStartWk&&(stockPerf.best.length||stockPerf.worst.length))?railCard("Performance",(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#4ade80",fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}><Tri size={9}/> Melhores</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>{stockPerf.best.map(perfRow)}</div>
      <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#f87171",fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",margin:"14px 0 8px"}}><Tri up={false} size={9}/> Piores</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>{stockPerf.worst.map(perfRow)}</div>
    </div>
  ),period==="week"?"Ações escolhidas pelos membros com melhor e pior rentabilidade esta semana.":period==="month"?"Ações escolhidas pelos membros com melhor e pior rentabilidade este mês.":"Ações escolhidas pelos membros com melhor e pior rentabilidade desde o arranque da competição."):null;
  // "Campeão do mês" (mini-época mensal): líder ao vivo deste mês + campeões dos meses fechados
  // (recalculados on-the-fly a partir dos baselines de início de cada mês).
  const monthNameCap=(()=>{ const n=new Date().toLocaleDateString("pt-PT",{month:"long"}); return n.charAt(0).toUpperCase()+n.slice(1); })();
  // Widget do campeão parametrizado por tipo (mês OU semana) — o resto do cartão é idêntico.
  const champCfg={
    month:{ liveOf:monthOf, fmt:periodLabel, title:`Campeão de ${monthNameCap}`,
      pendHead:"Por apurar", pendSub:"Apurado no último dia do mês", emptyMsg:"Sem participantes ainda.", done:false, wonLabel:"", listTitle:"Campeões anteriores",
      champs:()=>{ const out=[], cur=new Date().toISOString().slice(0,7);
        for(const per of Object.keys(pastBaselines).sort()){ if(per>=cur) continue;
          const from=pastBaselines[per], to=pastBaselines[nextPeriod(per)]; if(!from||!to) continue; // fim = início do mês seguinte
          let best=null; for(const p of officials){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
          if(best) out.push({period:per,...best}); }
        return out.reverse(); },
      info:"Melhor rentabilidade do mês, com o ponto de partida reposto no início de cada mês.\nO campeão mensal só é apurado no último dia do mês." },
    week:{ liveOf:weekOf, fmt:weekLabel, title:"Vencedor da Semana",
      pendHead:"Por apurar", pendSub:"Apura 6ª feira ao fecho", emptyMsg:hasWeek?"Sem participantes ainda.":"Arranca 2ª feira.",
      done:hasWeek&&weekTradingDone(new Date()), wonLabel:`🏆 ${weekLabel(curWk)}`, listTitle:"Vencedores anteriores",
      champs:()=>{ const out=[]; // semana fechada = open→close (6ª feira). Congelado e exato.
        for(const per of Object.keys(weekCloses).sort()){ if(per>=curWk) continue;
          const from=weekOpens[per], to=weekCloses[per]; if(!from||!to) continue;
          let best=null; for(const p of officials){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
          if(best) out.push({period:per,...best}); }
        // Semanas SEMEADAS (ex.: Semana 1 = Manuel), se não houver já um registo computado desse período.
        for(const seed of WEEK_SEED_CHAMPS){ if(out.some(c=>c.period===seed.period)) continue;
          const p=officials.find(x=>x.normName===norm(seed.name))||{name:seed.name,key:null};
          out.push({period:seed.period,p,r:seed.ret}); }
        return out.sort((a,b)=>a.period<b.period?1:-1); },  // mais recente primeiro
      info:"Melhor rentabilidade da semana (2ª a 6ª feira), com o ponto de partida reposto todas as segundas.\nO vencedor da semana é apurado na 6ª feira ao fecho." },
  };
  const champCard=(kind)=>{
    if(preLaunch||!officials.length) return null;
    const cf=champCfg[kind];
    const leaders=[...officials].map(p=>({p,m:cf.liveOf(p)})).filter(x=>x.m!=null).sort((a,b)=>b.m-a.m);
    const champs=cf.champs();
    const winner=cf.done&&leaders.length?leaders[0]:null; // semana fechada → revela o vencedor (preços de 6ª, congelados pelo mercado)
    return railCard(cf.title,(
      <div>
        {winner?(
          <div onClick={()=>onSelect(winner.p.key)} title="Ver portefólio" style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:24,lineHeight:1}}>🏆</span>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:9.5,color:"#facc15",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px"}}>{weekLabel(curWk)}</div>
              <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{winner.p.name}</div>
            </div>
            <span style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:winner.m>=0?"#4ade80":"#f87171",flexShrink:0}}>{pct(winner.m)}</span>
          </div>
        ):leaders.length?(
          // Em curso: o vencedor só é apurado no fim do período. Sem líder à vista → mais suspense.
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20,lineHeight:1}}>⏳</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"#e2e8f0",lineHeight:1.15}}>{cf.pendHead}</div>
              <div style={{fontSize:10.5,color:"#94a3b8"}}>{cf.pendSub}</div>
            </div>
          </div>
        ):<div style={{fontSize:12.5,color:"#94a3b8"}}>{cf.emptyMsg}</div>}
        {champs.length>0&&(
          <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8}}>
            <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px",marginBottom:6}}>{cf.listTitle}</div>
            {champs.slice(0,4).map(c=>(
              <div key={c.period} onClick={()=>c.p.key&&onSelect(c.p.key)} title={c.p.key?"Ver portefólio":undefined} style={{cursor:c.p.key?"pointer":"default",display:"flex",justifyContent:"space-between",gap:8,padding:"4px 0",fontSize:12.5}}>
                <span style={{color:"#94a3b8",textTransform:"capitalize",flexShrink:0}}>{cf.fmt(c.period)}</span>
                <span style={{color:"#e2e8f0",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"right"}}>{c.p.name}</span>
                <span style={{fontFamily:"monospace",fontWeight:800,color:c.r==null?"#64748b":c.r>=0?"#4ade80":"#f87171",flexShrink:0}}>{c.r==null?"—":pct(c.r)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ),cf.info);
  };
  // Context-aware: segue o toggle; em "Geral" mostra o do mês (mini-época principal).
  const wChamp=champCard(period==="week"?"week":"month");
  // Medalhão decorativo de vencedor à ESQUERDA do gráfico (espelha o campeão da direita). Só nas
  // mini-épocas: Mensal → "Vencedor do Mês"; Semanal → "Vencedor da Semana". No "Geral" não há
  // medalhão (não é uma época com vencedor apurado). Só visual (não clicável).
  const badgeSrc=period==="week"?"/cdi-semana-winner.webp":"/cdi-mensal-winner.webp";
  const wBadge=period==="total"?null:(
    // key={period} → remonta ao trocar de aba (Mensal↔Semanal) para a entrada "cunhagem" repetir.
    <div className="cdiHolo" key={period}>
      <img className="cdiHolo__img"
        src={badgeSrc}
        alt={period==="week"?"Vencedor da semana":"Vencedor do mês"}
        draggable={false} width={454} height={531}/>
      {/* Efeito holograma: gradiente especular em color-dodge, mascarado pela luminância do PRÓPRIO
          medalhão (substitui o "spec map" do exemplo) em multiply. Anima em loop para o brilho varrer.
          Puramente decorativo (não clicável). */}
      <div className="cdiHolo__spec" aria-hidden="true"
        style={{WebkitMaskImage:`url(${badgeSrc})`,maskImage:`url(${badgeSrc})`}}>
        <div className="cdiHolo__mask" style={{backgroundImage:`url(${badgeSrc})`}}/>
      </div>
    </div>
  );
  const leftRail=<>{wYou}{wStocks}</>;
  // O campeão sai do rail direito e vai, isolado, para a linha do cabeçalho (célula .railChamp,
  // à altura do 1v1). Os restantes ficam no rail direito (.railR), à altura da tabela — onde sempre estiveram.
  const rightRail=<>{wVsSp}{wHi}{wPicks}</>;

  return(
    <div style={{maxWidth:1520,margin:"0 auto",padding:"40px 20px 120px","--rk-name-w":`${nameW}px`}}>
      <style>{`
        /* Coluna do nome = largura FIXA do nome mais comprido (--rk-name-w, medido em runtime) →
           todas as linhas alinhadas e as sparklines (1fr) começam todas no mesmo sítio, colado ao
           maior nome. Fallback 190px enquanto não mede. */
        .rkRow{display:grid;grid-template-columns:40px var(--rk-name-w,190px) 1fr 72px 72px 56px 150px;gap:8px}
        /* Lista longa (124 linhas × sparkline + 8 ícones): o browser não renderiza/pinta as linhas
           fora do ecrã → scroll fluido (senão saturava o compositor e a pintura ficava atrasada).
           Só no desktop, onde as linhas têm altura fixa de 1 linha (evita saltos). */
        @media(min-width:861px){ .rkDataRow{content-visibility:auto;contain-intrinsic-size:auto 56px} }
        .rkSpark{display:flex;align-items:center;align-self:center;height:24px;overflow:hidden;min-width:0}
        .rkNarrowHd{display:none}   /* cabeçalhos simples #/Membro: só aparecem no mobile */
        @keyframes rkHiFlash{0%{background-color:rgba(59,130,246,0.30)}60%{background-color:rgba(59,130,246,0.15)}100%{background-color:rgba(59,130,246,0)}}
        .rkHiFlash{animation:rkHiFlash 2.6s ease-out}
        /* Grelha de 2 LINHAS: linha 1 = cabeçalho (centro) + campeão (direita, à altura do 1v1);
           linha 2 = rail esquerdo + tabela + rail direito (widgets onde sempre estiveram). */
        .rkLayout{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,900px) minmax(240px,1fr);
          grid-template-rows:auto auto;grid-template-areas:"badge hdr champ" "left tbl rail";
          column-gap:28px;row-gap:0;align-items:start;justify-content:center}
        .cHeader{grid-area:hdr;min-width:0}
        .rkCenter{grid-area:tbl;min-width:0}
        .rkRail{position:sticky;top:84px;display:flex;flex-direction:column;gap:16px}
        .railL{grid-area:left}
        .railR{grid-area:rail}
        /* "Campeão do mês" ISOLADO na linha do cabeçalho, coluna direita (na horizontal do 1v1). O
           cartão fica sticky (pina no topo) e a célula tem altura fixa (medida) = do topo da linha
           até ao FUNDO da box do gráfico → o cartão CEDE (sai de cena, sobe com o gráfico) exatamente
           quando o seu fundo encontra o fundo do gráfico. */
        .railChamp{grid-area:champ;align-self:start;min-width:0}
        /* z-index:10 → o cartão (e a etiqueta "i", que transborda para cima do gráfico) fica ACIMA
           do GlowBehind do SeasonRace (que é position:relative;z-index:1). */
        .railChamp > *{position:sticky;top:84px;z-index:10}
        /* Medalhão de vencedor: espelho do campeão na coluna ESQUERDA (célula 'badge', linha do
           cabeçalho). Mesma dinâmica: pina no topo e cede quando a tabela sobe. Centrado no meio
           do gráfico via marginTop medido em runtime (badgeTop). */
        .railBadge{grid-area:badge;align-self:start;min-width:0}
        .railBadge > *{position:sticky;top:84px;z-index:10}
        /* --- Efeito holograma do medalhão (color-dodge specular + máscara multiply) --- */
        /* filter+isolation isolam o blend ao medalhão (não "sangra" para o fundo da página). */
        .cdiHolo{position:relative;display:block;width:100%;max-width:240px;margin:0 auto;isolation:isolate;
          backface-visibility:hidden;filter:drop-shadow(0 10px 26px rgba(0,0,0,0.5));
          transform-origin:center;animation:cdiStamp .5s cubic-bezier(.2,.9,.25,1) both}
        /* Entrada "cunhagem": entra grande e translúcido, encolhe e CRAVA com um ligeiro ressalto. */
        @keyframes cdiStamp{
          0%{opacity:0;transform:scale(1.35)}
          50%{opacity:1;transform:scale(.95)}   /* impacto: compressão abaixo do tamanho final */
          72%{transform:scale(1.03)}            /* ressalto */
          100%{opacity:1;transform:scale(1)}
        }
        .cdiHolo__img{display:block;width:100%;height:auto;aspect-ratio:454/531;user-select:none;pointer-events:none}
        /* background:#000 (como no exemplo original): nas zonas transparentes a máscara multiply dá
           preto → color-dodge não altera nada → sem "sangrar" o gradiente para os cantos. */
        .cdiHolo__spec,.cdiHolo__mask{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;
          background:#000;background-repeat:no-repeat;background-position:center}
        /* Especular: gradiente do exemplo a varrer na vertical, RECORTADO à silhueta (alfa) do medalhão
           via CSS mask → o efeito nunca passa para além do medalhão. */
        .cdiHolo__spec{mix-blend-mode:color-dodge;opacity:.7;background-size:100% 230%;
          background-image:linear-gradient(180deg,#000 18%,#3c5e6d 34%,#f4310e 52%,#f58308 74%,#000 92%);
          -webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
          -webkit-mask-position:center;mask-position:center;
          animation:cdiHoloSweep 3.8s ease-in-out infinite alternate}
        /* Máscara interna = luminância do medalhão (substitui o spec map): só as zonas claras "acendem". */
        .cdiHolo__mask{mix-blend-mode:multiply;background-size:100% 100%}
        @keyframes cdiHoloSweep{from{background-position:center 0%}to{background-position:center 100%}}
        @media(prefers-reduced-motion:reduce){.cdiHolo__spec{animation:none}.cdiHolo{animation:none}}
        /* Linha do cabeçalho: título (esq.) · toggle (centro EXATO da página) · 1v1 (dir.).
           1fr auto 1fr → o toggle fica sempre no centro, independentemente de o título ser
           "Ranking Geral" ou "Ranking Mensal" (larguras diferentes não o mexem). */
        .rkHeadRow{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;margin-bottom:6px}
        .rkHeadTitle{justify-self:start;min-width:0}
        .rkHeadToggle{justify-self:center}
        .rkHeadV1{justify-self:end}
        @media(max-width:560px){
          /* telemóvel: título + 1v1 na 1ª linha; toggle centrado na 2ª. */
          .rkHeadRow{grid-template-columns:1fr auto;grid-template-areas:"title v1" "toggle toggle";row-gap:10px}
          .rkHeadTitle{grid-area:title;white-space:normal}
          .rkHeadV1{grid-area:v1}
          .rkHeadToggle{grid-area:toggle}
        }
        @media(max-width:1439px){
          .rkLayout{grid-template-columns:minmax(0,900px);grid-template-areas:"hdr" "tbl";justify-content:center}
          .rkRail,.railChamp,.railBadge{display:none}
        }
        @media(max-width:860px){
          /* MOBILE/tablet: sem caixas de pesquisa nem ícones de posições (são só desktop).
             As caixas/ícones têm display:flex inline → precisa de !important para as esconder. */
          .rkRow{grid-template-columns:40px 1fr 100px 100px 92px}
          .rkSpark{display:none}
          .rkHide{display:none!important}
          .rkSearchCell{display:none!important}
          .rkNarrowHd{display:block!important}
        }
        @media(min-width:641px) and (max-width:860px){
          /* TABLET: repõe a tabela rica do desktop (sparkline + pesquisa + 8 ícones), grelha compacta.
             rank | nome(1fr) | spark | rentab | diário | 🟢/🔴 | posições(8 ícones) */
          .rkRow{grid-template-columns:32px minmax(0,1fr) 64px 72px 66px 50px 146px;gap:6px}
          .rkSpark{display:flex}
          .rkHide{display:flex!important}
          .rkSearchCell{display:flex!important}
          .rkNarrowHd{display:none!important}
        }
        @media(max-width:640px){
          /* nomes largos + mais folga entre as numéricas (Rentab./Diário não coladas). */
          .rkRow{grid-template-columns:22px 1fr 58px 54px 44px;gap:10px}
        }
      `}</style>
      {/* Grelha de 2 linhas: campeão isolado em cima-direita (linha do cabeçalho, à altura do 1v1);
          rail esquerdo, tabela e rail direito na linha de baixo (onde sempre estiveram). */}
      <div className="rkLayout">
      <aside className="railBadge" ref={railBadgeRef} style={railH!=null?{height:railH}:undefined}><div ref={badgeStickyRef} style={{marginTop:badgeTop}}>{wBadge}</div></aside>
      <aside className="rkRail railL">{leftRail}</aside>
      <aside className="railChamp" ref={railChampRef} style={railH!=null?{height:railH}:undefined}><div ref={champStickyRef} style={{marginTop:champTop}}>{wChamp}</div></aside>
      <div className="cHeader">
      <div className="rkHeadRow">
        <h1 className="rkHeadTitle" style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",margin:0,whiteSpace:"nowrap"}}>{period==="week"?"Ranking Semanal":period==="month"?"Ranking Mensal":"Ranking Geral"}</h1>
        {(hasMonth||hasWeek)&&!preLaunch?(
          <div className="rkHeadToggle" style={{display:"inline-flex",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,padding:2}}>
            {[["total","Geral"],["month","Mensal"],["week","Semanal"]].map(([k,lbl])=>(
              <button key={k} onClick={()=>setPeriod(k)}
                style={{cursor:"pointer",fontSize:12.5,fontWeight:700,borderRadius:999,padding:"6px 14px",border:"none",whiteSpace:"nowrap",transition:"all .15s",
                  color:period===k?"#0a0a0a":"#cbd5e1",background:period===k?"#4ade80":"transparent"}}>{lbl}</button>
            ))}
          </div>
        ):<span className="rkHeadToggle" aria-hidden="true"/>}
        {ranking.length>=2?(
          <button className="rkHeadV1" onClick={()=>{ setCmp(v=>!v); setSel([]); }}
            style={{cursor:"pointer",fontSize:13,fontWeight:700,borderRadius:999,padding:"8px 16px",
              color:cmp?"#0a0a0a":"#cbd5e1",background:cmp?"#3b82f6":"rgba(255,255,255,0.06)",
              border:`1px solid ${cmp?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.12)"}`}}>1v1</button>
        ):<span className="rkHeadV1" aria-hidden="true"/>}
      </div>
      <p style={{color:"#94a3b8",fontSize:14,margin:"0 0 28px"}}>
        {period==="week"?"Ranking da semana · 2ª (abertura) a 6ª feira (fecho), ponto de partida reposto todas as segundas":period==="month"?"Ranking do mês · ponto de partida reposto no início do mês (mesma carteira)":"Classificação por rentabilidade total, em tempo real"} · {officials.length} {officials.length===1?"participante":"participantes"}.
        {pricesLoading?" · A atualizar preços…":(pricesAt?` · Atualizado ${new Date(pricesAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}`:"")}
      </p>
      {ranking.length>0&&(<>
        {/* Season Race + (demos) + pílula do vencedor — a toda a largura, por cima da grelha */}
        <div style={{marginBottom:16}} ref={raceWrapRef}>
          {/* Semanal pré-arranque → grelha de partida (frameStart); ao vivo/mês/geral → gráfico normal.
              Quando 2ª feira o cron captura os baselines, hasWeek fica true e entra o gráfico ao vivo. */}
          <GlowBehind><SeasonRace ranking={ranking} preLaunch={preLaunch} myNorm={myNorm} spy={spy} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""}
            periodStart={period==="week"?(hasWeek?curWk:null):period==="month"?curMonthDateOnly:null}
            frameStart={period==="week"&&!hasWeek&&!preLaunch?frameWk:null}
            periodRetOf={metricOf}
            periodLabelText={period==="week"?(hasWeek?weekLabel(curWk):weekLabel(frameWk)):period==="month"?periodLabel(curMonthYM):""}/></GlowBehind>
        </div>
        {preLaunch&&demos.length>0&&(
          <div style={{marginBottom:32}}>
            {sectionTitle("Demo")}
            {tableFor(demos)}
          </div>
        )}
        <div style={{margin:"0 0 16px"}}>
          <CompetitionTimer settings={settings} period={period} hasWeek={hasWeek}/>
        </div>
      </>)}
      </div>{/* /cHeader */}
      <div className="rkCenter" style={{minWidth:0}}>
      {ranking.length===0
        ? <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>Ainda não há portefólios submetidos.</div>
        : officials.length>0
          ? (preLaunch?pendingList([...officials].sort((a,b)=>String(b.submittedAt||"").localeCompare(String(a.submittedAt||"")))):tableFor(officials,{searchable:true}))
          : <div style={{background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)",borderRadius:16,padding:40,textAlign:"center",color:"#64748b",fontSize:14}}>Ainda sem inscrições. Os portefólios submetidos a partir de agora entram aqui — admissão oficial a 1 de julho.</div>}
      {cmp&&(
        <p style={{marginTop:12,fontSize:12,color:"#1f2937",textAlign:"right"}}>
          Seleciona 2 membros para comparar.
        </p>
      )}
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
      </div>{/* /rkCenter */}
      <aside className="rkRail railR">{rightRail}</aside>
      </div>{/* /rkLayout */}
    </div>
  );
}

/* ---- Evolution chart -----------------------------------------------------
   Lê os snapshots diários (gravados pelo cron) e desenha a evolução da
   rentabilidade. Acrescenta o ponto "hoje" ao vivo para nunca ficar vazio.
   Enche-se ao longo dos dias à medida que o cron corre.
--------------------------------------------------------------------------- */
function EvoTooltip({active,payload,label}){
  if(!active||!payload||!payload.length) return null;
  const rows=payload.filter(p=>p.value!=null);
  if(!rows.length) return null;
  const nameOf=k=>k==="spy"?"S&P 500":"A tua";
  return(
    <div style={{background:"rgba(8,15,32,0.95)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"7px 11px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.45)"}}>
      <div style={{color:"#94a3b8",marginBottom:rows.length>1?5:0,fontFamily:"monospace"}}>{raceFull(label)}</div>
      {rows.map(p=>(
        <div key={p.dataKey} style={{display:"flex",alignItems:"center",gap:8,lineHeight:1.6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
          <span style={{color:"#cbd5e1",flex:1,whiteSpace:"nowrap"}}>{nameOf(p.dataKey)}</span>
          <span style={{fontFamily:"monospace",fontWeight:700,color:p.value>=0?"#4ade80":"#f87171"}}>{p.value>=0?"+":""}{Number(p.value).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
}
function EvolutionChart({portfolioId,currentReturn,submittedAt,competitionStarted,gameStartDate,spy,spyInitialPrice}){
  const [snaps,setSnaps]=useState(null);
  const [mounted,setMounted]=useState(false);
  useEffect(()=>{ setMounted(true); },[]);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      const { data }=await supabase
        .from("portfolio_snapshots")
        .select("captured_at,total_return")
        .eq("portfolio_id",portfolioId)
        .order("captured_at",{ascending:true});
      if(!cancel) setSnaps(data||[]);
    })();
    return()=>{ cancel=true; };
  },[portfolioId]);

  if(snaps===null) return <Skeleton w="100%" h={200} r={10} style={{display:"block"}}/>;

  const now=new Date().toISOString();
  // Arranque: pré-1jul → data de submissão; depois do arranque → 1 jul (reset).
  const startDate=(competitionStarted&&gameStartDate)
    ? String(gameStartDate).slice(0,10)
    : (submittedAt?String(submittedAt).slice(0,10):null);
  const startTs=startDate?`${startDate}T00:00:00.000Z`:null;
  const byT={};
  for(const s of snaps){
    const t=s.captured_at; if(!t||!isMktOpen(t)) continue; // ignora mercado fechado
    if(startTs&&t<startTs) continue;              // ignora antes do arranque (reset)
    byT[t]=Number(s.total_return)*100;
  }
  if(typeof currentReturn==="number"&&(!startTs||now>startTs)) byT[now]=currentReturn*100;
  if(startTs) byT[startTs]=0;                     // arranca SEMPRE a 0%
  // Benchmark S&P 500: rentabilidade do SPY desde a MESMA base do portefólio (spyInitialPrice),
  // ancorada a 0 no arranque — dá contexto à linha do membro (igual ao gráfico Top 10).
  const spyBase=(Number.isFinite(spyInitialPrice)&&spyInitialPrice>0)?spyInitialPrice:null;
  const spyAt=(t)=>{ if(!spy||!spyBase) return null; if(t===startTs) return 0; const px=(t===now)?spy.now:(spy.priceAt?spy.priceAt(t):null); return (Number.isFinite(px)&&px>0)?(px/spyBase-1)*100:null; };
  const data=Object.entries(byT).map(([t,r])=>{ const sv=spyAt(t); return sv==null?{t,r}:{t,r,spy:sv}; }).sort((a,b)=>a.t<b.t?-1:1);
  const hasSpy=data.some(d=>Number.isFinite(d.spy));
  // Uma marca por DIA no eixo X (evita a data do arranque duplicada).
  const dayTicks=(()=>{ const seen=new Set(),out=[]; for(const d of data){ const day=String(d.t).slice(0,10); if(!seen.has(day)){ seen.add(day); out.push(d.t); } } return out; })();
  const enough=data.length>=2;
  const last=enough?data[data.length-1].r:0;
  const col=last>=0?"#4ade80":"#f87171";
  // Domínio do Y com FOLGA (para a linha não parecer que foi à falência):
  // margem generosa por baixo do ponto mais baixo + um pouco acima do 0%.
  const vals=data.flatMap(d=>[d.r,d.spy]).filter(Number.isFinite);
  const lo=Math.min(0,...vals), hi=Math.max(0,...vals);
  const span=Math.max(hi-lo,1);
  const yMin=Math.floor(lo-Math.min(Math.max(span*0.45,1.5),4));
  const yMax=Math.ceil(hi+Math.min(Math.max(span*0.15,0.6),2));
  const provisional=!competitionStarted; // pré-jogo: não conta, vai recomeçar a 1 jul

  return(
    <div style={{width:"100%"}}>
      {!mounted?(
        <div style={{height:210}}/>
      ):!enough?(
        <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#4b5563",textAlign:"center"}}>
          Começa a preencher-se nos próximos dias.
        </div>
      ):(
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={data} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} ticks={dayTicks} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
            <YAxis domain={[yMin,yMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            <Tooltip content={<EvoTooltip/>}/>
            <Line type="monotone" dataKey="r" name="A tua" stroke={col} strokeWidth={2.4} dot={false} isAnimationActive={false}/>
            {hasSpy&&<Line type="monotone" dataKey="spy" name="S&P 500" stroke="#ffffff" strokeWidth={1.8} strokeDasharray="6 5" strokeOpacity={0.7} dot={false} connectNulls isAnimationActive={false}/>}
          </LineChart>
        </ResponsiveContainer>
      )}
      {enough&&hasSpy&&(
        <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:8,fontSize:11.5,color:"#94a3b8"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:14,height:2,background:col,display:"inline-block",borderRadius:2}}/>A tua rentabilidade</span>
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span aria-hidden="true" style={{width:16,borderTop:"2px dashed #ffffff",opacity:0.75,display:"inline-block"}}/>S&amp;P 500</span>
        </div>
      )}
      {provisional&&(
        <div style={{textAlign:"center",fontSize:12,color:"#6b7280",marginTop:8,lineHeight:1.5}}>
          Esta evolução não conta para a estatística. O gráfico vai recomeçar do 0 a partir do dia 1 de julho.
        </div>
      )}
    </div>
  );
}

/* ---- Sector exposure donut ----------------------------------------------- */
function SectorDonut({stocks}){
  // Tickers fora do mapa curado são resolvidos via /api/stocks/sector (que
  // aprende e guarda na BD). Até resolverem, ficam em "A identificar…".
  const [learned,setLearned]=useState({});
  const [hi,setHi]=useState(null); // setor em destaque (hover)
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
  const R=32.5,SW=26,C=2*Math.PI*R;
  let off=0;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
      <svg viewBox="0 0 100 100" style={{width:"clamp(110px,32vw,140px)",height:"auto",flexShrink:0,overflow:"visible",transform:"rotate(-90deg)"}}>
        {segs.map((s,i)=>{ const len=s.pct*C; const el=(
          <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color}
            strokeWidth={hi===i?SW+4:SW} opacity={hi==null||hi===i?1:0.28}
            style={{transition:"opacity .15s, stroke-width .15s",cursor:"pointer"}}
            onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)}
            strokeDasharray={`${len.toFixed(2)} ${(C-len).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)}/>
        ); off+=len; return el; })}
      </svg>
      <div style={{width:"100%",display:"flex",flexDirection:"column",gap:6}}>
        {segs.map((s,i)=>(
          <div key={i} onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)}
            style={{display:"flex",alignItems:"center",gap:10,fontSize:13,padding:"2px 6px",borderRadius:7,cursor:"pointer",
              opacity:hi==null||hi===i?1:0.4,background:hi===i?"rgba(255,255,255,0.05)":"transparent",transition:"opacity .15s, background .15s"}}>
            <span style={{width:10,height:10,borderRadius:3,background:s.color,flexShrink:0}}/>
            <span style={{flex:1,minWidth:0,color:"#cbd5e1",overflowWrap:"break-word"}}>{s.name}</span>
            <span style={{color:"#e2e8f0",fontWeight:700,fontFamily:"monospace"}}>{s.n}</span>
            <span style={{color:"#6b7280",fontFamily:"monospace",minWidth:38,textAlign:"right"}}>{Math.round(s.pct*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Detail -------------------------------------------------------------- */
// Pré-1jul: o próprio desbloqueia o seu portefólio com o código de 3 dígitos.
function OwnLockedGate({pf,nav,reload,showToast}){
  const [pin,setPin]=useState("");
  const [busy,setBusy]=useState(false);
  const ok=/^\d{3}$/.test(pin);
  async function unlock(){
    if(busy||!ok) return;
    setBusy(true);
    try{
      const r=await fetch("/api/portfolio/mine",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:pf.name,pin})});
      const d=await r.json();
      if(!r.ok||!d?.ok){ showToast&&showToast(d?.error||"Código incorreto.","error"); setBusy(false); return; }
      sset(K.MYPIN,pin);
      await reload(); // recarrega → o load() junta as tuas ações e este ecrã desaparece
    }catch{ showToast&&showToast("Falha de ligação.","error"); setBusy(false); }
  }
  return(
    <div style={{maxWidth:460,margin:"40px auto 80px",padding:"0 20px"}}>
      <button onClick={()=>nav("ranking")} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:20,display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Voltar ao ranking
      </button>
      <div style={{textAlign:"center",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:40}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:8}}>{pf.name}</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:20,lineHeight:1.6}}>
          Introduz o teu código de 3 dígitos para veres o teu portefólio.<br/>
          As ações só ficam visíveis a todos a 1 de julho.
        </p>
        <input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,3))}
          onKeyDown={e=>{ if(e.key==="Enter") unlock(); }}
          type="text" inputMode="numeric" autoComplete="off" maxLength={3} placeholder="• • •"
          style={{width:120,margin:"0 auto 14px",display:"block",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
            padding:"12px 14px",fontSize:18,letterSpacing:"6px",fontFamily:"monospace",color:"#e2e8f0",outline:"none",boxSizing:"border-box",
            textAlign:"center",WebkitTextSecurity:"disc",textSecurity:"disc"}}/>
        <button onClick={unlock} disabled={busy||!ok}
          style={{background:"#22c55e",color:"#000",border:"none",borderRadius:10,padding:"12px 24px",fontSize:15,fontWeight:700,
            cursor:busy||!ok?"not-allowed":"pointer",opacity:busy||!ok?0.6:1}}>
          {busy?"A verificar…":"Mostrar"}
        </button>
      </div>
    </div>
  );
}
function Detail({pf,rank,rowHover="#0a1120",livePrices,dayChange,spy,nav,onBack,myNorm,preLaunch,competitionStarted,gameStartDate,winners,reload,showToast}){
  const goBack=onBack||(()=>nav("ranking")); // voltar ao ranking (com destaque da linha, via onBack)
  // Coluna de rentabilidade da lista: "total" (desde a compra) ↔ "day" (diário).
  const [retMode,setRetMode]=useState("total");
  const rail=useBackRail();
  if(!pf) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Portefólio não encontrado. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  // Pré-1jul as ações dos oficiais estão escondidas. O próprio desbloqueia o seu
  // com o código de 3 dígitos (guardado para não voltar a pedir).
  const isOwn=myNorm&&pf.normName===myNorm;
  if(isOwn&&preLaunch&&(pf.stocks||[]).length===0){
    return <OwnLockedGate pf={pf} nav={nav} reload={reload} showToast={showToast}/>;
  }
  const st=pfStats(pf,livePrices);
  // Acento premium no cartão principal conforme o lugar (ouro/prata/bronze).
  const CARD_ACCENT={
    1:{border:"1px solid rgba(245,158,11,0.45)",glow:"0 0 38px rgba(245,158,11,0.20)"},
    2:{border:"1px solid rgba(203,213,225,0.42)",glow:"0 0 36px rgba(203,213,225,0.16)"},
    3:{border:"1px solid rgba(217,119,6,0.42)",glow:"0 0 36px rgba(217,119,6,0.17)"},
  };
  const acc=rank<=3?CARD_ACCENT[rank]:null;
  // Cor das divisórias da tabela: tom do lugar no Top 3; neutro claro (outline da box) no resto.
  const divider=rank===1?"rgba(245,158,11,0.28)":rank===2?"rgba(203,213,225,0.24)":rank===3?"rgba(217,119,6,0.26)":"rgba(255,255,255,0.10)";
  const rows=pf.stocks.map(s=>{
    const cur=curPrice(s.ticker,s.initialPrice,livePrices);
    return{...s,cur,ret:stockRet(s,livePrices)};
  });
  const dayRet=pfDayRet(pf,dayChange);
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
      {rail.active&&<LeftBackRail gap={rail.gap} onBack={goBack}/>}
      {rank===1&&<Confetti key={pf.key} intense={!!myNorm && pf.normName===myNorm}/>}
      <style>{`.cdiDetail{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1000px){.cdiDetail{grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);align-items:start}}`}</style>
      {!rail.active&&(
      <button onClick={goBack} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Ranking
      </button>
      )}

      <div className="cdiDetail">
      <div>{/* coluna esquerda: portefólio */}
      <div style={{position:"relative",marginBottom:16}}>
        {rank>=1&&rank<=3&&(
          <BreatheGlow inset="-16% -10%" base={0.4}
            color={rank===1?"rgba(245,200,80,0.55)":rank===2?"rgba(203,213,225,0.5)":"rgba(217,140,60,0.55)"}
            mid={rank===1?"rgba(245,158,11,0.18)":rank===2?"rgba(226,232,240,0.16)":"rgba(217,119,6,0.18)"}/>
        )}
        {rank===1&&(
          <GoldGlow src="/cdi-trophy.png" alt="Troféu de 1º lugar" maskSrc="/cdi-trophy.png" glow={26}
            baseFilter="drop-shadow(0 12px 22px rgba(0,0,0,0.5)) drop-shadow(0 0 20px rgba(245,158,11,0.4))"
            wrapStyle={{position:"absolute",top:"clamp(-66px,-7vw,-54px)",left:"50%",transform:"translateX(-50%)",width:"clamp(60px,7vw,72px)",zIndex:5}}
            imgStyle={{width:"100%",height:"auto"}}/>
        )}
      <TiltCard style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:acc?acc.border:"1px solid rgba(255,255,255,0.10)",boxShadow:acc?`${acc.glow}, 0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.16)`:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:28,zIndex:1}}>
        <div style={{textAlign:"center"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:14,marginBottom:16,minWidth:0}}>
            {rank>0&&(rank<=3
              ? <span className="rankShine rankBreathe" style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:20,fontWeight:800,...RANK_BADGE[rank],"--shine-delay":`${(rank-1)*1.2}s`}}>{rank}</span>
              : <span style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,fontWeight:800,color:"#94a3b8",border:"2px solid rgba(255,255,255,0.12)"}}>{rank}</span>
            )}
            <h1 style={{fontSize:"clamp(22px,5vw,26px)",fontWeight:800,letterSpacing:"-0.5px",margin:0,minWidth:0,lineHeight:1.2,overflowWrap:"anywhere"}}>{pf.name}</h1>
            {(()=>{ const w=winners&&winners[pf.key]; if(!w) return null;
              const badge=(src,alt,arr)=> arr.length>0?(
                <span key={src} title={`${alt}: ${arr.join(", ")}`} style={{position:"relative",display:"inline-flex",flexShrink:0}}>
                  <img src={src} alt={alt} style={{width:36,height:36,display:"block",filter:"drop-shadow(0 2px 6px rgba(0,0,0,0.45))"}}/>
                  {arr.length>1&&<span style={{position:"absolute",bottom:-3,right:-6,fontSize:9.5,fontWeight:800,color:"#0a0a0a",background:"#facc15",borderRadius:999,padding:"0 4px",lineHeight:"14px",minWidth:14,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.4)"}}>×{arr.length}</span>}
                </span>
              ):null;
              return <>{badge("/cdi-mensal-winner.webp","Vencedor mensal",w.monthly)}{badge("/cdi-semana-winner.webp","Vencedor semanal",w.weekly)}</>;
            })()}
          </div>
          <div style={{fontSize:"clamp(34px,9vw,42px)",fontWeight:800,fontFamily:"monospace",lineHeight:1,
            color:st.total>=0?"#4ade80":"#f87171"}}><Tri up={st.total>=0} size="0.78em"/> <Rolling text={pct(Math.abs(st.total)).replace(/[+-]/,"")}/></div>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rentabilidade média</div>
          <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"10px 24px",marginTop:18,fontSize:13,color:"#94a3b8"}}>
            <span style={{color:"#4ade80"}}><Tri size={11}/> {st.pos} positivas</span>
            <span style={{color:"#f87171"}}><Tri up={false} size={11}/> {st.neg} negativas</span>
            {dayRet!=null&&(
              <span title="Rentabilidade do portefólio hoje">
                Diário: <strong style={{color:dayRet>=0?"#4ade80":"#f87171"}}><Rolling text={pct(dayRet)}/></strong>
              </span>
            )}
          </div>
          <p style={{fontSize:13,color:"#94a3b8",margin:"16px 0 0"}}>Submetido a {dt(pf.submittedAt)}</p>
        </div>
      </TiltCard>
      </div>

      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
        <div style={{display:"grid",alignItems:"center",gridTemplateColumns:"1.6fr 1fr 1fr 1.4fr",
          padding:"10px 20px",borderBottom:`1px solid ${divider}`,
          fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600,lineHeight:1.2}}>
          <span>Ação</span>
          <span style={{textAlign:"center"}}>Preço inicial</span>
          <span style={{textAlign:"center"}}>Preço atual</span>
          <span onClick={()=>setRetMode(m=>m==="total"?"day":"total")}
            title="Clica para alternar entre 'Desde o início' e 'Diário'"
            style={{textAlign:"center",cursor:"pointer",userSelect:"none",lineHeight:1.2,display:"block"}}>
            {retMode==="day"?"Diário":"Desde o início"}
            <span style={{fontSize:9,opacity:0.85,marginLeft:4}}>▾</span>
          </span>
        </div>
        {bySorted.map(s=>(
          <div key={s.ticker} className="stockRow" style={{display:"grid",gridTemplateColumns:"1.6fr 1fr 1fr 1.4fr",alignItems:"center",gap:4,padding:"14px 20px",borderBottom:`1px solid ${divider}`}}
            onMouseEnter={e=>{ e.currentTarget.style.background=rowHover; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
            <div style={{minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                <StockLogo ticker={s.ticker} size={32}/>
                <span style={{display:"inline-flex",alignItems:"center",gap:2,minWidth:0}}>
                  <span style={{fontWeight:800,fontSize:14,color:"#e2e8f0"}}>{s.ticker}</span>
                  <SideBadge side={s.side}/>
                </span>
              </div>
              <div style={{fontSize:13,color:"#94a3b8",marginTop:6,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.companyName}</div>
            </div>
            <span style={{textAlign:"center",fontFamily:"monospace",fontSize:"clamp(10.5px,2.7vw,13px)",color:"#94a3b8",whiteSpace:"nowrap"}}>{money(s.initialPrice,s.currency)}</span>
            <span style={{textAlign:"center",fontFamily:"monospace",fontSize:"clamp(10.5px,2.7vw,13px)",color:"#e2e8f0",whiteSpace:"nowrap"}}>{money(s.cur,s.currency)}</span>
            {(()=>{
              const rawDay=dc[s.ticker];
              const dayVal=Number.isFinite(rawDay)?(s.side==="short"?-rawDay:rawDay):null;
              const v=retMode==="day"?dayVal:s.ret;
              const toggle=()=>setRetMode(m=>m==="total"?"day":"total");
              // Célula preenche a altura toda da linha (margem negativa cobre o padding)
              // → clicar em qualquer ponto da coluna alterna, não só no número.
              const base={fontFamily:"monospace",fontSize:"clamp(11px,2.9vw,15px)",fontWeight:700,
                whiteSpace:"nowrap",cursor:"pointer",userSelect:"none",
                alignSelf:"stretch",margin:"-14px 0",display:"flex",alignItems:"center",justifyContent:"center"};
              if(v==null) return <span onClick={toggle} title="Alternar Desde o início / Diário" style={{...base,color:"#4b5563"}}>—</span>;
              return(
                <span onClick={toggle} title="Alternar Desde o início / Diário"
                  style={{...base,color:v>=0?"#4ade80":"#f87171"}}>
                  <Tri up={v>=0} size={13}/> {pct(Math.abs(v)).replace(/[+-]/,"")}
                </span>
              );
            })()}
          </div>
        ))}
      </div>
      </div>{/* /coluna esquerda */}

      <div>{/* coluna direita: análises */}
      {/* Evolução (#5) + Exposição por setor */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:16}}>
        <TiltCard style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 className="detailCardTitle" style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Evolução da rentabilidade</h3>
          <EvolutionChart portfolioId={pf.id} currentReturn={st.total} submittedAt={pf.submittedAt} competitionStarted={competitionStarted} gameStartDate={gameStartDate} spy={spy} spyInitialPrice={pf.spyInitialPrice}/>
        </TiltCard>
        <TiltCard style={{...GLASS,borderRadius:16,padding:24}}>
          <h3 className="detailCardTitle" style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Exposição por setor</h3>
          <SectorDonut stocks={pf.stocks}/>
        </TiltCard>
      </div>

      {/* Destaques — melhor/pior performance DO DIA. A pill "Performance de hoje"
          fica POR BAIXO das boxes (desktop) ou ENTRE elas (mobile), via grid-areas. */}
      <style>{`
        .dayGrid{display:grid;gap:16px;align-items:start;grid-template-columns:1fr 1fr;grid-template-areas:"best worst" "pill pill"}
        .dayPill{grid-area:pill;justify-self:center;position:relative;display:inline-flex;align-items:center;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#cbd5e1;border-radius:999px;padding:6px 18px;background:rgba(255,255,255,0.05)}
        .dayPill::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(90deg,rgba(74,222,128,0.8),rgba(248,113,113,0.8));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
        @media(max-width:560px){.dayGrid{grid-template-columns:1fr;grid-template-areas:"best" "pill" "worst"}.dayPill::before{background:linear-gradient(180deg,rgba(74,222,128,0.8),rgba(248,113,113,0.8))}}
      `}</style>
      <div className="dayGrid">
        <TiltCard style={{...GLASS,gridArea:"best",minWidth:0,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(34,197,94,0.12), rgba(34,197,94,0.03))",
          border:"1px solid rgba(34,197,94,0.20)"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><DayChip up/></div>
          {byDay.length?<TopList items={byDay.slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </TiltCard>
        <TiltCard style={{...GLASS,gridArea:"worst",minWidth:0,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(239,68,68,0.12), rgba(239,68,68,0.03))",
          border:"1px solid rgba(239,68,68,0.20)"}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:14}}><DayChip/></div>
          {byDay.length?<TopList items={[...byDay].reverse().slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </TiltCard>
        <div className="dayPill">Performance de hoje</div>
      </div>
      </div>{/* /coluna direita */}
      </div>{/* /cdiDetail */}
    </div>
  );
}

// Seta que distingue a box "melhor" (▲) da "pior" (▼).
// Triângulo ▲/▼ com cantos arredondados (substitui os caracteres Unicode, que não dobram cantos).
function Tri({up=true,size=12,color="currentColor",style}){
  return(
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color}
      strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"
      style={{display:"inline-block",verticalAlign:"middle",...style}}>
      {up?<path d="M12 6 L20.5 18.5 L3.5 18.5 Z"/>:<path d="M12 18 L3.5 5.5 L20.5 5.5 Z"/>}
    </svg>
  );
}
function DayChip({up}){
  const c=up?"#4ade80":"#f87171";
  const bg=up?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)";
  const bd=up?"rgba(34,197,94,0.3)":"rgba(239,68,68,0.3)";
  return(
    <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:26,height:26,borderRadius:"50%",fontSize:12,fontWeight:800,
      color:c,background:bg,border:`1px solid ${bd}`}}>
      <Tri up={up} size={11}/>
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
  if(snaps===null) return <Skeleton w="100%" h={200} r={10} style={{display:"block"}}/>;
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
      <div style={{display:"flex",gap:16,marginBottom:10,fontSize:12,justifyContent:"center"}}>
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
      color:win?"#4ade80":"#94a3b8"}}>{fmt(val)}</span>
  );
  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:14,padding:"9px 10px",margin:"0 -10px",borderRadius:8,borderBottom:"1px solid rgba(255,255,255,0.06)",transition:"background .15s"}}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.05)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <div style={{textAlign:"right"}}>{cell(a,aw)}</div>
      <span style={{fontSize:10,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.6px",whiteSpace:"nowrap"}}>{label}</span>
      <div style={{textAlign:"left"}}>{cell(b,bw)}</div>
    </div>
  );
}
function DuelHoldings({title,tickers,color,names}){
  if(!tickers.length) return null;
  return(
    <div style={{marginBottom:14,textAlign:"center"}}>
      <div style={{fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>{title}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
        {tickers.map(t=>(
          <span key={t} title={names?.[t]||t} style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(0,0,0,0.18)",
            border:`1px solid ${color||"rgba(255,255,255,0.08)"}`,borderRadius:999,padding:"5px 10px 5px 6px",fontSize:12,fontWeight:700,color:"#e2e8f0"}}>
            <StockLogo ticker={t} size={18}/>{t}
          </span>
        ))}
      </div>
    </div>
  );
}
function PickCell({s,kind}){
  const up=kind==="best";
  const col=up?"#4ade80":"#f87171";
  const bg=up?"rgba(34,197,94,0.10)":"rgba(239,68,68,0.10)";
  const bd=up?"rgba(34,197,94,0.20)":"rgba(239,68,68,0.20)";
  return(
    <div title={s.companyName||s.ticker} style={{display:"flex",alignItems:"center",gap:5,background:bg,border:`1px solid ${bd}`,borderRadius:9,padding:"5px 8px",minWidth:0,overflow:"hidden"}}>
      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:9,flexShrink:0,color:col}}><Tri up={up} size={8}/></span>
      <span style={{flexShrink:0,display:"inline-flex"}}><StockLogo ticker={s.ticker} size={16}/></span>
      <span style={{flex:1,minWidth:0,fontSize:"clamp(9.5px,2.4vw,12px)",fontWeight:800,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.ticker}</span>
      {s.side==="short"&&<span style={{flexShrink:0}}><SideBadge side="short"/></span>}
      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:"clamp(9.5px,2.4vw,12px)",color:col,flexShrink:0,whiteSpace:"nowrap",marginLeft:4}}>{pct(s.ret)}</span>
    </div>
  );
}
function DuelPicksSide({rows}){
  const best=rows.reduce((m,s)=>s.ret>m.ret?s:m,rows[0]);
  const worst=rows.reduce((m,s)=>s.ret<m.ret?s:m,rows[0]);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:14,textAlign:"left"}}>
      <PickCell s={best} kind="best"/>
      <PickCell s={worst} kind="worst"/>
    </div>
  );
}
function Duel({a,b,livePrices,spy,dayChange,nav}){
  if(!a||!b) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Duelo inválido. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  const sa=pfStats(a,livePrices), sb=pfStats(b,livePrices);
  const ra=a.stocks.map(s=>({...s,ret:stockRet(s,livePrices)}));
  const rb=b.stocks.map(s=>({...s,ret:stockRet(s,livePrices)}));
  const dayA=pfDayRet(a,dayChange), dayB=pfDayRet(b,dayChange);
  const diff=a.total-b.total;
  const leader=diff>=0?a:b, gap=Math.abs(diff);
  const setA=new Set(a.stocks.map(s=>s.ticker)), setB=new Set(b.stocks.map(s=>s.ticker));
  const common=[...setA].filter(t=>setB.has(t));
  const onlyA=[...setA].filter(t=>!setB.has(t));
  const onlyB=[...setB].filter(t=>!setA.has(t));
  // Quebra o nome em primeiro nome / apelido (mesmo para nomes curtos).
  const nameLines=(n)=>{ const p=String(n||"").trim().split(/\s+/); return p.length<2?n:<>{p[0]}<br/>{p.slice(1).join(" ")}</>; };
  // ticker → nome da empresa (para tooltip nos chips das carteiras).
  const nameByTicker={}; [...a.stocks,...b.stocks].forEach(s=>{ nameByTicker[s.ticker]=s.companyName; });
  return(
    <div style={{maxWidth:980,margin:"0 auto",padding:"40px 20px 80px"}}>
      <button onClick={()=>nav("ranking")} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Voltar ao ranking
      </button>

      {/* Cabeçalho do duelo */}
      <GlowBehind>
      <div style={{...GLASS,borderRadius:16,padding:"clamp(14px,4vw,28px)",marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"start",gap:"clamp(6px,2.5vw,16px)"}}>
          <div style={{textAlign:"right",minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,marginBottom:6}}>
              <span style={{fontSize:"clamp(14px,4vw,16px)",fontWeight:800,letterSpacing:"-0.3px",lineHeight:1.2,minWidth:0,overflowWrap:"anywhere"}}>{nameLines(a.name)}</span>
              <span style={{width:9,height:9,borderRadius:"50%",background:DUEL_A,flexShrink:0,boxShadow:`0 0 8px ${DUEL_A}`}}/>
            </div>
            <div style={{fontSize:30,fontWeight:800,fontFamily:"monospace",letterSpacing:"-1px",color:sa.total>=0?"#4ade80":"#f87171"}}><Rolling text={pct(sa.total)}/></div>
            <DuelPicksSide rows={ra}/>
          </div>
          <div style={{width:44,height:44,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:30,
            fontSize:13,fontWeight:800,color:"#cbd5e1",letterSpacing:"0.5px",
            background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)"}}>VS</div>
          <div style={{textAlign:"left",minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:"50%",background:DUEL_B,flexShrink:0,boxShadow:`0 0 8px ${DUEL_B}`}}/>
              <span style={{fontSize:"clamp(14px,4vw,16px)",fontWeight:800,letterSpacing:"-0.3px",lineHeight:1.2,minWidth:0,overflowWrap:"anywhere"}}>{nameLines(b.name)}</span>
            </div>
            <div style={{fontSize:30,fontWeight:800,fontFamily:"monospace",letterSpacing:"-1px",color:sb.total>=0?"#4ade80":"#f87171"}}><Rolling text={pct(sb.total)}/></div>
            <DuelPicksSide rows={rb}/>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:18}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",
            borderRadius:999,padding:"7px 18px",fontSize:13,fontWeight:700,color:"#fbbf24"}}>
            {gap<1e-9?"Empate técnico":`🏆 ${leader.name} lidera por ${(gap*100).toFixed(2)}%`}
          </span>
        </div>
      </div>
      </GlowBehind>

      {/* Evolução sobreposta */}
      <div style={{...GLASS,borderRadius:16,padding:24,marginBottom:16}}>
        <h3 className="detailCardTitle" style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af"}}>Evolução da rentabilidade</h3>
        <DuelChart a={a} b={b} curA={sa.total} curB={sb.total}/>
      </div>

      {/* Confronto de métricas */}
      <div style={{...GLASS,borderRadius:16,padding:"8px 24px 16px",marginBottom:16}}>
        <DuelMetric label="Rentab. média" a={sa.total} b={sb.total} better="high" fmt={pct}/>
        {dayA!=null&&dayB!=null&&<DuelMetric label="Diário" a={dayA} b={dayB} better="high" fmt={pct}/>}
        <DuelMetric label="Positivas" a={sa.pos} b={sb.pos} better="high" fmt={v=>String(v)}/>
        <DuelMetric label="Negativas" a={sa.neg} b={sb.neg} better="low" fmt={v=>String(v)}/>
      </div>

      {/* Carteiras: comum vs exclusivas */}
      <div style={{...GLASS,borderRadius:16,padding:24,marginBottom:16}}>
        <h3 style={{fontSize:14,fontWeight:600,marginBottom:14,color:"#9ca3af",textAlign:"center"}}>Carteiras</h3>
        <DuelHoldings title="Em comum" tickers={common} color="rgba(255,255,255,0.14)" names={nameByTicker}/>
        <DuelHoldings title={`Só ${a.name}`} tickers={onlyA} color="rgba(59,130,246,0.4)" names={nameByTicker}/>
        <DuelHoldings title={`Só ${b.name}`} tickers={onlyB} color="rgba(245,158,11,0.4)" names={nameByTicker}/>
      </div>

      {/* Exposição por setor lado a lado */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"clamp(8px,2vw,16px)"}}>
        <div style={{...GLASS,minWidth:0,borderRadius:16,padding:"clamp(12px,3vw,24px)"}}>
          <h3 style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#e2e8f0",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</h3>
          <SectorDonut stocks={a.stocks}/>
        </div>
        <div style={{...GLASS,minWidth:0,borderRadius:16,padding:"clamp(12px,3vw,24px)"}}>
          <h3 style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#e2e8f0",textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.name}</h3>
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
  const [editKey,setEditKey]=useState(null);
  const [editName,setEditName]=useState("");
  const [editPinKey,setEditPinKey]=useState(null);
  const [editPin,setEditPin]=useState("");
  const [pins,setPins]=useState({}); // { user_id: pin } — códigos dos membros
  const [fullPfs,setFullPfs]=useState(null); // portefólios completos (com ações dos oficiais) via service_role
  const [readiness,setReadiness]=useState(null); // relatório de prontidão para o lançamento
  const [checkingRd,setCheckingRd]=useState(false);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        const res=await fetch("/api/admin/pins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
        const data=await res.json();
        if(!cancel&&res.ok&&data?.pins) setPins(data.pins);
      }catch{}
      try{
        const res=await fetch("/api/admin/portfolios",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
        const data=await res.json();
        if(!cancel&&res.ok&&Array.isArray(data?.portfolios)){
          setFullPfs(data.portfolios.filter(r=>r.users?.has_submitted_portfolio).map(mapPortfolioFromSupabase));
        }
      }catch{}
    })();
    return()=>{ cancel=true; };
  },[pw,portfolios]);
  // Usa os portefólios completos (admin) se disponíveis; senão, os públicos (prop).
  const apfs = fullPfs||portfolios;
  const aranking = apfs.map(p=>({...p,...pfStats(p,livePrices)}))
    .sort((a,b)=>(Number.isFinite(b.total)?b.total:-Infinity)-(Number.isFinite(a.total)?a.total:-Infinity));

  // PASSO 1 — trancar preços de partida no fecho de 30 jun. dryRun pré-vê sem gravar.
  async function lockBaselines(dryRun){
    if(!dryRun&&!confirm("Trancar o preço de partida de TODOS os portefólios no FECHO de 30 jun?\n\nFaz isto a 30 de junho DEPOIS do fecho do mercado US (~21:00 PT). Não revela os oficiais — isso é o passo 2 (Arrancar).")) return;
    try{
      const res=await fetch("/api/admin/lock-baselines",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,dryRun})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível trancar os preços.","error"); return; }
      if(dryRun){
        showToast(`Pré-visualização: ${data.tickers} tickers — pipeline ${data.usedAth??0}, fecho ${data.usedClose}, vivo ${data.usedLive}, SEM ${data.missing}.`);
        return;
      }
      setSettings(s=>({...(s||{}),baselinesLockedAt:data.lockedAt}));
      await reload();
      showToast(`${data.stocksUpdated} ações trancadas no fecho de 30 jun.`);
    }catch{ showToast("Falha de ligação.","error"); }
  }
  // PASSO 2 — arrancar (revela os oficiais). Os preços já têm de estar trancados.
  async function startCompetition(){
    if(!confirm("Arrancar a competição?\n\nVai REVELAR os portefólios oficiais. Os preços de partida já têm de estar trancados (fecho de 30 jun). Faz isto a 1 de julho.")) return;
    try{
      const res=await fetch("/api/admin/start-competition",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível arrancar a competição.","error"); return; }
      setSettings(s=>({...(s||{}),competitionStarted:true}));
      await reload();
      showToast("Competição a decorrer.");
    }catch{ showToast("Falha de ligação.","error"); }
  }
  // Verificação de prontidão para o lançamento (diagnóstico, só leitura).
  async function checkReadiness(){
    setCheckingRd(true);
    try{
      const res=await fetch("/api/admin/readiness",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível verificar.","error"); return; }
      setReadiness(data);
    }catch{ showToast("Falha de ligação.","error"); }
    finally{ setCheckingRd(false); }
  }
  async function savePin(p){
    const code=editPin.trim();
    if(!/^\d{3}$/.test(code)){ showToast("O código tem de ter 3 dígitos.","error"); return; }
    try{
      const res=await fetch("/api/admin/set-pin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,userId:p.userId,pin:code})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível guardar o código.","error"); return; }
      setPins(prev=>({...prev,[p.userId]:code}));
      setEditPinKey(null);
      showToast("Código guardado.");
    }catch{ showToast("Falha de ligação.","error"); }
  }
  async function saveName(p){
    const name=editName.trim();
    if(name.length<2){ showToast("Nome demasiado curto.","error"); return; }
    try{
      const res=await fetch("/api/admin/rename",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,userId:p.userId,name})});
      const data=await res.json();
      if(!res.ok||!data?.ok){ showToast(data?.error||"Não foi possível guardar o nome.","error"); return; }
      setEditKey(null);
      await reload();
      showToast("Nome atualizado.");
    }catch{ showToast("Falha de ligação.","error"); }
  }
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
    aranking.forEach((p,i)=>rows.push([i+1,p.name,(p.total*100).toFixed(2),p.pos,p.neg,dt(p.submittedAt)]));
    dlCSV("ranking.csv",rows);
  }
  function expDetail(){
    const rows=[["Membro","Data","Ticker","Empresa","Preço inicial","Preço atual","Rentab. %"]];
    apfs.forEach(p=>p.stocks.forEach(s=>{
      const cur=curPrice(s.ticker,s.initialPrice,livePrices);
      rows.push([p.name,dt(p.submittedAt),s.ticker,s.companyName,s.initialPrice,cur,((cur/s.initialPrice-1)*100).toFixed(2)]);
    }));
    dlCSV("detalhe.csv",rows);
  }

  const TABS=[["portfolios","👥 Portefólios"],["game","⚙️ Jogo"],["export","⬇️ Exportar"]];

  return(
    <div style={{maxWidth:1200,margin:"0 auto",padding:"40px 20px 80px"}}>
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
          {apfs.length===0?(
            <p style={{padding:40,textAlign:"center",color:"#4b5563"}}>Sem portefólios ainda.</p>
          ):(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1.4fr 1.6fr 100px 130px 44px",
                padding:"10px 20px",borderBottom:"1px solid #1f2937",
                fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
                <span>Membro</span><span>Ações</span><span style={{textAlign:"right"}}>Rentab.</span>
                <span style={{textAlign:"right"}}>Data</span><span/>
              </div>
              {[...aranking].sort((a,b)=>String(b.submittedAt||"").localeCompare(String(a.submittedAt||""))).map(p=>(
                <div key={p.key} style={{display:"grid",gridTemplateColumns:"1.4fr 1.6fr 100px 130px 44px",
                  padding:"12px 20px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
                  {editKey===p.key?(
                    <span style={{display:"flex",alignItems:"center",gap:6}}>
                      <input value={editName} onChange={e=>setEditName(e.target.value)}
                        onKeyDown={e=>{ if(e.key==="Enter") saveName(p); if(e.key==="Escape") setEditKey(null); }}
                        autoFocus
                        style={{flex:1,minWidth:0,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,
                          padding:"6px 10px",fontSize:13,color:"#e2e8f0",outline:"none"}}/>
                      <button onClick={()=>saveName(p)} title="Guardar" style={{background:"none",border:"none",cursor:"pointer",color:"#4ade80",fontSize:15,padding:2}}>✓</button>
                      <button onClick={()=>setEditKey(null)} title="Cancelar" style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:15,padding:2}}>✕</button>
                    </span>
                  ):(
                    <span style={{fontWeight:600,fontSize:14,display:"flex",alignItems:"center",gap:8}}>
                      {p.official&&isPreLaunch(settings)&&<span style={{fontSize:9,background:"rgba(251,191,36,0.15)",color:"#fbbf24",
                        border:"1px solid rgba(251,191,36,0.3)",borderRadius:999,padding:"2px 6px",fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>EM ESPERA</span>}
                      {editPinKey===p.key?(
                        <span style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>
                          <input value={editPin} onChange={e=>setEditPin(e.target.value.replace(/\D/g,"").slice(0,3))}
                            onKeyDown={e=>{ if(e.key==="Enter") savePin(p); if(e.key==="Escape") setEditPinKey(null); }} autoFocus
                            type="text" inputMode="numeric" maxLength={3} placeholder="000"
                            style={{width:46,background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:6,
                              padding:"3px 6px",fontSize:12,fontFamily:"monospace",letterSpacing:"2px",color:"#e2e8f0",outline:"none",textAlign:"center"}}/>
                          <button onClick={()=>savePin(p)} title="Guardar" style={{background:"none",border:"none",cursor:"pointer",color:"#4ade80",fontSize:14,padding:2}}>✓</button>
                          <button onClick={()=>setEditPinKey(null)} title="Cancelar" style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,padding:2}}>✕</button>
                        </span>
                      ):(
                        <button onClick={()=>{ setEditPinKey(p.key); setEditPin(pins[p.userId]||""); }} title="Definir/editar código"
                          style={{fontSize:11,fontFamily:"monospace",fontWeight:700,flexShrink:0,cursor:"pointer",borderRadius:6,padding:"2px 7px",
                            color:pins[p.userId]?"#cbd5e1":"#fbbf24",
                            background:pins[p.userId]?"rgba(255,255,255,0.06)":"rgba(251,191,36,0.12)",
                            border:`1px solid ${pins[p.userId]?"rgba(255,255,255,0.12)":"rgba(251,191,36,0.35)"}`}}>
                          🔑 {pins[p.userId]||"definir"}
                        </button>
                      )}
                      <span style={{whiteSpace:"nowrap"}}>{p.name}</span>
                      <button onClick={()=>{ setEditKey(p.key); setEditName(p.name); }} title="Editar nome"
                        style={{background:"none",border:"none",cursor:"pointer",color:"#4b5563",fontSize:12,padding:0,flexShrink:0}}
                        onMouseEnter={e=>e.currentTarget.style.color="#cbd5e1"}
                        onMouseLeave={e=>e.currentTarget.style.color="#4b5563"}>✎</button>
                    </span>
                  )}
                  <span style={{fontSize:11,color:"#e2e8f0",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.stocks.map(s=>s.ticker).join(" · ")}
                  </span>
                  <span style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:p.total>=0?"#4ade80":"#f87171"}}>
                    {pct(p.total)}
                  </span>
                  <span style={{textAlign:"right",fontSize:11,color:"#cbd5e1"}}>{dt(p.submittedAt)}</span>
                  <button onClick={()=>delPf(p)}
                    style={{background:"none",border:"none",cursor:"pointer",color:"#4b5563",padding:8,
                      borderRadius:6,fontSize:20,lineHeight:1}}
                    title="Eliminar"
                    onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
                    onMouseLeave={e=>e.currentTarget.style.color="#4b5563"}>
                    ⓧ
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
            <h3 style={{fontWeight:700,marginBottom:8}}>Competição</h3>
            <p style={{fontSize:13,color:"#94a3b8",margin:"0 0 16px",lineHeight:1.5}}>
              Estado: <strong style={{color:settings.competitionStarted?"#4ade80":settings.baselinesLockedAt?"#60a5fa":"#fbbf24"}}>
                {settings.competitionStarted?"A decorrer":settings.baselinesLockedAt?"Preços trancados — pronto a arrancar":"Por iniciar (modo demonstração)"}</strong>.
            </p>

            {/* PASSO 1 — trancar preços de partida no fecho de 30 jun */}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:6}}>Passo 1 — Trancar preços de partida</div>
              <p style={{fontSize:12.5,color:"#94a3b8",margin:"0 0 10px",lineHeight:1.5}}>
                A 30 jun, depois do fecho US (~21:00 PT). Fixa o baseline de todos no fecho de 30 jun.
                {settings.baselinesLockedAt&&<><br/><span style={{color:"#4ade80"}}>✅ Trancado a {new Date(settings.baselinesLockedAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}</span></>}
              </p>
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <button onClick={()=>lockBaselines(true)} disabled={settings.competitionStarted}
                  style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,
                    padding:"10px 16px",fontSize:13.5,fontWeight:600,color:"#cbd5e1",cursor:settings.competitionStarted?"not-allowed":"pointer"}}>
                  🔍 Pré-ver fecho (não grava)
                </button>
                <button onClick={()=>lockBaselines(false)} disabled={settings.competitionStarted||!!settings.baselinesLockedAt}
                  style={{background:(settings.competitionStarted||settings.baselinesLockedAt)?"rgba(255,255,255,0.06)":"linear-gradient(180deg,#38bdf8,#0ea5e9)",
                    color:(settings.competitionStarted||settings.baselinesLockedAt)?"#64748b":"#04222e",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,
                    padding:"10px 16px",fontSize:13.5,fontWeight:700,cursor:(settings.competitionStarted||settings.baselinesLockedAt)?"not-allowed":"pointer"}}>
                  🔒 Trancar preços (fecho 30 jun)
                </button>
              </div>
            </div>

            {/* PASSO 2 — arrancar (revela oficiais) */}
            <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",marginBottom:6}}>Passo 2 — Arrancar competição</div>
              <p style={{fontSize:12.5,color:"#94a3b8",margin:"0 0 10px",lineHeight:1.5}}>
                A 1 jul. Revela os portefólios oficiais.{!settings.baselinesLockedAt&&<span style={{color:"#fbbf24"}}> Tranca primeiro os preços (passo 1).</span>}
              </p>
              <button onClick={startCompetition} disabled={settings.competitionStarted||!settings.baselinesLockedAt}
                style={{background:(settings.competitionStarted||!settings.baselinesLockedAt)?"rgba(255,255,255,0.06)":"linear-gradient(180deg,#34d36a,#22c55e)",
                  color:(settings.competitionStarted||!settings.baselinesLockedAt)?"#64748b":"#062b14",border:"1px solid rgba(255,255,255,0.2)",borderRadius:10,
                  padding:"11px 20px",fontSize:14,fontWeight:700,cursor:(settings.competitionStarted||!settings.baselinesLockedAt)?"not-allowed":"pointer"}}>
                🚀 Arrancar competição
              </button>
            </div>

            {/* Verificação de prontidão para o lançamento */}
            <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:16,marginTop:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0"}}>Verificação de prontidão</div>
                <button onClick={checkReadiness} disabled={checkingRd}
                  style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,
                    padding:"8px 14px",fontSize:13,fontWeight:600,color:"#cbd5e1",cursor:checkingRd?"default":"pointer"}}>
                  {checkingRd?"A verificar…":"🩺 Verificar"}</button>
              </div>
              {readiness&&(()=>{
                const ok=(b)=>({c:b?"#4ade80":"#f87171",t:b?"✅":"❌"});
                const warn=(b)=>({c:b?"#fbbf24":"#4ade80",t:b?"⚠️":"✅"});
                const info={c:"#94a3b8",t:"•"};
                const fmt=(d)=>d?new Date(d).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"}):"—";
                const stale=(d,h)=>!d||(Date.now()-new Date(d).getTime())>h*3600*1000;
                const e=readiness.env||{}, s=readiness.settings||{};
                const row=(label,st,value)=>(
                  <div key={label} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                    <span style={{color:"#94a3b8"}}>{label}</span>
                    <span style={{color:st.c,fontWeight:600,whiteSpace:"nowrap",textAlign:"right"}}>{st.t} {value}</span>
                  </div>
                );
                return(
                  <div style={{marginTop:12,fontSize:12.5}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                      {Object.entries(e).map(([k,v])=>(
                        <span key={k} style={{fontSize:11,fontWeight:600,padding:"3px 8px",borderRadius:999,
                          background:v?"rgba(34,197,94,0.15)":"rgba(248,113,113,0.15)",color:v?"#86efac":"#fca5a5",
                          border:`1px solid ${v?"rgba(34,197,94,0.4)":"rgba(248,113,113,0.4)"}`}}>{v?"✅":"❌"} {k}</span>
                      ))}
                    </div>
                    {row("Ações sem preço de partida",ok(readiness.stocksWithoutBaseline===0),readiness.stocksWithoutBaseline)}
                    {row("Oficiais sem ações",ok(readiness.officialEmpty===0),readiness.officialEmpty)}
                    {row("Demos sem PIN",ok(readiness.demosWithoutPin===0),readiness.demosWithoutPin)}
                    {row("ATH atualizado",warn(stale(readiness.athLatest,30)),fmt(readiness.athLatest))}
                    {row("Último snapshot",warn(stale(readiness.snapshotLatest,30)),fmt(readiness.snapshotLatest))}
                    {row("Tickers distintos",info,readiness.distinctTickers)}
                    {row("Preços trancados",s.baselines_locked_at?ok(true):warn(true),s.baselines_locked_at?fmt(s.baselines_locked_at):"não")}
                    {row("Competição a decorrer",s.competition_started?ok(true):info,s.competition_started?"sim":"não")}
                    {row("Submissões",info,s.submissions_open?"abertas":"fechadas")}
                    {row("Início → Fim",info,`${fmt(s.game_start_date)} → ${fmt(s.game_end_date)}`)}
                    <p style={{fontSize:11,color:"#64748b",marginTop:8}}>Nota: os GitHub Secrets (workflows) não se veem aqui — confirma-os no GitHub.</p>
                  </div>
                );
              })()}
            </div>
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
// Ícones inline para os CTAs do herói (sem emojis).
function Arrow(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>;
}
function LockIcon(){
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><rect x="4.5" y="11" width="15" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>;
}

function Btn({children,onClick,primary,large}){
  return(
    <button onClick={onClick}
      style={{background:primary?"#22c55e":"transparent",color:primary?"#000":"#e2e8f0",
        border:primary?"none":"1px solid #374151",borderRadius:10,
        padding:large?"15px 36px":"10px 22px",fontSize:large?16:14,fontWeight:700,cursor:"pointer",
        display:"inline-flex",alignItems:"center",justifyContent:"center",whiteSpace:"nowrap",textAlign:"center",
        transition:"background .15s, border-color .15s, transform .12s"}}
      onMouseEnter={e=>{ if(primary) e.currentTarget.style.background="#16a34a"; else e.currentTarget.style.borderColor="#6b7280"; e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e=>{ if(primary) e.currentTarget.style.background="#22c55e"; else e.currentTarget.style.borderColor="#374151"; e.currentTarget.style.transform="none"; }}
      onMouseDown={e=>{ e.currentTarget.style.transform="scale(0.97)"; }}
      onMouseUp={e=>{ e.currentTarget.style.transform="translateY(-1px)"; }}>
      {children}
    </button>
  );
}

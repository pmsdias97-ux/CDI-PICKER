"use client";

import { useState, useEffect, useMemo, useCallback, useId, useRef } from "react";
import { BUILD_VERSION } from "./version";
import { supabase } from "./supabase";
import { fetchStockInfo, fetchStockPrices, fetchStockHistory, searchTickers } from "./lib/stocks";
import { searchCryptos, isCrypto, cryptoNameFor } from "./lib/crypto";
import { searchPopular } from "./lib/popular";
import { searchCommodities } from "./lib/commodities";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

/* ============================================================================
   CONVERSAS DE INVESTIDORES
   ============================================================================ */

const TICKER_RE = /^[A-Z0-9.\-=]{1,12}$/; // "=" p/ futuros de commodities (CC=F)
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
function ATH({myTickers,auth,showToast}){
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
    try{ const saved=await apiSave({listName:nm,tickers:ticker?[String(ticker).toUpperCase()]:[]}); setLists(ls=>[...ls,saved]); return saved; }
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
  const addDirect=useCallback(async(term)=>{
    const tk=String(term||"").toUpperCase().trim(); if(!tk) return;
    try{
      const info=await fetchStockInfo(tk);
      if(!info||typeof info.price!=="number"){ showToast&&showToast(`Não encontrei "${tk}".`,"error"); return; }
      setLiteQuotes(qq=>({...qq,[tkNorm(tk)]:{...(qq[tkNorm(tk)]||{}),name:info.name||tk}}));
      openAdd(tk);
    }catch{ showToast&&showToast(`Não encontrei "${tk}".`,"error"); }
  },[openAdd,showToast]);
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
    if(activeList) return activeList.tickers||[];
    return null; // null => mostrar a tabela toda (S&P 500)
  },[activeFilter,myTickers,activeList]);
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
      const cg=searchCryptos(term);        // cripto (local, fiável)
      const pop=searchPopular(term);        // populares europeias/internacionais (local)
      const com=searchCommodities(term);    // commodities/futuros (local) — cacau, ouro, petróleo…
      let stocks=[];
      try{ const r=await searchTickers(term); const have=rows?new Set(rows.filter(x=>x.in_sp500!==false).map(x=>tkNorm(x.symbol))):new Set(); stocks=(r||[]).filter(x=>x.ticker&&!have.has(tkNorm(x.ticker))); }catch{}
      if(cancel) return;
      const seen=new Set(); const merged=[];
      for(const x of [...cg,...pop,...com,...stocks]){ const k=tkNorm(x.ticker); if(k&&!seen.has(k)){ seen.add(k); merged.push(x); } }
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
    } else base=rows.filter(r=>r.in_sp500!==false); // vista principal = só S&P 500
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
  const pillStyle=(on)=>({cursor:"pointer",borderRadius:999,padding:"7px 14px",fontSize:13,fontWeight:on?700:600,transition:"all .15s",whiteSpace:"nowrap",
    border:`1px solid ${on?"rgba(74,222,128,0.55)":"rgba(255,255,255,0.14)"}`,background:on?"rgba(34,197,94,0.20)":"rgba(255,255,255,0.05)",color:on?"#bbf7d0":"#cbd5e1"});
  const miniBtn={cursor:"pointer",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:600,border:"1px solid rgba(255,255,255,0.14)",background:"rgba(255,255,255,0.05)",color:"#cbd5e1"};
  const menuItem={cursor:"pointer",textAlign:"left",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,border:"none",background:"transparent",color:"#e2e8f0",whiteSpace:"nowrap"};
  const Hd=({k,children,align="center"})=>{
    const active=sortKey===k;
    const ai=align==="right"?"flex-end":align==="left"?"flex-start":"center";
    return(
      <span onClick={()=>onSort(k)} className={"athSortHd"+(active?" on":"")}
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
        .athRow{display:grid;grid-template-columns:44px 1fr 116px 96px 110px 110px 92px;gap:10px;align-items:center}
        .athPx{display:contents}            /* desktop: Preço e ATH ocupam 2 pistas reais */
        .athSinceShort{display:none}
        @keyframes athSpin{to{transform:rotate(360deg)}}
        .athSpin{animation:athSpin .8s linear infinite}
        @media(hover:hover){ .athClickable:hover{background:rgba(255,255,255,0.04)} }

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
          .athRow{grid-template-columns:30px 1fr 90px 84px 84px 80px 64px;gap:8px;
            padding-left:14px!important;padding-right:14px!important}
        }

        /* TELEMÓVEL (<=480): 6 pistas — # | Empresa | Marketcap | %abaixo | Preço/ATH | Desde */
        @media(max-width:480px){
          .athRow{grid-template-columns:16px minmax(0,1fr) 56px 60px 52px 38px;gap:6px;
            padding-left:8px!important;padding-right:8px!important}
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

      {authed&&(
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",alignItems:"center",gap:8,marginBottom:12}}>
          {myTickers&&myTickers.length>0&&(
            <button onClick={()=>setActiveFilter(f=>f==="mine"?null:"mine")} title="Mostrar só as minhas ações"
              style={pillStyle(activeFilter==="mine")}>{activeFilter==="mine"?"✓ ":""}Minhas {myTickers.length}</button>
          )}
          {lists.map(l=>(
            <span key={l.id} className="athPillWrap" style={{position:"relative",display:"inline-flex"}}
              onMouseEnter={()=>{ if(canHover.current&&activeFilter===l.id) setMenuFor(l.id); }}
              onMouseLeave={()=>{ if(canHover.current) setMenuFor(f=>f===l.id?null:f); }}
              onTouchStart={()=>{ lpFired.current=false; clearTimeout(lpTimer.current); lpTimer.current=setTimeout(()=>{ if(activeFilter!==l.id) return; lpFired.current=true; setMenuFor(l.id); },480); }}
              onTouchEnd={()=>clearTimeout(lpTimer.current)} onTouchMove={()=>clearTimeout(lpTimer.current)}>
              <button onClick={()=>{ if(lpFired.current){ lpFired.current=false; return; } setActiveFilter(f=>f===l.id?null:l.id); }} title={`Ver "${l.name}"`}
                style={pillStyle(activeFilter===l.id)}>{activeFilter===l.id?"✓ ":""}{l.name}{l.tickers.length?` · ${l.tickers.length}`:""}</button>
              {menuFor===l.id&&activeFilter===l.id&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",zIndex:40,
                  background:"rgba(20,26,42,0.98)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:12,padding:6,
                  display:"flex",flexDirection:"column",gap:2,minWidth:150,boxShadow:"0 10px 30px rgba(0,0,0,0.5)"}}>
                  <button onClick={()=>{ setMenuFor(null); setNameModal({mode:"rename",id:l.id,value:l.name}); }} style={menuItem}>✎ Renomear</button>
                  <button onClick={()=>{ setMenuFor(null); if(typeof window==="undefined"||window.confirm(`Apagar a lista "${l.name}"?`)) deleteList(l.id); }} style={menuItem}>🗑 Apagar</button>
                </div>
              )}
            </span>
          ))}
          {draftName!==null?(
            <input autoFocus value={draftName} onChange={e=>setDraftName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } else if(e.key==="Escape"){ draftCancel.current=true; e.currentTarget.blur(); } }}
              onBlur={()=>{ if(draftCancel.current){ draftCancel.current=false; setDraftName(null); return; } const nm=(draftName||"").trim(); if(nm) createList(nm); setDraftName(null); }}
              placeholder="Nome da lista…"
              style={{borderRadius:999,padding:"6px 14px",fontSize:13,fontWeight:600,width:130,
                border:"1px solid rgba(96,165,250,0.55)",background:"rgba(0,0,0,0.25)",color:"#e2e8f0",outline:"none"}}/>
          ):(
            <button onClick={()=>setDraftName("")} title="Criar nova watchlist"
              style={{cursor:"pointer",background:"none",border:"none",color:"#94a3b8",fontSize:22,lineHeight:1,padding:"2px 8px",fontWeight:400}}>+</button>
          )}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginBottom:14}}>
        <div style={{position:"relative",width:"100%",maxWidth:560}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{position:"absolute",left:16,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input value={q} onChange={e=>{ const v=e.target.value; setQ(v); if(v.trim()) setActiveFilter(null); }} placeholder="Procurar ticker ou empresa…"
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.12)",boxSizing:"border-box",
              borderRadius:16,padding:"12px 16px 12px 44px",fontSize:14,color:"#e2e8f0",outline:"none"}}/>
        </div>
        {authed&&q.trim().length>=2&&(()=>{
          const term=q.trim().toUpperCase();
          const showDirect=/^[A-Z0-9.\-=]{1,12}$/.test(term)&&!globalRes.some(x=>tkNorm(x.ticker)===tkNorm(term));
          if(!globalRes.length&&!showDirect&&!gLoading) return null;
          return(
            <div style={{width:"100%",maxWidth:560,display:"flex",flexDirection:"column",gap:4}}>
              <span style={{fontSize:11,color:"#64748b",textAlign:"center"}}>Adicionar à watchlist</span>
              {globalRes.map((res,i)=>(
                <button key={`${res.ticker}-${i}`}
                  onClick={()=>{ const tk=String(res.ticker||"").toUpperCase(); setLiteQuotes(qq=>({...qq,[tkNorm(tk)]:{...(qq[tkNorm(tk)]||{}),name:res.name||tk}})); openAdd(tk); }}
                  style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",textAlign:"left",borderRadius:10,padding:"8px 10px",
                    border:"1px solid rgba(255,255,255,0.10)",background:"rgba(255,255,255,0.04)",color:"#e2e8f0"}}>
                  <StockLogo ticker={res.ticker} size={24}/>
                  <span style={{minWidth:0,flex:1,display:"flex",flexDirection:"column",lineHeight:1.2}}>
                    <span style={{fontWeight:700,fontSize:13}}>{res.ticker}</span>
                    <span style={{fontSize:11.5,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{res.name}{res.exchange?` · ${res.exchange}`:""}</span>
                  </span>
                  <span style={{color:"#4ade80",fontWeight:800,fontSize:16,flexShrink:0}}>+</span>
                </button>
              ))}
              {showDirect&&(
                <button onClick={()=>addDirect(term)}
                  style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",borderRadius:10,padding:"8px 10px",
                    border:"1px dashed rgba(255,255,255,0.20)",background:"rgba(255,255,255,0.03)",color:"#cbd5e1",fontSize:12.5,fontWeight:600}}>
                  + Adicionar “{term}” diretamente
                </button>
              )}
              {gLoading&&!globalRes.length&&<span style={{fontSize:11,color:"#64748b",textAlign:"center"}}>A procurar…</span>}
            </div>
          );
        })()}
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
            {rows.length===0?"Ainda sem dados — a tabela vai ser preenchida em breve.":"Sem resultados."}
          </div>
        ):(<>{view.slice(0,limit).map((r,i)=>{
          const up=r.down!=null&&r.down>=0;
          const col=r.down==null?"#94a3b8":up?"#4ade80":"#f87171";
          const bg=r.down==null?"transparent":up?"rgba(34,197,94,0.10)":"rgba(248,113,113,0.10)";
          const bd=r.down==null?"rgba(255,255,255,0.12)":up?"rgba(34,197,94,0.35)":"rgba(248,113,113,0.35)";
          return(
            <div key={r.symbol} className={"athRow"+(authed?" athClickable":"")} onClick={authed?()=>openAdd(r.symbol):undefined} title={authed?"Adicionar a uma watchlist":undefined} style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)",cursor:authed?"pointer":"default"}}>
              <span className="athNum" style={{textAlign:"center",fontSize:13,color:"#64748b",fontWeight:700}}>{i+1}</span>
              <span className="athEmp" style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                <StockLogo ticker={r.symbol} size={30}/>
                <span style={{minWidth:0,display:"flex",flexDirection:"column",lineHeight:1.15}}>
                  <span className="athSym" style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.symbol}</span>
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

      {addFor&&(
        <div onClick={()=>setAddFor(null)} style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS,borderRadius:18,padding:18,width:"100%",maxWidth:340,maxHeight:"80vh",overflow:"auto"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <h3 style={{margin:0,fontSize:16,fontWeight:800}}>Adicionar {addFor}</h3>
              <button onClick={()=>setNameModal({mode:"create",value:"Watch list"})} title="Criar nova lista"
                style={{...miniBtn,padding:"2px 12px",fontSize:18,lineHeight:1,fontWeight:400}}>+</button>
            </div>
            {lists.length===0&&<p style={{fontSize:13,color:"#94a3b8",margin:"0 0 10px"}}>Ainda não tens listas. Cria uma com "+".</p>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {lists.map(l=>{
                const sel=addSel.has(l.id);
                return(
                  <button key={l.id} onClick={()=>setAddSel(s=>{ const n=new Set(s); n.has(l.id)?n.delete(l.id):n.add(l.id); return n; })}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,cursor:"pointer",textAlign:"left",
                      borderRadius:10,padding:"10px 12px",fontSize:14,fontWeight:600,
                      border:`1px solid ${sel?"rgba(96,165,250,0.5)":"rgba(255,255,255,0.12)"}`,
                      background:sel?"rgba(59,130,246,0.16)":"rgba(255,255,255,0.04)",color:"#e2e8f0"}}>
                    <span>{l.name}</span><span style={{color:sel?"#4ade80":"#64748b",fontWeight:800,fontSize:16}}>{sel?"✓":"+"}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={applyAdd} disabled={lists.length===0}
              style={{marginTop:12,width:"100%",padding:"11px 12px",borderRadius:10,fontSize:14,fontWeight:700,cursor:lists.length===0?"default":"pointer",
                background:"rgba(34,197,94,0.18)",border:"1px solid rgba(34,197,94,0.4)",color:"#86efac",opacity:lists.length===0?0.5:1}}>Guardar</button>
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
function CompetitionTimer({settings}){
  const [now,setNow]=useState(null);
  useEffect(()=>{
    setNow(Date.now());
    const id=setInterval(()=>setNow(Date.now()),60_000);
    return()=>clearInterval(id);
  },[]);
  if(!settings||now==null) return null;
  const started=settings.competitionStarted;
  const targetStr=started?settings.gameEndDate:settings.gameStartDate;
  if(!targetStr) return null;
  const target=new Date(targetStr).getTime();
  if(isNaN(target)) return null;
  const diff=target-now;
  if(diff<=0) return null;
  const d=Math.ceil(diff/86400000);
  const cd=d===1?"1 dia":`${d} dias`;
  const accent=started?"#fbbf24":"#fcd34d";
  const label=started?`🏆 Vencedor a ${fmtDateShort(settings.gameEndDate)}`:"";
  return(
    <div style={{display:"flex",justifyContent:"center"}}>
      <style>{`@keyframes cdtPulse{0%,100%{transform:scale(1);opacity:0.92}50%{transform:scale(1.04);opacity:1}}`}</style>
      <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:10,flexWrap:"wrap",
        maxWidth:"100%",padding:"8px 16px",borderRadius:999,textAlign:"center",animation:"cdtPulse 2.4s ease-in-out infinite",
        background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",
        border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"}}>
        {label&&<span style={{fontSize:13,color:"#cbd5e1",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>}
        <span style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:accent,whiteSpace:"nowrap"}}>faltam {cd}</span>
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
  if(r.page==="detail"&&r.detailSlug) return `/p/${r.detailSlug}`;
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
  const [myName,setMyName]=useState(null);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [livePrices,setLivePrices]=useState({});
  const [dayChange,setDayChange]=useState({}); // variação do dia por ticker
  const [pricesLoading,setPricesLoading]=useState(false);
  const [detailSlug,setDetailSlug]=useState(null);
  const [duelSlugs,setDuelSlugs]=useState(null); // [slugA, slugB] para o duelo 1v1
  const [toast,setToast]=useState(null);

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
  const nav=useCallback((p)=>goRoute({page:p}),[goRoute]);
  const openDetail=useCallback((k)=>goRoute({page:"detail",detailSlug:slugForKey(k)}),[goRoute,slugForKey]);
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
  useEffect(()=>{ if(typeof window!=="undefined") window.scrollTo(0,0); },[page,detailSlug,duelSlugs]);

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

  const sh=(children)=><Shell page={page} detailRank={detailRank} detailIsOwn={detailIsOwn} nav={nav} submitted={submitted} toast={toast}
    onMyPortfolio={openMyPortfolio}
    myPortfolioActive={page==="detail" && !!detailPf && !!myPf && detailPf.key===myPf.key}>{children}</Shell>;

  if(page==="home")   return sh(<Home nav={nav} submitted={submitted} count={portfolios.length} settings={settings} ranking={ranking} livePrices={livePrices} onMyPortfolio={openMyPortfolio}/>);
  if(page==="create") return sh(submitted?<AlreadySubmitted nav={nav} name={myName}/>:<Create settings={settings} doSubmit={doSubmit} onDone={()=>nav("ranking")} showToast={showToast}/>);
  if(page==="confirm")return sh(<Confirm nav={nav} name={myName}/>);
  if(page==="ath")    return sh(<ATH myTickers={submitted&&myPf?(myPf.stocks||[]).map(s=>s.ticker):null} auth={submitted&&myName?{name:myName,pin:sget(K.MYPIN)}:null} showToast={showToast}/>);
  if(page==="ranking")return sh(submitted?<Ranking ranking={ranking} myNorm={norm(myName)} pricesLoading={pricesLoading} spy={spy} preLaunch={isPreLaunch(settings)} settings={settings} onSelect={openDetail} onCompare={openDuel}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="duel")   return sh(submitted?<Duel a={findBySlug(ranking,duelSlugs?.[0])} b={findBySlug(ranking,duelSlugs?.[1])} livePrices={livePrices} spy={spy} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="detail") return sh(submitted?<Detail pf={detailPf} rank={detailRank} livePrices={livePrices} dayChange={dayChange} spy={spy} nav={nav} myNorm={norm(myName)} preLaunch={isPreLaunch(settings)} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""} reload={load} showToast={showToast}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="admin")  return sh(<Admin settings={settings} setSettings={setSettings} portfolios={portfolios} ranking={ranking} livePrices={livePrices} reload={load} showToast={showToast}/>);
  return null;
}

/* ---- Shell --------------------------------------------------------------- */
function Shell({children,page,detailRank,detailIsOwn,nav,submitted,toast,onMyPortfolio,myPortfolioActive}){
  // Premium (ouro/prata/bronze) SÓ no detalhe do Top 3. Tudo o resto — ranking, 4º+,
  // o próprio portefólio (quando fora do pódio), homepage, etc. — fica AZUL original.
  // Mesma lógica de degradê (brilho radial no topo + fade vertical).
  const GOLD={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(250,204,21,0.32) 0%, rgba(245,158,11,0.13) 38%, transparent 72%), linear-gradient(180deg,#261c0a 0%,#1c150b 55%,#120d08 80%,#0c0905 100%)",color:"#0c0905",tint:"rgba(250,204,21,0.16)"};
  const SILVER={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(226,232,240,0.16) 0%, rgba(203,213,225,0.06) 38%, transparent 72%), linear-gradient(180deg,#1e222a 0%,#171b22 55%,#0f1216 80%,#0a0c0f 100%)",color:"#0a0c0f",tint:"rgba(203,213,225,0.15)"};
  const BRONZE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(217,119,6,0.26) 0%, rgba(180,83,9,0.10) 38%, transparent 72%), linear-gradient(180deg,#241608 0%,#1b1109 55%,#120c07 80%,#0c0805 100%)",color:"#0c0805",tint:"rgba(217,119,6,0.18)"};
  const BLUE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",color:"#070d1c",tint:"rgba(59,130,246,0.16)"};
  // TESTE: azul-petróleo/teal (referência) — só no ranking.
  const BLUE_REF={bg:"radial-gradient(1600px 1000px at 50% -6%, rgba(64,170,205,0.20) 0%, rgba(44,130,170,0.07) 40%, transparent 72%), linear-gradient(180deg,#16526a 0%,#123f52 50%,#0d2d3c 78%,#091e29 100%)",color:"#091e29",tint:"rgba(64,170,205,0.17)"};
  // ATH: brilho lavanda no canto superior direito + toque roxo à direita, azul-marinho a escurecer para quase preto.
  const ATHBG={bg:"radial-gradient(1500px 1150px at 82% -2%, rgba(210,208,230,0.42) 0%, rgba(150,150,192,0.16) 30%, transparent 58%), radial-gradient(1200px 1000px at 104% 30%, rgba(120,96,152,0.26) 0%, transparent 56%), radial-gradient(1300px 1000px at 20% 14%, rgba(86,104,168,0.18) 0%, transparent 60%), linear-gradient(165deg,#1e2540 0%,#151b2f 44%,#0a0e1c 78%,#060810 100%)",color:"#060810",tint:"rgba(170,158,214,0.18)"};
  // Pódio → ouro/prata/bronze. Ranking + detalhe de OUTROS (4º+/em espera) → azul
  // petróleo novo. O PRÓPRIO portefólio (fora do pódio) e a homepage → azul original.
  const medal=page==="detail"?(detailRank===1?GOLD:detailRank===2?SILVER:detailRank===3?BRONZE:null):null;
  const theme=medal
    ||(page==="ath"?ATHBG
      :(page==="ranking"||page==="duel")?BLUE_REF
      :(page==="detail"&&!detailIsOwn?BLUE_REF:BLUE));
  return(
    <div style={{minHeight:"100vh",position:"relative",
      backgroundColor:theme.color,transition:"background-color .6s ease",
      color:"#e2e8f0",fontFamily:"var(--font-app), system-ui, -apple-system, sans-serif",overflowX:"hidden"}}>
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
      <header style={{position:"sticky",top:0,zIndex:50,padding:"12px 14px"}}>
        <Nav page={page} nav={nav} submitted={submitted} onMyPortfolio={onMyPortfolio} myPortfolioActive={myPortfolioActive} tint={theme.tint} />
        <div className="cdiClock"><MarketStatus/></div>
      </header>
      <main className="cdiMain" style={{position:"relative",zIndex:1}}>{children}</main>
      <BackToTop maxWidth={page==="ranking"?900:page==="detail"?1320:null}/>
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
function Nav({page,nav,submitted,onMyPortfolio,myPortfolioActive,tint}){
  return(
    <div className="cdiNav" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap","--nav-tint":tint}}>
      <NavLink label="Início" active={page==="home"} onClick={()=>nav("home")}/>
      <NavLink label="Ranking" active={page==="ranking"} onClick={()=>nav("ranking")} locked={!submitted}/>
      <NavLink label="ATH" active={page==="ath"} onClick={()=>nav("ath")}/>
      {submitted
        ? <NavLink label="Minhas 8" active={myPortfolioActive} onClick={onMyPortfolio}/>
        : <NavLink label={<>Criar<span className="navWide"> Portefólio</span></>} active={page==="create"} onClick={()=>nav("create")}/>}
    </div>
  );
}
// Plain text link; only the page we're on gets the liquid-glass pill.
function NavLink({label,active,onClick,locked}){
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
      <div style={{marginBottom:18}}>
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

function MiniSparkline({series,current,height=48}){
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
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={isEx?undefined:"winSpark"} style={{width:"100%",height,display:"block",opacity:isEx?0.55:undefined}}>
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

function Home({nav,submitted,count,settings,ranking,livePrices,onMyPortfolio}){
  return(
    <div>
      {/* Hero */}
      <section style={{textAlign:"center",padding:"100px 24px 80px",maxWidth:780,margin:"0 auto"}}>
        <span style={{position:"relative",display:"inline-block",margin:"0 auto 32px"}}>
          <BreatheGlow color="rgba(245,200,80,0.5)" mid="rgba(245,158,11,0.16)" inset="-34% -16%" base={0.4} duration={9000}/>
          <span style={{position:"relative",zIndex:1,display:"inline-block"}}>
            <GoldGlow src="/logo.png" alt="Conversas de Investidores" maskSrc="/logo.png" glow={20}
              wrapStyle={{display:"block"}}
              imgStyle={{width:"clamp(120px,18vw,180px)",height:"auto"}}/>
          </span>
        </span>
        <h1 style={{fontSize:"clamp(40px,6vw,72px)",fontWeight:800,lineHeight:1.1,letterSpacing:"-2px",margin:"0 0 24px"}}>
          Conversas de{" "}
          <span style={{color:"#22c55e"}}>Investidores</span>
        </h1>
        <div style={{display:"inline-flex",alignItems:"center",gap:10,maxWidth:"min(92vw,460px)",
          background:"rgba(34,197,94,0.10)",border:"1px solid rgba(34,197,94,0.25)",borderRadius:16,
          padding:"11px 18px",marginBottom:24,boxShadow:"0 4px 18px rgba(0,0,0,0.18)"}}>
          <span style={{fontSize:"clamp(12px,3.4vw,14px)",lineHeight:1.45,color:"#4ade80",fontWeight:600,textAlign:"center"}}>
            {isPreLaunch(settings)?<>Submissões abertas até 30 de junho<br/>começa 1 de julho</>:`Jogo ativo — Submissões ${settings?.submissionsOpen?"abertas":"fechadas"}`}
          </span>
        </div>
        <div style={{marginBottom:28}}><CompetitionTimer settings={settings}/></div>
        <p style={{fontSize:18,color:"#6b7280",lineHeight:1.6,maxWidth:560,margin:"0 auto 40px"}}>
          O jogo de portefólios da nossa comunidade. Escolhe as tuas 8 ações,
          submete o teu portefólio e compete com os outros membros pelo melhor retorno.
        </p>
        <style>{`@media(max-width:520px){.heroBtns{flex-wrap:nowrap;gap:8px;align-items:stretch}.heroBtns>button{flex:1;min-width:0;padding:9px 8px;font-size:12.5px;line-height:1.2;white-space:normal}}`}</style>
        <div className="heroBtns" style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          {submitted?(
            <>
              <Btn onClick={()=>nav("ranking")} primary>Ver Ranking</Btn>
              <Btn onClick={onMyPortfolio}>O meu portefólio</Btn>
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
          <WinnersGrid top={ranking.filter(p=>Number.isFinite(p.total)).slice(0,5)} livePrices={livePrices} nav={nav}/>
        </section>
      )}

      {/* Como funciona */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <h2 style={{textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:40}}>Como funciona</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {n:"01",icon:"✏️",t:"Insere o teu nome",d:"Usa exatamente o mesmo nome que tens no grupo de Telegram da comunidade."},
            {n:"02",icon:"🔍",t:"Escolhe 8 ações",d:"Pesquisa por ticker ou nome da empresa. Tens de selecionar exatamente 8 ações."},
            {n:"03",icon:"🚀",t:"Submete o portefólio",d:"Depois da submissão ficas inscrito; os portefólios dos outros só ficam visíveis quando a competição arranca."},
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
              "Não vês os portefólios dos outros até a competição começar, a 1 de julho de 2026",
              "Depois de submetido, o portefólio fica bloqueado",
              "As posições arrancam ao preço de abertura do mercado de 1 de julho",
              "A rentabilidade é calculada como a média das 8 ações",
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
      <button onClick={()=>nav("home")} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:20,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Voltar ao início
      </button>
      <div style={{textAlign:"center",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Área bloqueada</h1>
        <p style={{fontSize:14,color:"#94a3b8",marginBottom:28,lineHeight:1.6}}>
          Submete o teu portefólio de 8 ações para entrares no jogo.<br/>
          Os portefólios dos outros membros só ficam visíveis quando a competição começar,<br/>
          a 1 de julho de 2026.
        </p>
        <Btn onClick={()=>nav("create")} primary>Criar o meu portefólio</Btn>

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
const RACE_COLORS=["#4ade80","#38bdf8","#fbbf24","#f472b6","#a78bfa","#fb923c","#2dd4bf","#facc15","#22d3ee","#fca5a5"];
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
function SeasonRace({ranking,preLaunch,myNorm,competitionStarted,gameStartDate}){
  const [snaps,setSnaps]=useState(null);
  const [mounted,setMounted]=useState(false);
  const [hi,setHi]=useState(null); // portefólio em destaque (hover no nome ou na linha)
  useEffect(()=>{ setMounted(true); },[]);
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

  const data=useMemo(()=>{
    if(!snaps) return null;
    const nameById={}; shown.forEach(p=>{ nameById[p.id]=p.name; });
    // Arranque real de cada linha: 1 jul (jogo oficial) ou a submissão (demos).
    // t0 = o mais antigo → todas começam JUNTAS a 0% (pedido do utilizador).
    const baseOf=()=> (competitionStarted&&gameStartDate)?`${String(gameStartDate).slice(0,10)}T00:00:00.000Z`:null;
    const bases=shown.map(p=>baseOf()||p.submittedAt).filter(Boolean).sort();
    const t0=bases[0]||null;
    const byT={};
    for(const s of snaps){
      const nm=nameById[s.portfolio_id]; if(!nm) continue;
      const t=s.captured_at; if(!t||!isMktOpen(t)) continue;   // ignora mercado fechado
      if(t0&&t<t0) continue;                                    // ignora antes do arranque
      // VALOR REAL (rentabilidade desde a submissão) — igual ao ranking. SEM rebase.
      (byT[t]=byT[t]||{t})[nm]=Number(s.total_return)*100;
    }
    // ponto de agora (ao vivo) — também igual ao ranking (p.total).
    const now=new Date().toISOString();
    const nowRow=byT[now]||{t:now};
    shown.forEach(p=>{ if(Number.isFinite(p.total)) nowRow[p.name]=p.total*100; });
    byT[now]=nowRow;
    // âncora a 0% no arranque comum (todas começam juntas).
    if(t0){
      const a=byT[t0]||{t:t0};
      shown.forEach(p=>{ if(!Number.isFinite(a[p.name])) a[p.name]=0; });
      byT[t0]=a;
    }
    return Object.values(byT).sort((a,b)=>a.t<b.t?-1:1);
  },[snaps,shown,competitionStarted,gameStartDate]);

  if(!shown.length) return null;
  const enoughData=data&&data.length>=2;
  // Domínio Y com folga moderada (não deixar auto-escalar até -8%; chega a ~-6% no caso atual).
  const allVals=enoughData?data.flatMap(r=>shown.map(p=>r[p.name])).filter(Number.isFinite):[];
  const yLo=Math.min(0,...allVals,0), yHi=Math.max(0,...allVals,0);
  const ySpan=Math.max(yHi-yLo,1);
  const raceYMin=Math.floor(yLo-Math.min(Math.max(ySpan*0.25,0.8),1.5));
  const raceYMax=Math.ceil(yHi+Math.min(Math.max(ySpan*0.12,0.4),1.5));

  return(
    <div style={{...{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"},borderRadius:16,padding:"20px 16px 12px",marginTop:24}}>
      <p style={{fontSize:12,color:"#94a3b8",margin:"0 0 12px",textAlign:"center"}}>
        {preLaunch?"Pré-visualização com os portefólios demo. A partir de 1 de julho mostrará o Top 10 oficial":"Top 10 — rentabilidade ao longo da competição"}
      </p>
      {!mounted?(
        <div style={{height:300}}/>
      ):!enoughData?(
        <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#4b5563",textAlign:"center"}}>
          Ainda sem histórico suficiente — o gráfico preenche-se a partir dos próximos dias.
        </div>
      ):(
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
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
                  dot={false} connectNulls isAnimationActive={false}
                  activeDot={hi===p.name?{r:4}:(p._me?{r:3.5}:false)}
                  label={hi===p.name?(lp)=>{
                    if(!lp||lp.value==null||lp.index!==data.length-1) return null;
                    return(<text key="rl" x={lp.x} y={lp.y-9} textAnchor="end"
                      fill={raceColorOf(p,i)} fontSize={12.5} fontWeight={700} fontFamily="ui-monospace, monospace"
                      style={{paintOrder:"stroke",stroke:"rgba(8,15,32,0.9)",strokeWidth:3,strokeLinejoin:"round"}}>
                      {lp.value>=0?"+":""}{Number(lp.value).toFixed(2)}%
                    </text>);
                  }:false}/>
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}
      {mounted&&enoughData&&(
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"6px 16px",marginTop:14,padding:"0 4px"}}>
          {shown.map((p,i)=>{
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
          })}
        </div>
      )}
    </div>
  );
}

/* ---- Ranking ------------------------------------------------------------- */
// ⓘ com tooltip — hover (desktop) e toque (mobile). O popover abre PARA BAIXO
// para não ser cortado pelo overflow:hidden do cartão.
function InfoTip({text}){
  const [open,setOpen]=useState(false);
  return(
    <span style={{position:"relative",display:"inline-flex",verticalAlign:"middle"}}
      onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
      <span onClick={e=>{e.stopPropagation();setOpen(o=>!o);}}
        style={{display:"inline-flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,
          width:14,height:14,borderRadius:"50%",border:"1px solid currentColor",fontSize:9,lineHeight:1,fontWeight:700,opacity:0.65}}>i</span>
      {open&&(
        <span onClick={e=>e.stopPropagation()} style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:100,width:230,
          background:"rgba(8,15,32,0.97)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"9px 12px",
          fontSize:11.5,lineHeight:1.45,color:"#cbd5e1",fontWeight:400,textTransform:"none",letterSpacing:"normal",whiteSpace:"normal",textAlign:"left",
          boxShadow:"0 10px 28px rgba(0,0,0,0.5)"}}>
          {text}
        </span>
      )}
    </span>
  );
}
function Ranking({ranking,myNorm,pricesLoading,spy,preLaunch,settings,onSelect,onCompare}){
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
  const tableFor=(list)=>(
    <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
      <div className="rkRow" style={{padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",
        fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
        <span style={{textAlign:"center"}}>#</span><span>Membro</span>
        <span className="rkSpark"></span>
        <span style={{textAlign:"right"}}>Rentab.</span>
        <span style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4}}>Alpha<InfoTip text="A tua rentabilidade menos a do S&P 500 no mesmo período (positivo = bates o mercado)."/></span>
        <span style={{textAlign:"center"}}>🟢/🔴</span>
        <span className="rkHide" style={{textAlign:"right"}}>Submissão</span>
      </div>
      {list.map((p,i)=>{
        const me=p.normName===myNorm;
        const spyRet=spy?spy.returnFor(p):null;
        const alpha=spyRet==null?null:p.total-spyRet;
        const picked=cmp&&sel.includes(p.key);
        // Top 3: ouro (1º, amarelo vivo) / prata (2º) / bronze-âmbar (3º). 4º-10º: cor geral.
        const rr=i<3?[
          {bg:"rgba(250,204,21,0.12)",hov:"rgba(250,204,21,0.18)",bar:"#facc15"},
          {bg:"rgba(241,245,249,0.12)",hov:"rgba(241,245,249,0.18)",bar:"#e2e8f0"},
          {bg:"rgba(245,158,11,0.11)",hov:"rgba(245,158,11,0.17)",bar:"#d97706"},
        ][i]:null;
        // Top 3: sem fundo em repouso (só a barra lateral); o glow da cor aparece no hover.
        const baseBg=picked?"rgba(59,130,246,0.16)":me?"rgba(34,197,94,0.04)":"transparent";
        const hoverBg=picked?baseBg:rr?rr.hov:me?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.05)";
        return(
          <div key={p.key} className="rkRow" onClick={()=>cmp?toggleSel(p.key):onSelect(p.key)}
            style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",cursor:"pointer",
              background:baseBg,boxShadow:picked?"inset 3px 0 0 #3b82f6":rr?`inset 3px 0 0 ${rr.bar}`:"none",transition:"background 0.15s"}}
            onMouseEnter={e=>{ if(!picked) e.currentTarget.style.background=hoverBg; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=baseBg; }}>
            <span style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              {i<3
                ? <span className="rankShine rankBreathe" style={{width:22,height:22,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0,...RANK_BADGE[i+1],"--shine-delay":`${i*1.2}s`}}>{i+1}</span>
                : <span style={{fontSize:13,color:"#94a3b8",fontWeight:700}}>{i+1}</span>}
            </span>
            <span style={{fontWeight:600,fontSize:"clamp(11.5px,3.1vw,15px)",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{overflowWrap:"anywhere",lineHeight:1.2}}>{p.name}</span>
              {me&&<span style={{fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",borderRadius:999,padding:"2px 8px",fontWeight:700,flexShrink:0}}>Tu</span>}
            </span>
            <span className="rkSpark">
              <MiniSparkline series={seriesById[p.id]||[]} current={p.total} height={24}/>
            </span>
            <span style={{textAlign:"right",alignSelf:"center",fontWeight:800,fontFamily:"monospace",fontSize:15,color:p.total>=0?"#4ade80":"#f87171"}}><Rolling text={pct(p.total)}/></span>
            <span style={{textAlign:"right",alignSelf:"center",fontFamily:"monospace",fontSize:13,fontWeight:600,
              color:alpha==null?"#4b5563":alpha>=0?"#4ade80":"#f87171"}}>{alpha==null?"—":<Rolling text={`${alpha>=0?"+":""}${(alpha*100).toFixed(2)}%`}/>}</span>
            <span style={{textAlign:"center",alignSelf:"center",fontFamily:"monospace",fontSize:14,fontWeight:700}}>
              <span style={{color:"#4ade80"}}>{p.pos}</span><span style={{color:"#94a3b8"}}>/</span><span style={{color:"#f87171"}}>{p.neg}</span>
            </span>
            <span className="rkHide" style={{textAlign:"right",alignSelf:"center",fontSize:12,color:"#94a3b8"}}>{dt(p.submittedAt)}</span>
          </div>
        );
      })}
    </div>
  );
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
              <span style={{overflowWrap:"anywhere",lineHeight:1.2}}>{p.name}</span>
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
  return(
    <div style={{maxWidth:900,margin:"0 auto",padding:"40px 20px 120px"}}>
      <style>{`
        .rkRow{display:grid;grid-template-columns:40px 190px 1fr 100px 100px 92px 110px;gap:8px}
        .rkSpark{display:flex;align-items:center;align-self:center;height:24px;overflow:hidden;min-width:0}
        @media(max-width:860px){
          .rkRow{grid-template-columns:40px 1fr 100px 100px 92px 110px}
          .rkSpark{display:none}
        }
        @media(max-width:640px){
          .rkRow{grid-template-columns:26px 1fr 64px 64px 56px;gap:6px}
          .rkHide{display:none}
        }
      `}</style>
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
      <p style={{color:"#94a3b8",fontSize:14,marginBottom:28}}>
        Classificação por rentabilidade total, em tempo real · {ranking.length} {ranking.length===1?"participante":"participantes"}.
        {pricesLoading?" · A atualizar preços…":""}
      </p>

      {ranking.length===0?(
        <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
          Ainda não há portefólios submetidos.
        </div>
      ):(
        <>
          {demos.length>0&&(
            <div style={{marginBottom:32}}>
              {sectionTitle("Demo")}
              <GlowBehind>{tableFor(demos)}</GlowBehind>
              <GlowBehind><SeasonRace ranking={ranking} preLaunch={preLaunch} myNorm={myNorm} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""}/></GlowBehind>
            </div>
          )}
          <div>
            <div style={{margin:"0 0 12px"}}>
              <h2 style={{fontSize:18,fontWeight:800,letterSpacing:"-0.3px",margin:"0 0 8px",textAlign:"center"}}>Oficial</h2>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <span style={{flex:1,minWidth:0,fontSize:12,fontWeight:700,lineHeight:1.4,color:preLaunch?"#fbbf24":"#4ade80"}}>{preLaunch?"em espera · começa 1 de julho":"a decorrer"}</span>
                <div style={{flexShrink:0}}><CompetitionTimer settings={settings}/></div>
              </div>
            </div>
            {officials.length>0
              ? (preLaunch?pendingList([...officials].sort((a,b)=>String(b.submittedAt||"").localeCompare(String(a.submittedAt||"")))):<GlowBehind>{tableFor(officials)}</GlowBehind>)
              : <div style={{background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)",borderRadius:16,
                  padding:40,textAlign:"center",color:"#64748b",fontSize:14}}>
                  Ainda sem inscrições. Os portefólios submetidos a partir de agora entram aqui — admissão oficial a 1 de julho.
                </div>}
          </div>
        </>
      )}
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
  const v=payload[0]?.value;
  if(v==null) return null;
  return(
    <div style={{background:"rgba(8,15,32,0.95)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"6px 10px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.45)"}}>
      <span style={{color:"#94a3b8"}}>{raceFull(label)}</span>
      {" · "}
      <span style={{fontFamily:"monospace",fontWeight:700,color:v>=0?"#4ade80":"#f87171"}}>{v>=0?"+":""}{Number(v).toFixed(2)}%</span>
    </div>
  );
}
function EvolutionChart({portfolioId,currentReturn,submittedAt,competitionStarted,gameStartDate}){
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
  const data=Object.entries(byT).map(([t,r])=>({t,r})).sort((a,b)=>a.t<b.t?-1:1);
  const enough=data.length>=2;
  const last=enough?data[data.length-1].r:0;
  const col=last>=0?"#4ade80":"#f87171";
  // Domínio do Y com FOLGA (para a linha não parecer que foi à falência):
  // margem generosa por baixo do ponto mais baixo + um pouco acima do 0%.
  const vals=data.map(d=>d.r).filter(Number.isFinite);
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
            <XAxis dataKey="t" tickFormatter={raceTick} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
            <YAxis domain={[yMin,yMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            <Tooltip content={<EvoTooltip/>}/>
            <Line type="monotone" dataKey="r" stroke={col} strokeWidth={2.4} dot={false} isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
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
function Detail({pf,rank,livePrices,dayChange,spy,nav,myNorm,preLaunch,competitionStarted,gameStartDate,reload,showToast}){
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
      {rail.active&&<LeftBackRail gap={rail.gap} onBack={()=>nav("ranking")}/>}
      {rank===1&&<Confetti key={pf.key} intense={!!myNorm && pf.normName===myNorm}/>}
      <style>{`.cdiDetail{display:grid;gap:16px;grid-template-columns:1fr}@media(min-width:1000px){.cdiDetail{grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);align-items:start}}`}</style>
      {!rail.active&&(
      <button onClick={()=>nav("ranking")} className="backLink"
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
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:14,marginBottom:16,minWidth:0}}>
            {rank>0&&(rank<=3
              ? <span className="rankShine rankBreathe" style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:20,fontWeight:800,...RANK_BADGE[rank],"--shine-delay":`${(rank-1)*1.2}s`}}>{rank}</span>
              : <span style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,fontWeight:800,color:"#94a3b8",border:"2px solid rgba(255,255,255,0.12)"}}>{rank}</span>
            )}
            <h1 style={{fontSize:"clamp(22px,5vw,26px)",fontWeight:800,letterSpacing:"-0.5px",margin:0,minWidth:0,lineHeight:1.2,overflowWrap:"anywhere"}}>{pf.name}</h1>
          </div>
          <div style={{fontSize:"clamp(34px,9vw,42px)",fontWeight:800,fontFamily:"monospace",lineHeight:1,
            color:st.total>=0?"#4ade80":"#f87171"}}>{st.total>=0?"▲":"▼"} <Rolling text={pct(Math.abs(st.total)).replace(/[+-]/,"")}/></div>
          <div style={{fontSize:11,color:"#94a3b8",marginTop:6,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rentabilidade média</div>
          <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",gap:"10px 24px",marginTop:18,fontSize:13,color:"#94a3b8"}}>
            <span style={{color:"#4ade80"}}>▲ {st.pos} positivas</span>
            <span style={{color:"#f87171"}}>▼ {st.neg} negativas</span>
            {alpha!=null&&(
              <span title="A tua rentabilidade menos a do S&P 500 no mesmo período">
                Alpha: <strong style={{color:alpha>=0?"#4ade80":"#f87171"}}><Rolling text={`${alpha>=0?"+":""}${(alpha*100).toFixed(2)}%`}/></strong>
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
            title="Clica para alternar entre 'Desde submissão' e 'Diário'"
            style={{textAlign:"center",cursor:"pointer",userSelect:"none",lineHeight:1.2,display:"block"}}>
            {retMode==="day"?"Diário":"Desde submissão"}
            <span style={{fontSize:9,opacity:0.85,marginLeft:4}}>▾</span>
          </span>
        </div>
        {bySorted.map(s=>(
          <div key={s.ticker} className="stockRow" style={{display:"grid",gridTemplateColumns:"1.6fr 1fr 1fr 1.4fr",alignItems:"center",gap:4,padding:"14px 20px",borderBottom:`1px solid ${divider}`}}>
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
              if(v==null) return <span onClick={toggle} title="Alternar Desde submissão / Diário" style={{...base,color:"#4b5563"}}>—</span>;
              return(
                <span onClick={toggle} title="Alternar Desde submissão / Diário"
                  style={{...base,color:v>=0?"#4ade80":"#f87171"}}>
                  {v>=0?"▲":"▼"} {pct(Math.abs(v)).replace(/[+-]/,"")}
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
          <EvolutionChart portfolioId={pf.id} currentReturn={st.total} submittedAt={pf.submittedAt} competitionStarted={competitionStarted} gameStartDate={gameStartDate}/>
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
      <span style={{color:col,fontSize:9,fontWeight:800,width:9,textAlign:"center",flexShrink:0}}>{up?"▲":"▼"}</span>
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
function Duel({a,b,livePrices,spy,nav}){
  if(!a||!b) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Duelo inválido. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  const sa=pfStats(a,livePrices), sb=pfStats(b,livePrices);
  const ra=a.stocks.map(s=>({...s,ret:stockRet(s,livePrices)}));
  const rb=b.stocks.map(s=>({...s,ret:stockRet(s,livePrices)}));
  const alphaA=spy?a.total-spy.returnFor(a):null, alphaB=spy?b.total-spy.returnFor(b):null;
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
        {alphaA!=null&&alphaB!=null&&<DuelMetric label="Alpha" a={alphaA} b={alphaB} better="high" fmt={pct}/>}
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
        const sample=(data.sample||[]).map(s=>`${s.ticker} ${s.close??"—"}`).join(", ");
        showToast(`Pré-visualização: ${data.tickers} tickers (fecho ${data.usedClose}, vivo ${data.usedLive}, sem ${data.missing}). ${sample}`);
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
        transition:"background .15s, border-color .15s, transform .12s"}}
      onMouseEnter={e=>{ if(primary) e.currentTarget.style.background="#16a34a"; else e.currentTarget.style.borderColor="#6b7280"; e.currentTarget.style.transform="translateY(-1px)"; }}
      onMouseLeave={e=>{ if(primary) e.currentTarget.style.background="#22c55e"; else e.currentTarget.style.borderColor="#374151"; e.currentTarget.style.transform="none"; }}
      onMouseDown={e=>{ e.currentTarget.style.transform="scale(0.97)"; }}
      onMouseUp={e=>{ e.currentTarget.style.transform="translateY(-1px)"; }}>
      {children}
    </button>
  );
}

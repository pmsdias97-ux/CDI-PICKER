// Módulo "ranking" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { buildPeriodSparklineSeries } from "../lib/ranking-sparkline.mjs";
import { COIN_DR, COIN_DRX, COIN_DX, COIN_SET, LAUREL_LEAVES, MARKET_HOLIDAYS_US, PODIUM_TONE, RANK_BADGE, WEEK_LIVE_FROM, WEEK_SEED_CHAMPS, compWeekKey, curPrice, lastDayLabel, monthCloseBase, monthTradingDone, nextPeriod, nextWeek, norm, pct, periodLabel, pfDayRet, pfMonthRet, pfPeriodRet, pfWeekRet, rSign, stockRet, timeAgo, useIsoLayoutEffect, weekFriday, weekLabel, weekTradingDone } from "../lib/core";
import { GlowBehind, GoldGlow, HoverName, InfoTip, MiniSparkline, Rolling, Skeleton, StockLogo, Tri } from "./ui";
import { SeasonRace } from "./race";
import { CompetitionTimer } from "./home";

export function PodiumLaurel({rank,hi,lo}){
  const gid="rkLau"+rank;
  const branch=(
    <g>
      <path d={LAUREL_LEAVES.stem} fill="none" stroke={`url(#${gid})`} strokeWidth="2.6" strokeLinecap="round"/>
      {LAUREL_LEAVES.leaves.map((l,i)=>(
        <path key={i} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.r.toFixed(1)}) scale(${l.sz.toFixed(2)})`}
          d="M0 0 C6 -7 20 -7 26 0 C20 7 6 7 0 0 Z" fill={`url(#${gid})`}/>
      ))}
    </g>
  );
  return(
    <svg className="rkPodLaurel" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={hi}/><stop offset="1" stopColor={lo}/></linearGradient></defs>
      <g transform="translate(-18 0)">{branch}</g>
      <g transform="translate(218 0) scale(-1 1)">{branch}</g>
    </svg>
  );
}

export function CoinStack({rank}){
  const C=COIN_SET[rank], T=19, RY=15, topCy=RY+2, n=C.n;
  const baseCy=topCy+n*T, H=baseCy+RY+6; // sem prato: as moedas continuam por trás da tabela
  const gS="cs"+rank, gT="ct"+rank, gF="cf"+rank, gA="ca"+rank;
  const coins=[];
  for(let k=0;k<n;k++){ // k=0 → moeda de baixo
    const cy=baseCy-(k+1)*T, cx=150+COIN_DX[k%11], rx=C.rx+COIN_DRX[k%11], top=k===n-1;
    const side=`M${cx-rx} ${cy} L${cx-rx} ${cy+T} A${rx} ${RY} 0 0 0 ${cx+rx} ${cy+T} L${cx+rx} ${cy} Z`;
    coins.push(
      <g key={k} transform={`rotate(${COIN_DR[k%11]} ${cx} ${cy})`}>
        <path d={side} fill={`url(#${gS})`}/>
        <path d={side} fill="url(#coinMill)"/>
        <path d={side} fill={`url(#${gA})`}/>
        {/* aro inferior: sombra + brilho biselado — recortados ao contorno da moeda e a seguir a mesma curva (sem "caudas" fora dela) */}
        <clipPath id={`cc${rank}-${k}`}><path d={side}/></clipPath>
        <g clipPath={`url(#cc${rank}-${k})`}>
          <path d={`M${cx-rx} ${cy+T} A${rx} ${RY} 0 0 0 ${cx+rx} ${cy+T}`} fill="none" stroke={C.dark} strokeOpacity="0.8" strokeWidth="3.6"/>
          <path d={`M${cx-rx} ${cy+T} A${rx} ${RY} 0 0 0 ${cx+rx} ${cy+T}`} fill="none" stroke={C.rim} strokeOpacity="0.5" strokeWidth="1.2" transform="translate(0 -3.4)"/>
        </g>
        {/* face superior */}
        <ellipse cx={cx} cy={cy} rx={rx} ry={RY} fill={`url(#${gT})`} stroke={C.rim} strokeOpacity="0.8" strokeWidth="1.2"/>
        <ellipse cx={cx} cy={cy} rx={rx-8} ry={RY-3.4} fill={`url(#${gF})`} stroke={C.dark} strokeOpacity="0.45" strokeWidth="1"/>
        <ellipse cx={cx} cy={cy+0.6} rx={rx-8} ry={RY-3.4} fill="none" stroke={C.rim} strokeOpacity="0.35" strokeWidth="0.8" transform={`translate(0 1)`}/>
        {top&&<ellipse cx={cx} cy={cy} rx={(rx-8)*0.7} ry={(RY-3.4)*0.62} fill="none" stroke={C.rim} strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="1.6 3.2"/>}
        {/* brilho especular no aro (canto superior esquerdo) */}
        <path d={`M${cx-rx*0.78} ${cy-RY*0.52} A${rx} ${RY} 0 0 1 ${cx-rx*0.18} ${cy-RY*0.98}`} fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="2.2" strokeLinecap="round"/>
      </g>
    );
  }
  return(
    <svg viewBox={`0 0 300 ${H}`} aria-hidden="true" focusable="false">
      <defs>
        <pattern id="coinMill" patternUnits="userSpaceOnUse" width="3.4" height="20"><rect width="1.2" height="20" fill="rgba(0,0,0,0.30)"/><rect x="1.8" width="0.7" height="20" fill="rgba(255,255,255,0.12)"/></pattern>
        <linearGradient id={gS} x1="0" y1="0" x2="1" y2="0">{C.side.map(([o,c])=><stop key={o} offset={o} stopColor={c}/>)}</linearGradient>
        <linearGradient id={gA} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0.5"/><stop offset="0.45" stopColor="#000" stopOpacity="0.08"/><stop offset="1" stopColor="#000" stopOpacity="0.18"/></linearGradient>
        <radialGradient id={gT} cx="0.4" cy="0.3" r="0.9"><stop offset="0" stopColor={C.top[0]}/><stop offset="0.5" stopColor={C.top[1]}/><stop offset="1" stopColor={C.top[2]}/></radialGradient>
        <linearGradient id={gF} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={C.field[0]}/><stop offset="1" stopColor={C.field[1]}/></linearGradient>
      </defs>
      {coins}
    </svg>
  );
}

export function RankPodium({items,onPick,meKey,highlightKey,meRef,hiRef,meFlash}){
  const order=[items[1],items[0],items[2]].filter(Boolean); // 2.º · 1.º · 3.º
  return(
    <div className="rkPodium" role="list" aria-label="Pódio">
      {order.map(({p,rank,val,day,logos})=>{
        const t=PODIUM_TONE[rank], me=p.key===meKey;
        return(
          <div key={p.key} role="listitem" tabIndex={0}
            ref={(me||p.key===highlightKey)?((el)=>{ if(me) meRef.current=el; if(p.key===highlightKey) hiRef.current=el; }):null}
            className={"rkPodCol rkPod"+rank+((me&&meFlash)||p.key===highlightKey?" rkHiFlash":"")}
            onClick={()=>onPick(p.key)} onKeyDown={e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onPick(p.key); } }}
            style={{"--pod":t.rgb}}>
            <span className="rkPodName" title={p.name}><span className="rkPodNameTx">{p.name}</span>{me&&<span className="rkPodYou">Tu</span>}</span>
            {/* Telemóvel: rentabilidade por baixo do nome (a placa sobre as moedas não cabe em colunas estreitas) */}
            <span className="rkPodStat">
              <span className="rkPodVal" style={{color:(val??0)>=0?"#4ade80":"#f87171"}}>{val==null?"—":<Rolling text={pct(val)}/>}</span>
              <span className="rkPodDay" style={{color:day==null?"#64748b":day>=0?"#4ade80":"#f87171"}}>
                {day==null?"—":<>{day>=0?"▲":"▼"} <Rolling text={pct(Math.abs(day)).replace("+","")}/> <em>{lastDayLabel().toLowerCase()}</em></>}
              </span>
            </span>
            <span className="rkPodBallWrap">
              <PodiumLaurel rank={rank} hi={PODIUM_TONE[rank].hi} lo={PODIUM_TONE[rank].lo}/>
              <span className="rkPodBall" aria-label={`${rank}.º lugar`}><span className="rkPodBallIn"><span className="rkPodNum">{rank}</span></span></span>
            </span>
            <span className="rkPodStack">
              <CoinStack rank={rank}/>
              <span className="rkPodPlaque">
                <span className="rkPodVal" style={{color:(val??0)>=0?"#4ade80":"#f87171"}}>{val==null?"—":<Rolling text={pct(val)}/>}</span>
                <span className="rkPodDay" style={{color:day==null?"#64748b":day>=0?"#4ade80":"#f87171"}}>
                  {day==null?"—":<>{day>=0?"▲":"▼"} <Rolling text={pct(Math.abs(day)).replace("+","")}/> <em>{lastDayLabel().toLowerCase()}</em></>}
                </span>
                {logos&&logos.length>0&&(
                  <span className="rkPodLogos" title="As ações com melhor desempenho desta carteira">
                    {logos.map(tk=><StockLogo key={tk} ticker={tk} size={16}/>)}
                  </span>
                )}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Skeleton da página de ranking (substitui o splash enquanto os dados chegam): mesma forma final.
export function RankingSkeleton(){
  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#070d1c 100%)",backgroundAttachment:"fixed",padding:"84px 16px 40px",fontFamily:"var(--font-app), system-ui, sans-serif"}} aria-busy="true" aria-label="A carregar o ranking">
      <div style={{maxWidth:980,margin:"0 auto"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12,marginBottom:22}}>
          <Skeleton w={220} h={26} r={8}/><Skeleton w={300} h={12} r={6}/>
        </div>
        <Skeleton w="100%" h={220} r={16} style={{display:"block",marginBottom:18}}/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,alignItems:"end",marginBottom:18}}>
          <Skeleton w="100%" h={128} r={16} style={{display:"block"}}/>
          <Skeleton w="100%" h={156} r={16} style={{display:"block"}}/>
          <Skeleton w="100%" h={118} r={16} style={{display:"block"}}/>
        </div>
        <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,overflow:"hidden"}}>
          {Array.from({length:9}).map((_,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"28px minmax(0,1fr) 84px 64px",gap:12,alignItems:"center",padding:"14px 16px",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
              <Skeleton w={20} h={14} r={5}/>
              <Skeleton w={`${48+((i*17)%34)}%`} h={14} r={6}/>
              <Skeleton w="100%" h={20} r={6}/>
              <Skeleton w="100%" h={14} r={6}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Medalhas de vencedor (mini-épocas). w = winners[pf.key] = {monthly:[labels], weekly:[labels]}.
// Um ícone por tipo (mensal/semanal), com contador ×N. Ao passar o rato mostra uma etiqueta flutuante
// (HoverName, o MESMO estilo dos logos das ações na linha) — ex.: "Vencedor Semana 1" — não é tooltip
// nativo. Reutiliza as imagens dos medalhões; preserva o rácio (454×531) para não "esmagar".
export function WinnerMedals({w,size=20}){
  if(!w) return null;
  const badge=(src,alt,label,arr)=> arr.length>0?(
    <HoverName key={src} label={label}>
      <span style={{position:"relative",display:"inline-flex",flexShrink:0}}>
        <img src={src} alt={alt} style={{height:size,width:"auto",display:"block",filter:"drop-shadow(0 1px 3px rgba(0,0,0,0.5))"}}/>
        {arr.length>1&&<span style={{position:"absolute",bottom:-3,right:-5,fontSize:Math.max(8,Math.round(size*0.42)),fontWeight:800,color:"#0a0a0a",background:"#facc15",borderRadius:999,padding:"0 3px",lineHeight:1.25,minWidth:12,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.4)"}}>×{arr.length}</span>}
      </span>
    </HoverName>
  ):null;
  return <>
    {badge("/cdi-mensal-winner.webp","Vencedor mensal",`Campeão de ${w.monthly.join(", ")}`,w.monthly)}
    {badge("/cdi-semana-winner.webp","Vencedor semanal",`Vencedor ${w.weekly.join(", ")}`,w.weekly)}
  </>;
}

// Seletor de período (dropdown glass) — escolher a semana/mês a ver (Atual + históricos).
export function PeriodPicker({options,value,onPick,accent="#4ade80",accentRGB="74,222,128",icon}){
  const [open,setOpen]=useState(false);
  const wrapRef=useRef(null);
  useEffect(()=>{ if(!open) return; const h=(e)=>{ if(wrapRef.current&&!wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h); },[open]);
  const cur=options.find(o=>o.key===value)||options[0];
  return(
    <div ref={wrapRef} style={{position:"relative",display:"inline-block"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:9,fontSize:13.5,fontWeight:700,
        color:"#f1f5f9",background:`rgba(${accentRGB},0.10)`,border:`1px solid rgba(${accentRGB},0.48)`,
        boxShadow:`0 0 14px rgba(${accentRGB},0.16), inset 0 1px 0 rgba(255,255,255,0.06)`,
        borderRadius:999,padding:"9px 16px",textTransform:"capitalize"}}>
        {icon&&<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}>{icon}</svg>}
        {cur?.label}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{flexShrink:0,transform:open?"rotate(180deg)":"none",transition:"transform .18s ease"}}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:"50%",transform:"translateX(-50%)",zIndex:60,minWidth:170,maxHeight:300,overflowY:"auto",
          background:"rgba(15,23,42,0.96)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",
          border:"1px solid rgba(255,255,255,0.14)",borderRadius:12,padding:6,boxShadow:"0 12px 34px rgba(0,0,0,0.5)"}}>
          {options.map(o=>(
            <button key={o.key||"cur"} onClick={()=>{ onPick(o.key); setOpen(false); }}
              style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",fontSize:13,fontWeight:o.key===value?800:500,textTransform:"capitalize",
                color:o.key===value?"#0a0a0a":"#cbd5e1",background:o.key===value?accent:"transparent",border:"none",borderRadius:8,padding:"8px 12px",whiteSpace:"nowrap"}}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Cartão-carrossel "Últimos comentários" (rail do Ranking): um comentário de cada vez, ‹ › para
// percorrer do mais recente para os mais antigos. Clicar abre o perfil-alvo na área de comentários.
export function RecentCommentsCard({items,onOpen}){
  const [i,setI]=useState(0);
  const n=items.length;
  const idx=Math.min(i,n-1);
  const c=items[idx];
  if(!c) return null;
  const btn=(dir,disabled,label)=>(
    <button aria-label={label} disabled={disabled} onClick={()=>setI(v=>Math.max(0,Math.min(n-1,v+dir)))}
      style={{background:"none",border:"none",cursor:disabled?"default":"pointer",color:disabled?"#3f4b5f":"#94a3b8",
        fontSize:16,lineHeight:1,padding:"2px 6px",transition:"color .12s"}}
      onMouseEnter={disabled?undefined:(e=>e.currentTarget.style.color="#e2e8f0")}
      onMouseLeave={disabled?undefined:(e=>e.currentTarget.style.color="#94a3b8")}>{dir<0?"‹":"›"}</button>
  );
  return(
    <div>
      <div onClick={()=>onOpen(c.portfolioId,c.id)} title="Ver o comentário no perfil"
        style={{cursor:"pointer",borderRadius:9,padding:"6px 9px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",transition:"background .12s"}}
        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
        onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}>
        <div style={{fontSize:11,color:"#94a3b8",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          <strong style={{color:"#cbd5e1"}}>{c.author}</strong>
          <span style={{color:"#64748b"}}> → </span>
          <strong style={{color:"#cbd5e1"}}>{c.targetName}</strong>
        </div>
        <div style={{fontSize:12.5,color:"#e2e8f0",lineHeight:1.35,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",wordBreak:"break-word"}}>{c.content}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:5}}>
        <span style={{fontSize:10.5,color:"#64748b"}}>{timeAgo(c.created_at)}</span>
        <span style={{display:"flex",alignItems:"center",gap:2}}>
          {btn(-1,idx===0,"Mais recente")}
          <span style={{fontSize:10.5,color:"#64748b",fontVariantNumeric:"tabular-nums",minWidth:34,textAlign:"center"}}>{idx+1}/{n}</span>
          {btn(1,idx>=n-1,"Mais antigo")}
        </span>
      </div>
    </div>
  );
}

// Toggle Geral/Mensal/Semanal com PÍLULA VERDE DESLIZANTE (mede o botão ativo e anima até ele), igual
// à pílula da nav de topo. Respeita prefers-reduced-motion (salta, sem deslize).
export function PeriodToggle({period,setPeriod,accentL,accentD,accentRGB}){
  const items=[["total","Geral"],["month","Mensal"],["week","Semanal"]];
  const ref=useRef(null);
  const [pill,setPill]=useState(null); // {left,top,width,height}
  const readyRef=useRef(false);
  useLayoutEffect(()=>{
    const el=ref.current; if(!el) return;
    const measure=()=>{
      const sel=el.querySelector("[data-on='1']"); const cr=el.getBoundingClientRect();
      if(!sel){ setPill(null); return; }
      const br=sel.getBoundingClientRect();
      // a pílula é position:absolute (origem = padding-box, dentro da borda); getBoundingClientRect dá o
      // border-box → subtrai a borda (clientTop/Left) senão fica 1px baixo/à-direita (assimétrico em cima/baixo).
      setPill({left:br.left-cr.left-el.clientLeft,top:br.top-cr.top-el.clientTop,width:br.width,height:br.height});
    };
    measure();
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    const raf=requestAnimationFrame(()=>{ readyRef.current=!reduce; });
    const ro=new ResizeObserver(measure); ro.observe(el);
    return()=>{ cancelAnimationFrame(raf); ro.disconnect(); };
  },[period]);
  const ease="cubic-bezier(.34,1.1,.4,1)";
  const fillL=accentL||"#6ee7b7", fillD=accentD||"#22c55e", rgb=accentRGB||"74,222,128";
  return(
    <div ref={ref} className="rkHeadToggle" style={{position:"relative",display:"inline-flex",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,padding:3}}>
      {pill&&(
        <div aria-hidden="true" style={{position:"absolute",left:0,top:0,width:pill.width,height:pill.height,
          transform:`translate(${pill.left}px,${pill.top}px)`,borderRadius:999,
          background:`linear-gradient(180deg,${fillL},${fillD})`,
          boxShadow:`0 2px 12px rgba(${rgb},0.45), 0 0 0 1px rgba(${rgb},0.5)`,zIndex:0,pointerEvents:"none",
          transition:readyRef.current?`transform .34s ${ease}, width .34s ${ease}, height .34s ${ease}, background .2s ease`:"none"}}/>
      )}
      {items.map(([k,lbl])=>{ const on=period===k; return(
        <button key={k} data-on={on?"1":undefined} onClick={()=>setPeriod(k)}
          style={{position:"relative",zIndex:1,cursor:"pointer",fontSize:13.5,fontWeight:800,borderRadius:999,padding:"9px 18px",border:"none",whiteSpace:"nowrap",background:"transparent",
            color:on?"#06281f":"#94a3b8",transition:"color .28s ease"}}>{lbl}</button>
      );})}
    </div>
  );
}

export function Ranking({ranking,myNorm,pricesLoading,pricesAsOf,spy,dayChange,marketClosed,livePrices,preLaunch,settings,monthBase,pastBaselines,monthCloses,weekBase,weekOpens,weekCloses,period,setPeriod,onSelect,onCompare,highlightKey,clearHighlight,winners,showToast,recentComments,openComments}){
  const [cmp,setCmp]=useState(false);
  const [sel,setSel]=useState([]);
  // Mini-curva por linha: snapshots por portefólio (histórico). Recarrega só quando o
  // conjunto de portefólios muda (não a cada atualização de preços).
  const [seriesById,setSeriesById]=useState({});
  const [seriesLoaded,setSeriesLoaded]=useState(false); // snapshots já chegaram (p/ o FEED não piscar aos poucos)
  const [feedTimeout,setFeedTimeout]=useState(false);    // rede de segurança: mostra o FEED ao fim de 3.5s mesmo sem tudo pronto
  useEffect(()=>{ const t=setTimeout(()=>setFeedTimeout(true),3500); return()=>clearTimeout(t); },[]);
  const idsKey=[...new Set(ranking.map(p=>p.id).filter(Boolean))].sort().join(",");
  useEffect(()=>{
    let cancel=false;
    const ids=idsKey?idsKey.split(","):[];
    if(!ids.length){ setSeriesById({}); setSeriesLoaded(true); return; }
    (async()=>{
      const snapshotUntil=new Date().toISOString();
      // A tabela já vai em ~27 mil linhas (124 portefólios × meses de histórico) → paginar a
      // 1000/página em SÉRIE (uma à espera da anterior) somava ~28 pedidos sequenciais, alguns
      // segundos só nisto. Pede o total (count) e dispara todas as páginas em PARALELO — mesmos
      // dados, mesma ordenação final (junta por índice da página, não pela ordem de chegada), só
      // muda a forma de os ir buscar: a demora passa a ser a de 1 pedido, não a soma de 28.
      const PAGE=1000;
      const cols="id,portfolio_id,date,captured_at,total_return";
      const baseFilters=(q)=>q.in("portfolio_id",ids).lte("captured_at",snapshotUntil).order("id",{ascending:true});
      const first=await baseFilters(supabase.from("portfolio_snapshots").select(cols,{count:"exact"})).range(0,PAGE-1);
      if(cancel) return;
      if(first.error){
        console.error("Falha ao carregar snapshots do ranking:",first.error);
        setSeriesLoaded(true); return;
      }
      const rows=[...(first.data||[])];
      const total=first.count??rows.length;
      if(total>PAGE){
        const pageCount=Math.ceil(total/PAGE);
        const rest=await Promise.all(Array.from({length:pageCount-1},(_,i)=>{
          const from=(i+1)*PAGE;
          return baseFilters(supabase.from("portfolio_snapshots").select(cols)).range(from,from+PAGE-1);
        }));
        if(cancel) return;
        for(const r of rest){
          if(r.error){ console.error("Falha ao carregar snapshots do ranking:",r.error); continue; }
          rows.push(...(r.data||[]));
        }
      }
      const m={};
      rows.forEach(r=>{ (m[r.portfolio_id]=m[r.portfolio_id]||[]).push({snapshotId:r.id,date:r.date,capturedAt:r.captured_at,r:Number(r.total_return)}); });
      Object.values(m).forEach(points=>points.sort((a,b)=>String(a.capturedAt||a.date).localeCompare(String(b.capturedAt||b.date))||a.snapshotId-b.snapshotId));
      setSeriesById(m); setSeriesLoaded(true);
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
  const curWk=compWeekKey(new Date());                              // 2ª feira UTC da semana EM JOGO (até à abertura de 2ª ainda é a que fechou)
  // Semana JÁ FECHADA (6ª pós-fecho / fim de semana) e com o fecho gravado → a lista E o gráfico semanais
  // CONGELAM no resultado OFICIAL (open→close), tal como o vencedor. Antes usavam preços AO VIVO, que ao
  // fim de semana derrapam do fecho de 6ª (sp500_ath atualizado, split, ATLN instável…) → trocava o 1º.
  const weekFrozen=(weekTradingDone(new Date())&&weekOpens&&weekOpens[curWk]&&weekCloses&&weekCloses[curWk])?{from:weekOpens[curWk],to:weekCloses[curWk]}:null;
  // Pré-arranque (fim de semana): sem baseline da semana → devolve null (coluna "—", ordem geral).
  const weekOf=(p)=> weekFrozen ? pfPeriodRet(p,weekFrozen.from,weekFrozen.to) : (hasWeek?pfWeekRet(p,weekBase,livePrices):null);
  // 2ª feira em que a semana VAI arrancar (grelha de partida do gráfico, pré-arranque semanal):
  // antes do arranque ao vivo → WEEK_LIVE_FROM; ao fim de semana → próxima 2ª; num dia útil → esta 2ª.
  const frameWk=(()=>{ const n=new Date(); const ymd=n.toISOString().slice(0,10); const dow=n.getUTCDay();
    if(ymd<WEEK_LIVE_FROM) return WEEK_LIVE_FROM; return (dow===0||dow===6)?nextWeek(curWk):curWk; })();
  const curMonthYM=new Date().toISOString().slice(0,7);             // 'YYYY-MM' (chave do monthBase)
  const curMonthStartIso=`${curMonthYM}-01T00:00:00.000Z`;         // abertura do mês (p/ spy.priceAt)
  const curMonthDateOnly=`${curMonthYM}-01`;                        // início do mês (p/ periodStart do gráfico)
  const preStartWk=period==="week"&&!hasWeek;                       // Semanal antes de arrancar (fim de semana)
  // Mensal antes de arrancar: mês novo cujo 1º PREGÃO ainda não abriu (fim de semana / pré-abertura de 2ª).
  // Até à abertura US (~13:30 UTC = 14:30 Portugal), a corrida do mês novo não tem dados reais → o Mensal
  // mostra por defeito o MÊS ANTERIOR CONGELADO (o último vencedor), em vez de um ranking vazio.
  const monthPreStart=(()=>{
    const now=new Date();
    let d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)); // 1º do mês
    while(d.getUTCDay()===0||d.getUTCDay()===6) d.setUTCDate(d.getUTCDate()+1); // 1º dia útil
    const openMs=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),13,30,0); // abertura US (~13:30 UTC, verão)
    return now.getTime()<openMs;
  })();
  // 1º DIA DE SESSÃO da semana (normalmente 2ª feira; salta feriados): nesse dia o DIÁRIO = o SEMANAL,
  // porque ambos medem desde o fecho de 6ª. Antes da abertura o semanal está a 0% (baseline reconciliado)
  // → o diário também mostra 0%; durante a sessão fica ao vivo. Nos dias 2-5, o diário é o normal.
  const weekDayOne=(()=>{
    if(period!=="week"||!hasWeek) return false;
    const etOf=(d)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
    const todayET=etOf(new Date());
    let d=new Date(curWk+"T12:00:00Z"); // meio-dia UTC evita saltos de fuso à meia-noite
    for(let i=0;i<5;i++){
      const iso=etOf(d), dow=d.getUTCDay();
      if(dow>=1&&dow<=5&&!MARKET_HOLIDAYS_US.has(iso)) return iso===todayET; // 1º dia útil não-feriado
      d.setUTCDate(d.getUTCDate()+1);
    }
    return false;
  })();
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
    if(period==="week"){ if(!hasWeek) return null; const b=spy.closeBefore(`${curWk}T00:00:00.000Z`); return (Number.isFinite(b)&&b>0)?spy.now/b-1:null; }
    // Meses DEPOIS do arranque: S&P desde o início do mês (o baseline do mês é capturado nesse dia).
    const isLaunchMonth=curMonthYM===String(settings?.gameStartDate||"").slice(0,7);
    if(period==="month"&&!isLaunchMonth){ const b=spy.closeBefore(curMonthStartIso); return (Number.isFinite(b)&&b>0)?spy.now/b-1:null; }
    // total + mês de ARRANQUE (julho): S&P ancorado ao LOCK dos baselines (30-jun) = spy_initial_price,
    // a MESMA data em que as ações dos membros foram congeladas → comparação justa e coerente.
    return officials.length?spy.returnFor(officials[0]):null;
  };
  // ── HISTÓRICO: escolher uma semana/mês PASSADO e ver o Top 10 + vencedor desse período.
  const [histKey,setHistKey]=useState(null);
  useEffect(()=>{ setHistKey(null); },[period]); // trocar de aba limpa a seleção histórica
  const gameStartYMD=String(settings?.gameStartDate||"").slice(0,10);
  const seedWeeks=WEEK_SEED_CHAMPS.map(s=>s.period).filter(w=>w<curWk); // semanas semeadas passadas (Semana 1)
  const pastWeeks=useMemo(()=>{ const base=Object.keys(weekCloses||{}).filter(w=>w<curWk&&weekOpens[w]&&weekCloses[w]);
    return [...new Set([...base,...seedWeeks])].sort().reverse(); },[weekCloses,weekOpens,curWk]);
  const pastMonths=useMemo(()=>Object.keys(pastBaselines||{}).filter(m=>/^\d{4}-\d{2}$/.test(m)&&m<curMonthYM&&pastBaselines[nextPeriod(m)]).sort().reverse(),[pastBaselines,curMonthYM]);
  const histAvail=period==="week"?pastWeeks:period==="month"?pastMonths:[];
  const histActive=(period==="week"||period==="month")&&!!histKey;
  const histSeedWk=histActive&&period==="week"&&!(weekOpens[histKey]&&weekCloses[histKey]); // semana sem baselines → snapshots
  const histLabel=period==="week"?weekLabel(histKey||curWk):periodLabel(histKey||curMonthYM);
  const histWindow=histActive?(period==="week"
    ?{periodStart:(gameStartYMD&&gameStartYMD>histKey)?gameStartYMD:histKey,periodEnd:weekFriday(histKey)} // arranque: janela do 1º dia de jogo
    :(()=>{ const [y,m]=histKey.split("-").map(Number); return {periodStart:`${histKey}-01`,periodEnd:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)}; })()):null;
  // Semana de ARRANQUE (semeada, sem baselines): rentab. = total_return no fim da janela (o baseline
  // É o próprio arranque → sem subtração). Lê por captured_at (fiável); o campo `date` está desalinhado.
  const [seedRet,setSeedRet]=useState({});
  useEffect(()=>{
    if(!histSeedWk||!histWindow) return;
    let cancel=false;
    (async()=>{
      const { data }=await supabase.from("portfolio_snapshots").select("portfolio_id,total_return")
        .gte("captured_at",`${histWindow.periodStart}T00:00:00.000Z`).lte("captured_at",`${histWindow.periodEnd}T23:59:59.999Z`)
        .order("captured_at",{ascending:true});
      if(cancel) return;
      const last={}; (data||[]).forEach(r=>{ last[r.portfolio_id]=Number(r.total_return); }); // asc → último por portefólio
      setSeedRet(last);
    })();
    return()=>{ cancel=true; };
  },[histSeedWk,histKey]);
  const histFromTo=(histActive&&!histSeedWk)?(period==="week"?{from:weekOpens[histKey],to:weekCloses[histKey]}:{from:pastBaselines[histKey],to:pastBaselines[nextPeriod(histKey)]}):null;
  const histRetOf=(p)=>{ if(!histActive) return null;
    if(histSeedWk) return Number.isFinite(seedRet[p.id])?seedRet[p.id]:null;
    return histFromTo?pfPeriodRet(p,histFromTo.from,histFromTo.to):null; };
  const histTop=useMemo(()=>{ if(!histActive) return [];
    return [...officials].map(p=>({p,r:histRetOf(p)})).filter(x=>Number.isFinite(x.r)).sort((a,b)=>b.r-a.r).slice(0,10); },[histActive,histKey,officials,period,seedRet]);
  const weekOpts=[{key:null,label:`${weekLabel(curWk)} (${weekTradingDone(new Date())?"final":"atual"})`},...pastWeeks.map(w=>({key:w,label:weekLabel(w)}))];
  const monthOpts=[{key:null,label:`${periodLabel(curMonthYM)} (atual)`},...pastMonths.map(m=>({key:m,label:periodLabel(m)}))];
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
  const [cvOff,setCvOff]=useState(false); // desliga content-visibility durante o scroll → alturas reais à 1ª
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
        const toRaceBottom=Math.max(0,Math.round(r.bottom-champA.getBoundingClientRect().top));
        // O destaque vertical pode ser mais alto do que o estado curto do Race (sem histórico).
        // A célula acompanha pelo menos a altura do cartão para nunca o sobrepor à tabela abaixo.
        setRailH(Math.max(toRaceBottom,champStickyRef.current?.offsetHeight||0));
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
    setMeFlash(true); setTimeout(()=>setMeFlash(false),2600);
    // As linhas acima têm content-visibility:auto (altura estimada a 56px). À 1ª vez nunca foram
    // pintadas → o scroll usa a altura estimada e aterra desalinhado (à 2ª já têm altura real e acerta).
    // Solução: desligar o content-visibility, esperar o reflow com alturas REAIS, e só aí centrar.
    setCvOff(true);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const r=meRowRef.current; if(r) r.scrollIntoView({behavior:"smooth",block:"center"});
      setTimeout(()=>setCvOff(false),900); // repõe o content-visibility após o scroll assentar
    }));
  };
  useEffect(()=>{
    if(!highlightKey) return;
    let cancelled=false, raf=0;
    const now=()=>(typeof performance!=="undefined"?performance.now():Date.now());
    const start=now();
    setCvOff(true); // alturas REAIS das linhas (sem a estimativa do content-visibility) → centro exato
    // Mantém a MESMA linha COLADA ao centro em CADA frame enquanto o layout assenta (~1s): o gráfico
    // Race, o Feed e as sparklines/imagens chegam em ondas e empurrariam a linha. Ao corrigir por-frame
    // (antes do paint) a linha NUNCA salta — só recentra se saiu do sítio (não luta com o utilizador parado).
    let stable=0;
    const tick=()=>{
      if(cancelled) return;
      const el=highlightRef.current; let moved=false;
      if(el){
        const rect=el.getBoundingClientRect();
        const off=(rect.top+rect.height/2)-window.innerHeight/2;
        if(Math.abs(off)>1.5){ window.scrollBy(0,off); moved=true; }
      }
      stable=moved?0:stable+1;
      // pára quando estabilizar (10 frames ≈ 150ms sem mexer) ou ao fim de 2s (rede de segurança).
      if(stable<10 && now()-start<2000) raf=requestAnimationFrame(tick);
      else setCvOff(false); // repõe o content-visibility depois de assentar
    };
    raf=requestAnimationFrame(tick);
    // Se o utilizador começar a fazer scroll, larga o controlo imediatamente (não o "prende").
    const stop=()=>{ cancelled=true; setCvOff(false); };
    window.addEventListener("wheel",stop,{passive:true,once:true});
    window.addEventListener("touchmove",stop,{passive:true,once:true});
    const tc=setTimeout(()=>{ if(!cancelled) clearHighlight&&clearHighlight(); },2600); // limpa o destaque no fim do flash
    return()=>{ cancelled=true; cancelAnimationFrame(raf); clearTimeout(tc);
      window.removeEventListener("wheel",stop); window.removeEventListener("touchmove",stop); };
  },[highlightKey]);
  // No 1º dia da semana o diário espelha o semanal (0% pré-abertura, ao vivo na sessão); resto = normal.
  const pfDayReturn=(p)=>weekDayOne?weekOf(p):pfDayRet(p,dayChange);
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
    let shown=ranked, showPodium=false;
    if(searchable){
      if(q) shown=shown.filter(p=>norm(p.name).includes(q));
      if(pq) shown=shown.filter(matchesPos);
      const valOf=perActive?(sortKey==="day"?pfDayReturn:valForPeriod):(sortKey==="day"?pfDayReturn:(p=>p.total));
      const sign=sortDir==="asc"?1:-1;
      shown=[...shown].sort((a,b)=>{ const va=valOf(a),vb=valOf(b); if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return (va-vb)*sign; });
      // Pódio: só na ordem por defeito (rentabilidade ↓) e sem pesquisa → o Top 3 sai da lista (aparece no pódio).
      if(!preStartWk&&!q&&!pq&&sortKey==="total"&&sortDir==="desc"&&ranked.length>=3){
        showPodium=true;
        shown=shown.filter(x=>x._rank>3);
      }
      if(!q&&!pq) shown=shown.slice(0,shownRows);
    }
    const podiumEl=showPodium?(
      <RankPodium meKey={myRow?myRow.key:null} highlightKey={highlightKey} meRef={meRowRef} hiRef={highlightRef} meFlash={meFlash}
        onPick={k=>cmp?toggleSel(k):onSelect(k)}
        items={ranked.slice(0,3).map(p=>({p,rank:p._rank,val:perActive?valForPeriod(p):p.total,day:pfDayReturn(p),
          logos:(p.stocks||[]).map(s=>({t:s.ticker,r:stockRet(s,livePrices)})).sort((a,b)=>b.r-a.r).slice(0,4).map(x=>x.t)}))}/>
    ):null;
    return(
    <>
    {podiumEl}
    <div className={cvOff?"rkNoCV":undefined} style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"clip"}}>
      <div className="rkRow rkStickyHead" style={{padding:"10px 14px",borderBottom:"1px solid rgba(255,255,255,0.10)",
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
          <span className="rkNarrowHd" style={{textAlign:"right"}}>#</span>
          <span className="rkNarrowHd">Membro</span>
          </>
        ) : (<><span style={{textAlign:"right"}}>#</span><span>Membro</span></>)}
        <span className="rkSpark"></span>
        {searchable?<SortHd k="total">{period==="week"?"Semana":period==="month"?"Mês":"Rentab."}</SortHd>:<span style={{textAlign:"center"}}>Rentab.</span>}
        {searchable?<SortHd k="day">{lastDayLabel()}</SortHd>:<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>{lastDayLabel()}<InfoTip text={marketClosed?"Rentabilidade do último pregão (mercado fechado) — variação congelada do último dia de sessão.":"Rentabilidade do portefólio hoje (média diária das ações; espelhada para shorts)."}/></span>}
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
      {shown.map((p,idx)=>{
        const i=p._rank-1; // rank real (mantém nº do lugar e estilos Top 3/Top 10 mesmo ao filtrar)
        const me=p.normName===myNorm;
        const dayRet=pfDayReturn(p);
        const rentVal=perActive?valForPeriod(p):p.total; // valor mostrado na coluna Rentab./Mês/Semana
        // 🟢/🔴 do PERÍODO: ações em ganho/perda desde o baseline do período (semana/mês), não o total.
        const stat=perActive?(()=>{ let pos=0,neg=0; for(const s of (p.stocks||[])){ const base=baseForStock(s.ticker,s.initialPrice); const cur=curPrice(s.ticker,s.initialPrice,livePrices); const rr0=base>0?cur/base-1:0; const r=s.side==="short"?-rr0:rr0; const rd=rSign(r); if(rd>0)pos++; else if(rd<0)neg++; } return {pos,neg}; })():{pos:p.pos,neg:p.neg};
        const picked=cmp&&sel.includes(p.key);
        // Top 3: ouro (1º, amarelo vivo) / prata (2º) / bronze-âmbar (3º). 4º-10º: cor geral.
        const rr=(!preStartWk&&i<3)?[
          {bg:"rgba(250,204,21,0.12)",hov:"rgba(250,204,21,0.18)",bar:"#facc15"},
          {bg:"rgba(241,245,249,0.12)",hov:"rgba(241,245,249,0.18)",bar:"#e2e8f0"},
          {bg:"rgba(245,158,11,0.11)",hov:"rgba(245,158,11,0.17)",bar:"#d97706"},
        ][i]:null;
        const inTop10=!preStartWk&&i>=3&&i<10;          // 4º–10º (o Top 3 são as medalhas)
        // A TUA linha: se não estiver já colorida por posição (Top 3/Top 10), ganha a sua própria
        // barra + fundo no acento do período — antes era só 4% de verde, quase invisível a meio de
        // 124 linhas. Posição/seleção continuam a ter prioridade visual sobre "é a tua linha".
        const barColor=rr?rr.bar:inTop10?"#22c55e":me?thA:null;
        // "é a tua linha" fora do Top 10 ganha tratamento mais forte que as outras: barra mais grossa
        // COM brilho (não só cor) + fundo mais vivo — para ser impossível de perder a meio de 124 linhas.
        const meUnranked=me&&!rr&&!inTop10;
        const baseBg=picked?"rgba(59,130,246,0.16)":meUnranked?`rgba(${thRGB},0.13)`:me?`rgba(${thRGB},0.09)`:"transparent";
        const hoverBg=picked?baseBg:rr?rr.hov:inTop10?"rgba(34,197,94,0.10)":meUnranked?`rgba(${thRGB},0.19)`:"rgba(255,255,255,0.05)";
        const meShadow=meUnranked?`inset 5px 0 0 ${thA}, inset 0 0 22px rgba(${thRGB},0.16), 0 0 14px rgba(${thRGB},0.14)`:null;
        return(
          <div key={p.key} ref={(me||p.key===highlightKey)?((el)=>{ if(me) meRowRef.current=el; if(p.key===highlightKey) highlightRef.current=el; }):null} className={"rkRow rkDataRow"+((p.key===highlightKey||(me&&meFlash))?" rkHiFlash":"")} onClick={()=>cmp?toggleSel(p.key):onSelect(p.key)}
            style={{padding:"14px 14px",borderBottom:"1px solid rgba(255,255,255,0.10)",cursor:"pointer",
              background:baseBg,boxShadow:picked?"inset 3px 0 0 #3b82f6":meShadow||(barColor?`inset 3px 0 0 ${barColor}`:"none"),transition:"background 0.15s"}}
            onMouseEnter={e=>{ if(!picked) e.currentTarget.style.background=hoverBg; }}
            onMouseLeave={e=>{ e.currentTarget.style.background=baseBg; }}>
            <span style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
              {(!preStartWk&&i<3)
                ? <span className="rankShine rankBreathe" style={{width:22,height:22,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0,...RANK_BADGE[i+1],"--shine-delay":`${i*1.2}s`}}>{i+1}</span>
                : <span style={{width:22,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#94a3b8",fontWeight:700}}>{preStartWk?"·":i+1}</span>}
            </span>
            <span style={{fontWeight:600,fontSize:"clamp(11.5px,3.1vw,15px)",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
              <span style={{minWidth:0,overflowWrap:"normal",wordBreak:"normal",lineHeight:1.2}}>{p.name}</span>
              {winners&&winners[p.key]&&<span style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}><WinnerMedals w={winners[p.key]} size={20}/></span>}
              {me&&<span style={{flexShrink:0,fontSize:10,background:`rgba(${thRGB},0.22)`,color:thL,border:`1px solid rgba(${thRGB},0.55)`,boxShadow:`0 0 10px rgba(${thRGB},0.35)`,borderRadius:999,padding:"2px 9px",fontWeight:800,letterSpacing:".2px"}}>Tu</span>}
            </span>
            <span className="rkSpark">
              {/* Sem sparkline no pré-arranque semanal — ainda não há histórico da semana.
                  Em mini-época (semana/mês): só os snapshots DENTRO do período, rebaseados ao início
                  (r − total_no_início) → a curva mostra a evolução DA SEMANA/MÊS, não do total. */}
              {preStartWk?null:!seriesLoaded?<Skeleton w="100%" h={14} r={6}/>:(()=>{
                if(!perActive) return <MiniSparkline series={seriesById[p.id]||[]} current={p.total} height={24}/>;
                const ps=period==="week"?curWk:curMonthDateOnly; // início do período (YYYY-MM-DD)
                const all=seriesById[p.id]||[];
                // Arranca a linha a 0% no início do período → o ponto final (rentab. do período) fica
                // acima do de entrada quando é positivo (e abaixo quando negativo), como deve ser.
                const ser=buildPeriodSparklineSeries(all,ps,p.total,rentVal);
                return <MiniSparkline series={ser} current={rentVal} height={24}/>;
              })()}
            </span>
            <span style={{textAlign:"center",alignSelf:"center",fontWeight:800,fontFamily:"monospace",fontSize:"clamp(12.5px,3.6vw,15px)",color:(rentVal??0)>=0?"#4ade80":"#f87171"}}>{rentVal==null?"—":<Rolling text={pct(rentVal)}/>}</span>
            <span style={{textAlign:"center",alignSelf:"center",fontFamily:"monospace",fontSize:"clamp(11px,3vw,13px)",fontWeight:600,
              color:(preStartWk||dayRet==null)?"#4b5563":dayRet>=0?"#4ade80":"#f87171"}}>{(preStartWk||dayRet==null)?"—":<Rolling text={pct(dayRet)}/>}</span>
            <span style={{textAlign:"center",alignSelf:"center",fontFamily:"monospace",fontSize:"clamp(11px,3vw,14px)",fontWeight:700}}>
              {preStartWk?<span style={{color:"#4b5563"}}>—</span>:<><span style={{color:"#4ade80"}}>{stat.pos}</span><span style={{color:"#94a3b8"}}>/</span><span style={{color:"#f87171"}}>{stat.neg}</span></>}
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
    </>
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
    // Batem o mercado = rentabilidade do jogo ativo > S&P do MESMO período (Geral + mês de arranque:
    // desde o lock de 30-jun; meses seguintes: início do mês; semana: 2ª feira) — mesma âncora dos dois lados.
    let beating=null;
    if(spyRet!=null){ beating=0; for(const x of off) if(x.m>spyRet) beating++; }
    return { n:off.length, avg, spyRet, beating, leader:off[0].p, leaderM:off[0].m };
  },[officials,spy,period,monthBase,weekBase,livePrices,hasWeek,settings]);
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
    // GERAL (sem período): a âncora é o fecho da SESSÃO ANTERIOR — NÃO o 1º snapshot de sempre. No
    // arranque toda a gente está a ~0%, logo o ranking inicial é ruído e daria subidas de +40/+50 falsas.
    // "today" = dia do snapshot mais recente. Regra da âncora de cada membro:
    //  • mercado ABERTO e ainda sem snapshot de hoje (janela ~13:30–15:00 UTC) → o último snapshot já É o
    //    fecho de ontem → âncora = último ponto.
    //  • caso contrário (já há snapshot de hoje, ou mercado fechado) → âncora = último ponto ANTES de "today".
    let today=null;
    if(!periodStart){ for(const p of officials){ const s=seriesById[p.id]; if(s&&s.length){ const d=s[s.length-1].date; if(!today||d>today) today=d; } } }
    const cal=new Date().toISOString().slice(0,10);
    const anchorIsLast=!periodStart&&!marketClosed&&!!today&&today<cal;
    const nowOrder=[...officials].sort((a,b)=>{ const va=metricOf(a),vb=metricOf(b);
      if(va==null&&vb==null)return 0; if(va==null)return 1; if(vb==null)return -1; return vb-va; });
    const nowRank=new Map(nowOrder.map((p,i)=>[p.id,i+1]));
    const startRet=new Map(); let withHist=0;
    for(const p of officials){
      const s=seriesById[p.id]; let sr=null;
      if(s&&s.length){
        if(!periodStart){ // Geral → fecho da sessão anterior
          let pt=null;
          if(anchorIsLast){ pt=s[s.length-1]; }
          else { for(const x of s){ if(today&&x.date<today) pt=x; else break; } }
          if(pt){ sr=pt.r; withHist++; }
        } else { const first=s.find(x=>x.date>=periodStart); if(first){ sr=first.r; withHist++; } }
      }
      const m=metricOf(p);
      startRet.set(p.id, sr!=null?sr:(Number.isFinite(m)?m:0));
    }
    if(withHist<3) return null; // histórico insuficiente → não mostra
    const startOrder=[...officials].sort((a,b)=>startRet.get(b.id)-startRet.get(a.id));
    const startRank=new Map(startOrder.map((p,i)=>[p.id,i+1]));
    let best=null,worst=null; const map=new Map();
    for(const p of officials){
      const climb=startRank.get(p.id)-nowRank.get(p.id); // >0 = subiu lugares
      map.set(p.id,climb);
      if(climb>0&&(!best||climb>best.climb)) best={p,climb};
      if(climb<0&&(!worst||climb<worst.climb)) worst={p,climb};
    }
    return {best,worst,map};
  },[officials,seriesById,period,monthBase,weekBase,livePrices,hasWeek,marketClosed]);
  // Referência de dia ADAPTATIVA (Geral) — partilhada pelo widget Destaques e pelo FEED. lastSnapDay = último
  // pregão (maior date dos snapshots). {adv} p/ "subiu X lugares ___"; {ext} p/ "a maior subida ___".
  // Mercado aberto (ou fechado mas o último pregão é hoje = fim de tarde) → "hoje"/"do dia"; senão "ontem", ou o
  // dia da semana (ex.: "na sexta-feira") p/ domingo/2ª feira. Nunca "no último dia" (só fallback sem histórico).
  const _cal=new Date().toISOString().slice(0,10);
  const _yCal=new Date(Date.now()-864e5).toISOString().slice(0,10);
  let _lastSnapDay=null; for(const p of officials){ const s=seriesById[p.id]; if(s&&s.length){ const d=s[s.length-1].date; if(!_lastSnapDay||d>_lastSnapDay) _lastSnapDay=d; } }
  const dref=(!marketClosed||_lastSnapDay===_cal)?{adv:"hoje",ext:"do dia"}
    :!_lastSnapDay?{adv:"no último dia",ext:"do último dia"}
    :_lastSnapDay===_yCal?{adv:"ontem",ext:"ontem"}
    :(()=>{ const wd=new Date(_lastSnapDay+"T12:00:00Z").toLocaleDateString("pt-PT",{weekday:"long"}); return {adv:"na "+wd,ext:"na "+wd}; })();
  const dayVerb=marketClosed?"foi":"é";               // "é/foi a maior subida…"
  const climbWhen=period==="week"?"esta semana":period==="month"?"este mês":dref.adv; // lugares (Geral = dia adaptativo)
  const dayExt=dref.ext;                               // maior subida/descida do dia (sempre diário)
  // Melhores/piores AÇÕES do JOGO ATIVO (retorno da própria ação desde o baseline do período).
  const stockPerf=useMemo(()=>{
    const seen={};
    for(const p of officials) for(const s of (p.stocks||[])){
      const raw=(s.ticker||"").trim(); const t=raw.toUpperCase();
      if(t && !seen[t] && Number.isFinite(s.initialPrice) && s.initialPrice>0) seen[t]={ticker:t,raw,init:s.initialPrice,companyName:s.companyName};
    }
    const arr=Object.values(seen).map(o=>{ const base=baseForStock(o.raw,o.init); const cur=curPrice(o.raw,o.init,livePrices); return {...o,ret:(Number.isFinite(cur)&&base)?cur/base-1:0}; });
    arr.sort((a,b)=>b.ret-a.ret);
    // Piores: sem reverse → a lista piora de cima para baixo (a PIOR performance fica em baixo).
    return { best:arr.slice(0,5), worst:arr.slice(-5) };
  },[officials,livePrices,period,monthBase,weekBase]);
  const railCard=(title,children,info)=>(
    <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:14,padding:"11px 14px",boxShadow:"0 6px 20px rgba(0,0,0,0.22)"}}>
      <div style={{fontSize:10.5,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:800,marginBottom:9,display:"flex",alignItems:"center",gap:6}}>{title}{info&&<InfoTip text={info}/>}</div>
      {children}
    </div>
  );
  // Acento cromático do ranking ativo: Geral=azul, Mensal=roxo/lilás, Semanal=verde-água.
  const thA=period==="month"?"#a78bfa":period==="week"?"#2dd4bf":"#60a5fa";
  const thL=period==="month"?"#c4b5fd":period==="week"?"#5eead4":"#93c5fd";
  const thD=period==="month"?"#8b5cf6":period==="week"?"#14b8a6":"#3b82f6";
  const thRGB=period==="month"?"167,139,250":period==="week"?"45,212,191":"96,165,250";
  const mono=(v,pos)=><span style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:pos?"#4ade80":"#f87171"}}>{v}</span>;
  const hiRow=(label,p,valueEl,first)=> p?(
    <div onClick={()=>onSelect(p.key)} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"5px 0",borderTop:first?"none":"1px solid rgba(255,255,255,0.07)"}}>
      <span style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px",width:70,flexShrink:0}}>{label}</span>
      <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
      {valueEl}
    </div>
  ):null;
  const myM=myRow?metricOf(myRow):null;
  // "A tua posição" é o cartão mais pessoal da página — merece destacar-se dos restantes (hoje todos
  // partilham o mesmo fundo plano). Reaproveita a MESMA receita de gradiente+brilho do cartão de campeão
  // (fonte de consistência do sistema), tingida no acento do período ativo.
  const youFadeRGB=period==="month"?"17,12,36":period==="week"?"6,25,28":"8,14,28";
  const wYou=myRow?(
    <GlowBehind color={`rgba(${thRGB},0.55)`} mid={`rgba(${thRGB},0.18)`}>
    <div style={{position:"relative",overflow:"hidden",background:`linear-gradient(165deg,rgba(${thRGB},0.24),rgba(${youFadeRGB},0.94) 68%)`,
      border:`1px solid rgba(${thRGB},0.48)`,borderRadius:16,padding:"13px 16px",
      boxShadow:`0 14px 36px rgba(0,0,0,0.38), 0 0 36px rgba(${thRGB},0.20), inset 0 1px 0 rgba(${thRGB},0.22)`}}>
      <div style={{fontSize:10.5,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:800,marginBottom:9,display:"flex",alignItems:"center",gap:6}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:`rgba(${thRGB},0.16)`,border:`1px solid rgba(${thRGB},0.42)`,boxShadow:`0 0 10px rgba(${thRGB},0.25)`}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>
          </span>
          A tua posição
        </span>
      </div>
    <div style={{position:"relative"}}>
      <div aria-hidden="true" style={{position:"absolute",top:-11,right:-14,bottom:-11,left:-14,overflow:"hidden",borderRadius:14,pointerEvents:"none"}}>
        <svg viewBox="0 0 220 150" fill="none" style={{position:"absolute",right:-4,top:10,width:"60%",opacity:.9,
          WebkitMaskImage:"linear-gradient(to right, transparent 0%, transparent 22%, #000 40%)",maskImage:"linear-gradient(to right, transparent 0%, transparent 22%, #000 40%)"}}>
          <defs>
            <linearGradient id="wyouMtn" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={thA} stopOpacity="0.28"/>
              <stop offset="1" stopColor={thA} stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          <path d="M0 150 L52 96 Q56 91 61 96 L74 109 Q79 113 84 107 L136 41 Q143 32 150 41 L220 130 L220 150 Z" fill="url(#wyouMtn)"/>
          <path d="M0 150 L52 96 Q56 91 61 96 L74 109 Q79 113 84 107 L136 41 Q143 32 150 41 L220 130" stroke={thL} strokeOpacity="0.35" strokeWidth="1.5"/>
          <line x1="143" y1="37" x2="143" y2="5" stroke={thA} strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M143 7 L171 14.5 L143 23 Z" fill={thD}/>
        </svg>
      </div>
    <div onClick={preStartWk?undefined:scrollToMe} title={preStartWk?undefined:"Ver a minha posição no ranking"} style={{position:"relative",zIndex:1,cursor:preStartWk?"default":"pointer"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:7,marginBottom:2}}>
        <span style={{fontSize:52,fontWeight:800,letterSpacing:"-2px",lineHeight:1.05,color:"#f8fafc",textShadow:`0 0 24px rgba(${thRGB},0.55)`}}>{preStartWk?"—":myRank}</span>
        <span style={{fontSize:17,color:"#475569",fontWeight:700}}>/</span>
        <span style={{fontSize:17,color:thA,fontWeight:800}}>{stats?stats.n:officials.length}</span>
      </div>
      <div style={{fontSize:15,color:"#e2e8f0",fontWeight:600,marginBottom:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{myRow.name}</div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        {myM!=null&&(()=>{const pos=myM>=0,c=pos?"#4ade80":"#f87171";return(
          <span style={{display:"inline-flex",alignItems:"center",gap:8,fontFamily:"monospace",fontSize:15,fontWeight:800,color:c,background:pos?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)",border:`1px solid ${pos?"rgba(74,222,128,0.40)":"rgba(248,113,113,0.40)"}`,borderRadius:10,padding:"7px 14px"}}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={pos?undefined:{transform:"rotate(180deg)"}}><path d="M5 1.5 L9.2 8.5 L0.8 8.5 Z" fill={c}/></svg>{pct(myM)}
          </span>);})()}
        {!preStartWk&&myDay!=null&&<span title="Rentabilidade de hoje" style={{fontFamily:"monospace",fontSize:12.5,fontWeight:700,color:myDay>=0?"#4ade80":"#f87171",opacity:.85}}>Diário {pct(myDay)}</span>}
      </div>
      {preStartWk
        ? <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>Ranking semanal arranca 2ª feira.</div>
        : myRank===1
          ? <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>És o líder do ranking.</div>
          : <>
              <div style={{borderTop:"1px solid rgba(255,255,255,0.08)",marginBottom:10}}/>
              <div style={{display:"flex",gap:10}}>
                {[
                  {v:`${((metricOf(rankedByMetric[myRank-2])-myM)*100).toFixed(2)}%`,l:"do lugar acima",icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2.4" strokeLinecap="round"><line x1="5" y1="20" x2="5" y2="14"/><line x1="12" y1="20" x2="12" y2="9"/><line x1="19" y1="20" x2="19" y2="4"/></svg>},
                  stats&&{v:`${((stats.leaderM-myM)*100).toFixed(2)}%`,l:"do 1º lugar",icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v5a6 6 0 0 1-12 0V3z"/><path d="M6 5H3.5v1a3 3 0 0 0 3 3H6M18 5h2.5v1a3 3 0 0 1-3 3H18"/><path d="M12 14v3M8.5 21h7M10 17h4v4h-4z"/></svg>},
                ].filter(Boolean).map((s,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:9,flex:1,minWidth:0}}>
                    <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:30,height:30,borderRadius:"50%",flexShrink:0,background:`rgba(${thRGB},0.10)`,border:`1px solid rgba(${thRGB},0.30)`}}>{s.icon}</span>
                    <span style={{minWidth:0}}>
                      <span style={{display:"block",fontFamily:"monospace",fontSize:14.5,fontWeight:800,color:"#e2e8f0"}}>{s.v}</span>
                      <span style={{display:"block",fontSize:11,color:"#94a3b8"}}>{s.l}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>}
    </div>
    </div>
    </div>
    </GlowBehind>
  ):null;
  const wHi=(!preStartWk&&stats)?railCard("Destaques",(
    <div style={{marginTop:-3}}>
      {hiRow("Líder",stats.leader,mono(pct(stats.leaderM),stats.leaderM>=0),true)}
      {dayExtremes?.best&&hiRow("Subida do dia",dayExtremes.best.p,mono(pct(dayExtremes.best.day),dayExtremes.best.day>=0))}
      {dayExtremes?.worst&&dayExtremes.worst.p.id!==dayExtremes.best?.p.id&&hiRow("Queda do dia",dayExtremes.worst.p,mono(pct(dayExtremes.worst.day),dayExtremes.worst.day>=0))}
      {topClimber?.best&&hiRow("Maior subida",topClimber.best.p,<span title={`Subiu ${topClimber.best.climb} ${topClimber.best.climb===1?"lugar":"lugares"} ${climbWhen}`} style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:"#4ade80",whiteSpace:"nowrap"}}>▲ {topClimber.best.climb}</span>)}
    </div>
  )):null;
  const wVsSp=(!preStartWk&&stats)?railCard(
    <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:7,background:`rgba(${thRGB},0.12)`,border:`1px solid rgba(${thRGB},0.35)`}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>
      </span>
      Comunidade vs S&P 500
    </span>,(
    <div>
      {(()=>{const beatPct=stats.beating!=null?Math.round(stats.beating/stats.n*100):null;
        const fx=beatPct!=null?Math.min(0.999,Math.max(0.001,beatPct/100)):0.001;
        const CX=46,CY=33,H=10,RXo=34,RYo=20,RXi=18,RYi=10.5,D=Math.PI/180;
        const P=(rx,ry,a,dy=0)=>`${(CX+rx*Math.cos(a*D)).toFixed(1)} ${(CY+ry*Math.sin(a*D)+dy).toFixed(1)}`;
        const L=(s,e)=>(e-s)>180?1:0;
        const sector=(s,e)=>`M ${P(RXo,RYo,s)} A ${RXo} ${RYo} 0 ${L(s,e)} 1 ${P(RXo,RYo,e)} L ${P(RXi,RYi,e)} A ${RXi} ${RYi} 0 ${L(s,e)} 0 ${P(RXi,RYi,s)} Z`;
        const wallO=(s,e)=>`M ${P(RXo,RYo,s)} A ${RXo} ${RYo} 0 ${L(s,e)} 1 ${P(RXo,RYo,e)} L ${P(RXo,RYo,e,H)} A ${RXo} ${RYo} 0 ${L(s,e)} 0 ${P(RXo,RYo,s,H)} Z`;
        const wallI=(s,e)=>`M ${P(RXi,RYi,s)} A ${RXi} ${RYi} 0 ${L(s,e)} 1 ${P(RXi,RYi,e)} L ${P(RXi,RYi,e,H)} A ${RXi} ${RYi} 0 ${L(s,e)} 0 ${P(RXi,RYi,s,H)} Z`;
        const cut=(a)=>`M ${P(RXo,RYo,a)} L ${P(RXi,RYi,a)} L ${P(RXi,RYi,a,H)} L ${P(RXo,RYo,a,H)} Z`;
        const edge=(s,e)=>`M ${P(RXo,RYo,s)} A ${RXo} ${RYo} 0 ${L(s,e)} 1 ${P(RXo,RYo,e)}`;
        const gs=-90,ge=-90+fx*360;return(
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
        <span style={{fontSize:34,fontWeight:800,letterSpacing:"-1px",color:"#4ade80",lineHeight:1}}>{beatPct!=null?`${beatPct}%`:"—"}</span>
        <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:700,color:"#e2e8f0"}}>batem o&nbsp;mercado</div>
        <svg width="92" height="80" viewBox="0 0 92 80" style={{flexShrink:0}} aria-hidden="true">
          <defs>
            <linearGradient id="vspTop" x1="0.2" y1="0" x2="0.7" y2="1">
              <stop offset="0" stopColor="#8FF9CB"/><stop offset="0.55" stopColor="#2EEB8A"/><stop offset="1" stopColor="#25D477"/>
            </linearGradient>
            <linearGradient id="vspBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2A5288"/><stop offset="1" stopColor="#17345C"/>
            </linearGradient>
            <linearGradient id="vspGloss" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.34)"/><stop offset="0.5" stopColor="rgba(255,255,255,0)"/>
            </linearGradient>
            <filter id="vspSoft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
          </defs>
          <ellipse cx={CX} cy={CY+RYo+H+3} rx={RXo-3} ry="6" fill="rgba(46,235,138,0.20)" filter="url(#vspSoft)"/>
          <circle cx="12" cy="18" r="1.1" fill="#2EEB8A" opacity="0.5"/>
          <circle cx="82" cy="30" r="1.3" fill="#2EEB8A" opacity="0.6"/>
          <circle cx="74" cy="8" r="0.9" fill="#2EEB8A" opacity="0.4"/>
          {/* azul escuro: paredes, cortes, topo */}
          <path d={wallO(ge,270)} fill="#0F1E38"/>
          <path d={wallI(ge,270)} fill="#132A4C"/>
          <path d={cut(ge)} fill="#102544"/>
          <path d={sector(ge,270)} fill="url(#vspBlue)"/>
          <path d={edge(ge,270)} fill="none" stroke="rgba(150,190,240,0.30)" strokeWidth="1.1"/>
          {/* verde neon: paredes, cortes, topo, gloss */}
          <path d={wallO(gs,ge)} fill="#149B5A"/>
          <path d={wallI(gs,ge)} fill="#0E6B3F"/>
          <path d={cut(gs)} fill="#0E6B3F"/>
          <path d={cut(ge)} fill="#0E6B3F"/>
          <path d={sector(gs,ge)} fill="url(#vspTop)"/>
          <path d={sector(gs,ge)} fill="url(#vspGloss)"/>
          <path d={edge(gs,ge)} fill="none" stroke="rgba(190,255,220,0.55)" strokeWidth="1.2"/>
        </svg>
      </div>);})()}
      {[
        {label:"Média comunidade",v:stats.avg,icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M16 3.5a4 4 0 0 1 0 7M21.5 21v-2a4 4 0 0 0-3-3.85"/></svg>},
        {label:"S&P 500",v:stats.spyRet,icon:<span style={{fontSize:7.5,fontWeight:800,color:thA,lineHeight:1.05,textAlign:"center"}}>S&P<br/>500</span>},
      ].map((r,i)=>{const pos=(r.v??0)>=0,c=r.v==null?"#64748b":pos?"#4ade80":"#f87171";return(
        <div key={i} style={{display:"flex",alignItems:"center",gap:9,padding:"6px 0",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:24,height:24,borderRadius:"50%",flexShrink:0,background:`rgba(${thRGB},0.10)`,border:`1px solid rgba(${thRGB},0.30)`}}>{r.icon}</span>
          <span style={{flex:1,minWidth:0,fontSize:12.5,color:"#94a3b8"}}>{r.label}</span>
          {r.v==null
            ? <span style={{fontFamily:"monospace",fontWeight:800,color:"#64748b"}}>—</span>
            : <span style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:"monospace",fontSize:12.5,fontWeight:800,color:c,background:pos?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)",border:`1px solid ${pos?"rgba(74,222,128,0.30)":"rgba(248,113,113,0.30)"}`,borderRadius:8,padding:"3px 9px"}}>
                {pct(r.v)}
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{pos?<polyline points="2.5 7.5 6 4 9.5 7.5"/>:<polyline points="2.5 4.5 6 8 9.5 4.5"/>}</svg>
              </span>}
        </div>);})}
    </div>
  )):null;
  const wPicks=topPicks.length?railCard("Mais escolhidas",(
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {topPicks.map(t=>(
        <div key={t.ticker} style={{display:"flex",alignItems:"center",gap:8}}>
          <StockLogo ticker={t.ticker} size={18}/>
          <span style={{fontWeight:700,fontSize:12.5,width:50,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis"}}>{t.ticker}</span>
          <div style={{flex:1,height:6,borderRadius:999,background:"rgba(255,255,255,0.07)",overflow:"hidden",minWidth:0}}>
            <div style={{height:"100%",width:`${Math.max(5,Math.round(t.frac*100))}%`,background:"linear-gradient(90deg,#16a34a,#4ade80)",borderRadius:999}}/>
          </div>
          <span style={{fontSize:11.5,color:"#94a3b8",fontFamily:"monospace",width:30,textAlign:"right",flexShrink:0}}>{Math.round(t.frac*100)}%</span>
        </div>
      ))}
    </div>
  )):null;
  const perfRow=(o)=>{const pos=o.ret>=0,c=pos?"#4ade80":"#f87171";return(
    <div key={o.ticker} style={{display:"flex",alignItems:"center",gap:8}}>
      <HoverName label={o.companyName||o.ticker}><StockLogo ticker={o.ticker} size={17}/></HoverName>
      <span style={{fontWeight:700,fontSize:12,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.ticker}</span>
      <span style={{fontFamily:"ui-monospace, monospace",fontWeight:800,fontSize:11.5,color:c,background:pos?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)",border:`1px solid ${pos?"rgba(74,222,128,0.30)":"rgba(248,113,113,0.30)"}`,borderRadius:7,padding:"1px 7px"}}>{o.ret>=0?"+":""}{(o.ret*100).toFixed(2)}%</span>
    </div>);};
  const perfSpark=(up)=>(
    <svg viewBox="0 0 90 28" width="64" height="20" fill="none" style={{opacity:.8}} aria-hidden="true">
      <path d={up?"M2 24 Q22 23 36 18 T66 9 T88 3":"M2 4 Q22 5 36 10 T66 19 T88 25"} stroke={up?"#4ade80":"#f87171"} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round"/>
      <circle cx="88" cy={up?3:25} r="5" fill={up?"#4ade80":"#f87171"} fillOpacity="0.18"/>
      <circle cx="88" cy={up?3:25} r="2.4" fill={up?"#4ade80":"#f87171"}/>
    </svg>);
  const perfSection=(up,label,rows)=>(
    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:up?0:14}}>
      <div style={{width:96,flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:7}}>
        {perfSpark(up)}
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,borderRadius:"50%",flexShrink:0,background:up?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)",border:`1px solid ${up?"rgba(74,222,128,0.35)":"rgba(248,113,113,0.35)"}`}}><Tri up={up} size={8}/></span>
          <span style={{fontSize:10,color:up?"#4ade80":"#f87171",fontWeight:800,textTransform:"uppercase",letterSpacing:"1px"}}>{label}</span>
        </div>
      </div>
      <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:5}}>{rows.map(perfRow)}</div>
    </div>);
  const wStocks=(!preStartWk&&(stockPerf.best.length||stockPerf.worst.length))?railCard(
    <span style={{display:"inline-flex",alignItems:"center",gap:8}}>
      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:`rgba(${thRGB},0.12)`,border:`1px solid rgba(${thRGB},0.35)`}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2.4" strokeLinecap="round"><line x1="4" y1="20" x2="20" y2="20"/><line x1="7" y1="20" x2="7" y2="13"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="17" y1="20" x2="17" y2="4"/></svg>
      </span>
      Performance
    </span>,(
    <div>
      {perfSection(true,"Melhores",stockPerf.best)}
      {perfSection(false,"Piores",stockPerf.worst)}
    </div>
  ),period==="week"?"Ações escolhidas pelos membros com melhor e pior rentabilidade esta semana.":period==="month"?"Ações escolhidas pelos membros com melhor e pior rentabilidade este mês.":"Ações escolhidas pelos membros com melhor e pior rentabilidade desde o arranque da competição."):null;
  // "Últimos comentários": comentários recentes feitos em perfis de OUTROS membros (carrossel).
  const wComments=(recentComments&&recentComments.length)?(
    <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:14,padding:"9px 14px 10px",boxShadow:"0 6px 20px rgba(0,0,0,0.22)"}}>
      <div style={{fontSize:10.5,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:800,marginBottom:6}}>Últimos comentários</div>
      <RecentCommentsCard items={recentComments} onOpen={openComments}/>
    </div>
  ):null;
  // FEED (célula superior-esquerda, só no "Geral"): Notificações (o PRÓPRIO) + Atividade (comunidade).
  // Reaproveita topClimber (subidas de lugar), dayExtremes (maior subida do dia) e stockPerf (melhor ação).
  const feedIco=(t)=>{
    const sv=(p,col)=><svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke={col} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}} aria-hidden="true">{p}</svg>;
    if(t==="up")   return sv(<path d="M12 19V5M6 11l6-6 6 6"/>,"#4ade80");
    if(t==="down") return sv(<path d="M12 5v14M6 13l6 6 6-6"/>,"#f87171");
    if(t==="star") return sv(<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.5 9.2l5.9-.9z"/>,"#facc15");
    return sv(<><path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/><path d="M12 13v4M9 21h6"/></>,"#facc15"); // trophy
  };
  // climbWhen / dayExt / dayVerb / dref definidos acima (após topClimber) — partilhados com o widget Destaques.
  const feedNotifs=[];
  if(myRow&&!preStartWk){
    if(myRank===1) feedNotifs.push({t:"trophy",el:<>És o <strong style={{color:"#e2e8f0"}}>líder</strong> do Ranking Geral!</>});
    else if(myRank<=3) feedNotifs.push({t:"trophy",el:<>Estás no <strong style={{color:"#e2e8f0"}}>top 3</strong> ({myRank}º)!</>});
    else if(myRank<=10) feedNotifs.push({t:"trophy",el:<>Estás no <strong style={{color:"#e2e8f0"}}>top 10</strong> ({myRank}º).</>});
    const mc=topClimber?.map?.get(myRow.id);
    if(mc>0) feedNotifs.push({t:"up",el:<>Subiste <strong style={{color:"#e2e8f0"}}>{mc}</strong> {mc===1?"lugar":"lugares"} {climbWhen}!</>});
    else if(mc<0) feedNotifs.push({t:"down",el:<>Desceste <strong style={{color:"#e2e8f0"}}>{-mc}</strong> {(-mc)===1?"lugar":"lugares"} {climbWhen}.</>});
  }
  const feedAct=[];
  // Positivos primeiro (subida de lugares, maior subida do dia), depois negativos (descida de lugares, maior
  // descida do dia); a ação mais rentável fica no fim.
  if(topClimber?.best&&(!myRow||topClimber.best.p.id!==myRow.id)) feedAct.push({t:"up",p:topClimber.best.p,el:<><strong style={{color:"#e2e8f0"}}>{topClimber.best.p.name}</strong> subiu <strong style={{color:"#4ade80"}}>{topClimber.best.climb}</strong> {topClimber.best.climb===1?"lugar":"lugares"} {climbWhen}</>});
  if(dayExtremes?.best&&dayExtremes.best.day>0) feedAct.push({t:"up",p:dayExtremes.best.p,el:<><strong style={{color:"#e2e8f0"}}>{dayExtremes.best.p.name}</strong> {dayVerb} a maior subida {dayExt} ({pct(dayExtremes.best.day)})</>});
  if(topClimber?.worst&&topClimber.worst.climb<0&&(!myRow||topClimber.worst.p.id!==myRow.id)) feedAct.push({t:"down",p:topClimber.worst.p,el:<><strong style={{color:"#e2e8f0"}}>{topClimber.worst.p.name}</strong> desceu <strong style={{color:"#f87171"}}>{-topClimber.worst.climb}</strong> {(-topClimber.worst.climb)===1?"lugar":"lugares"} {climbWhen}</>});
  if(dayExtremes?.worst&&dayExtremes.worst.day<0&&(!dayExtremes.best||dayExtremes.worst.p.id!==dayExtremes.best.p.id)) feedAct.push({t:"down",p:dayExtremes.worst.p,el:<><strong style={{color:"#e2e8f0"}}>{dayExtremes.worst.p.name}</strong> {dayVerb} a maior descida {dayExt} ({pct(dayExtremes.worst.day)})</>});
  if(stockPerf.best&&stockPerf.best.length&&stockPerf.best[0].ret>0) feedAct.push({t:"star",el:<>A <strong style={{color:"#e2e8f0"}}>{stockPerf.best[0].ticker}</strong> é a ação mais rentável {period==="week"?"da semana":period==="month"?"do mês":"da competição"}</>});
  const feedRow=(it,i)=>{const col=it.t==="up"?"#4ade80":it.t==="down"?"#f87171":"#facc15";return(
    <div key={i} onClick={it.p?()=>onSelect(it.p.key):undefined}
      style={{display:"flex",alignItems:"center",gap:10,cursor:it.p?"pointer":"default",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"8px 10px"}}>
      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:26,height:26,borderRadius:"50%",flexShrink:0,background:`${col}1A`,border:`1px solid ${col}59`,boxShadow:`0 0 10px ${col}40`}}>{feedIco(it.t)}</span>
      <span style={{fontSize:12.5,color:"#cbd5e1",lineHeight:1.4}}>{it.el}</span>
    </div>);};
  // Cartão do FEED (moldura partilhada pelo skeleton e pelo conteúdo real → mesma largura/altura mínima,
  // por isso NÃO salta ao trocar). minHeight cobre o caso comum (1 notificação + 3 atividades).
  const feedCard=(inner)=>(
    <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:14,padding:"11px 14px",boxShadow:"0 6px 20px rgba(0,0,0,0.22)",minHeight:150,boxSizing:"border-box"}}>
      <div style={{fontSize:10.5,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:800,marginBottom:9,display:"flex",alignItems:"center",gap:8}}>
        <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:22,height:22,borderRadius:"50%",background:`rgba(${thRGB},0.12)`,border:`1px solid rgba(${thRGB},0.35)`,boxShadow:`0 0 10px rgba(${thRGB},0.30)`}}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="2.4" strokeLinecap="round"><path d="M5 11a8 8 0 0 1 8 8"/><path d="M5 4a15 15 0 0 1 15 15"/><circle cx="6" cy="18" r="1.3" fill={thA} stroke="none"/></svg>
        </span>
        Feed
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>{inner}</div>
    </div>
  );
  // O FEED depende de várias fontes assíncronas (preços, snapshots, diário) que chegam em ONDAS. Só o
  // mostramos quando os dados assentaram → aparece de uma vez, não aos poucos (e não re-centra a cada item).
  const feedReady=(!pricesLoading&&seriesLoaded&&Object.keys(livePrices||{}).length>0)||feedTimeout;
  const feedSkeleton=feedCard(<>
    <div style={{padding:"9px 10px"}}><Skeleton w="82%" h={12} r={6}/></div>
    {["92%","70%","86%"].map((w,i)=><div key={i} style={{padding:"9px 10px"}}><Skeleton w={w} h={12} r={6}/></div>)}
  </>);
  const wFeed=!feedReady
    ? feedSkeleton
    : ((feedNotifs.length||feedAct.length)?feedCard(<>
        {feedNotifs.map(feedRow)}
        {feedAct.map(feedRow)}
      </>):null);
  // "Campeão do mês" (mini-época mensal): líder ao vivo deste mês + campeões dos meses fechados
  // (recalculados on-the-fly a partir dos baselines de início de cada mês).
  const monthNameCap=(()=>{ const n=new Date().toLocaleDateString("pt-PT",{month:"long"}); return n.charAt(0).toUpperCase()+n.slice(1); })();
  // Widget do campeão parametrizado por tipo (mês OU semana) — o resto do cartão é idêntico.
  const champCfg={
    month:{ liveOf:monthOf, fmt:periodLabel, title:`Campeão de ${monthNameCap}`,
      pendHead:"Por apurar", pendSub:"Apurado no último dia do mês", emptyMsg:"Sem participantes ainda.", done:false, promoteLatest:true, wonLabel:"", listTitle:"Campeões anteriores", lastTitle:"Último campeão",
      champs:()=>{ const out=[], cur=new Date().toISOString().slice(0,7);
        for(const per of Object.keys(pastBaselines).sort()){ if(per>=cur) continue;
          const from=pastBaselines[per], to=monthCloseBase(per,pastBaselines,weekCloses,monthCloses); if(!from||!to) continue; // close_price gravado, senão início do mês seguinte, senão fecho semanal
          let best=null; for(const p of officials){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
          if(best) out.push({period:per,...best}); }
        return out.reverse(); },
      info:"Melhor rentabilidade do mês, com o ponto de partida reposto no início de cada mês.\nO campeão mensal só é apurado no último dia do mês." },
    week:{ liveOf:weekOf, fmt:weekLabel, title:`Vencedor da ${weekLabel(hasWeek?curWk:frameWk)}`,
      pendHead:"Por apurar", pendSub:"Apura 6ª feira ao fecho", emptyMsg:hasWeek?"Sem participantes ainda.":"Arranca 2ª feira.",
      done:hasWeek&&weekTradingDone(new Date()), wonLabel:`🏆 ${weekLabel(curWk)}`, listTitle:"Vencedores anteriores", lastTitle:"Último vencedor",
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
  const champCard=(kind,compact=false)=>{
    if(preLaunch||!officials.length) return null;
    const cf=champCfg[kind];
    const leaders=[...officials].map(p=>({p,m:cf.liveOf(p)})).filter(x=>x.m!=null).sort((a,b)=>b.m-a.m);
    const champs=cf.champs();
    // "ÚLTIMO vencedor/campeão": o mais recente APURADO fica SEMPRE em destaque — nunca volta a "Por apurar"
    // ao começar um novo período; só é substituído quando um novo período FECHA. Fonte por ordem:
    //  (a) período ATUAL, se o seu pregão já terminou (semanal: 6ª ao fecho, via live-frozen; mensal: fecho
    //      frozen do mês, via monthCloseBase); (b) senão, o mais recente da lista de anteriores (champs[0]).
    // A lista "anteriores" mostra os restantes (exclui o destacado só quando este vem da própria lista).
    let feat=null, featFromList=false;
    if(kind==="week"){
      if(weekTradingDone(new Date())&&leaders.length) feat={p:leaders[0].p,r:leaders[0].m,period:curWk};
    }else{
      // Campeão do mês ATUAL apurado LOGO AO FECHO do último dia útil (nunca antes), pelo líder ao vivo
      // (== fecho oficial nesse momento), sem esperar pela gravação do close_price — igual ao semanal.
      if(monthTradingDone(new Date())&&leaders.length) feat={p:leaders[0].p,r:leaders[0].m,period:curMonthYM};
    }
    if(!feat&&champs.length){ feat={p:champs[0].p,r:champs[0].r,period:champs[0].period}; featFromList=true; }
    const listChamps=featFromList?champs.slice(1):champs;
    const prom=feat?{p:feat.p,r:feat.r,label:cf.fmt(feat.period)}:null;
    const cardTitle=feat?cf.lastTitle:cf.title;
    const champRows=(style)=>(listChamps.length>0&&(
      <div style={style}>
        <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px",marginBottom:compact?4:6}}>{cf.listTitle}</div>
        {listChamps.slice(0,compact?3:4).map(c=>(
          <div key={c.period} onClick={()=>c.p.key&&onSelect(c.p.key)} title={c.p.key?"Ver portefólio":undefined} style={{cursor:c.p.key?"pointer":"default",display:"flex",justifyContent:"space-between",gap:8,padding:compact?"2.5px 0":"4px 0",fontSize:compact?11.5:12.5}}>
            <span style={{color:"#94a3b8",textTransform:"capitalize",flexShrink:0}}>{cf.fmt(c.period)}</span>
            <span style={{color:"#e2e8f0",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"right"}}>{c.p.name}</span>
            <span style={{fontFamily:"monospace",fontWeight:800,color:c.r==null?"#64748b":c.r>=0?"#4ade80":"#f87171",flexShrink:0}}>{c.r==null?"—":pct(c.r)}</span>
          </div>
        ))}
      </div>
    ));
    if(prom){
      const hasRet=Number.isFinite(prom.r), pos=!hasRet||prom.r>=0;
      const retColor=hasRet?(pos?"#4ade80":"#f87171"):"#64748b";
      const accent=kind==="week"?"#34d399":"#a78bfa";
      const accentRGB=kind==="week"?"52,211,153":"167,139,250";
      // Cor do fundo para onde o fade escurece em baixo: verde-escuro no semanal, roxo/lilás escuro no mensal.
      const fadeRGB=kind==="week"?"6,25,28":"17,12,36";
      return(
        <div style={{background:`linear-gradient(180deg,rgba(${accentRGB},0.11),rgba(${fadeRGB},0.88) 72%)`,border:`1px solid rgba(${accentRGB},0.26)`,borderRadius:18,boxShadow:`0 10px 30px rgba(0,0,0,0.32), inset 0 1px 0 rgba(${accentRGB},0.12)`}}>
          <div style={{padding:compact?"11px 13px 12px":"14px 14px 18px"}}>
            <div style={{fontSize:compact?10:10.5,color:"#a8b4c5",textTransform:"uppercase",letterSpacing:"1.25px",fontWeight:800,marginBottom:compact?8:12,display:"flex",alignItems:"center",justifyContent:"center",gap:7,textAlign:"center"}}>
              {cardTitle}<InfoTip text={cf.info}/>
            </div>
            <div onClick={()=>prom.p.key&&onSelect(prom.p.key)} title={prom.p.key?"Ver portefólio":undefined}
              style={{cursor:prom.p.key?"pointer":"default",display:compact?"grid":"flex",...(compact?{gridTemplateColumns:"auto 1fr",alignItems:"center",gap:"2px 12px"}:{flexDirection:"column",alignItems:"center",textAlign:"center",gap:9})}}>
              {compact?(<>
                <div style={{gridRow:"1 / span 3",position:"relative",width:52,height:52,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <span aria-hidden="true" style={{position:"absolute",width:46,height:46,borderRadius:"50%",background:"rgba(250,204,21,0.17)",filter:"blur(12px)"}}/>
                  <GoldGlow src="/cup.webp" alt="" maskSrc="/cup.webp" glow={16} wrapStyle={{width:50,position:"relative"}} imgStyle={{width:"100%",height:"auto",objectFit:"contain"}} baseFilter="drop-shadow(0 6px 10px rgba(0,0,0,0.38)) drop-shadow(0 0 9px rgba(250,204,21,0.28))"/>
                </div>
                <span style={{justifySelf:"start",color:accent,background:`rgba(${accentRGB},0.10)`,border:`1px solid rgba(${accentRGB},0.42)`,borderRadius:8,padding:"3px 9px",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".7px"}}>{prom.label}</span>
                <div style={{fontSize:17,fontWeight:800,color:"#f8fafc",lineHeight:1.1,letterSpacing:"-.3px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{prom.p.name}</div>
                <span style={{justifySelf:"start",display:"inline-flex",alignItems:"center",gap:6,fontFamily:"monospace",fontSize:13.5,fontWeight:900,color:retColor,background:hasRet?(pos?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)"):"rgba(100,116,139,0.10)",border:`1px solid ${hasRet?(pos?"rgba(74,222,128,0.38)":"rgba(248,113,113,0.38)"):"rgba(100,116,139,0.35)"}`,borderRadius:9,padding:"4px 9px"}}>
                  {hasRet&&<svg width="8" height="8" viewBox="0 0 10 10" style={pos?undefined:{transform:"rotate(180deg)"}}><path d="M5 1.5 L9.2 8.5 L0.8 8.5 Z" fill={retColor}/></svg>}{hasRet?pct(prom.r):"—"}
                </span>
              </>):(<>
              <span style={{color:accent,background:`rgba(${accentRGB},0.10)`,border:`1px solid rgba(${accentRGB},0.42)`,borderRadius:9,padding:"5px 12px",fontSize:11.5,fontWeight:900,textTransform:"uppercase",letterSpacing:".8px",boxShadow:`0 0 16px rgba(${accentRGB},0.10)`}}>{prom.label}</span>
              <div style={{position:"relative",height:108,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span aria-hidden="true" style={{position:"absolute",width:84,height:84,borderRadius:"50%",background:"rgba(250,204,21,0.17)",filter:"blur(17px)"}}/>
                <GoldGlow src="/cup.webp" alt="" maskSrc="/cup.webp" glow={22}
                  wrapStyle={{width:86,position:"relative"}}
                  imgStyle={{width:"100%",height:"auto",objectFit:"contain"}}
                  baseFilter="drop-shadow(0 8px 14px rgba(0,0,0,0.38)) drop-shadow(0 0 11px rgba(250,204,21,0.28))"/>
              </div>
              <div style={{maxWidth:150,fontSize:23,fontWeight:800,color:"#f8fafc",lineHeight:1.08,letterSpacing:"-.35px",textWrap:"balance",overflowWrap:"anywhere"}}>{prom.p.name}</div>
              <span style={{display:"inline-flex",alignItems:"center",gap:7,fontFamily:"monospace",fontSize:16,fontWeight:900,color:retColor,background:hasRet?(pos?"rgba(74,222,128,0.10)":"rgba(248,113,113,0.10)"):"rgba(100,116,139,0.10)",border:`1px solid ${hasRet?(pos?"rgba(74,222,128,0.38)":"rgba(248,113,113,0.38)"):"rgba(100,116,139,0.35)"}`,borderRadius:10,padding:"6px 11px",boxShadow:hasRet?`0 0 16px ${pos?"rgba(74,222,128,0.08)":"rgba(248,113,113,0.08)"}`:"none"}}>
                {hasRet&&<svg width="9" height="9" viewBox="0 0 10 10" style={pos?undefined:{transform:"rotate(180deg)"}}><path d="M5 1.5 L9.2 8.5 L0.8 8.5 Z" fill={retColor}/></svg>}{hasRet?pct(prom.r):"—"}
              </span>
              </>)}
            </div>
          </div>
          {champRows({borderTop:`1px solid rgba(${accentRGB},0.14)`,background:`rgba(${accentRGB},0.055)`,borderRadius:"0 0 18px 18px",padding:compact?"9px 13px 11px":"12px 14px 14px"})}
        </div>
      );
    }
    return railCard(cardTitle,(
      <div>
        {leaders.length?(
          // Em curso: o vencedor só é apurado no fim do período. Sem líder à vista → mais suspense.
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="#94a3b8" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}>
              <path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>
            </svg>
            <div style={{minWidth:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"#e2e8f0",lineHeight:1.15}}>{cf.pendHead}</div>
              <div style={{fontSize:10.5,color:"#94a3b8"}}>{cf.pendSub}</div>
            </div>
          </div>
        ):<div style={{fontSize:12.5,color:"#94a3b8"}}>{cf.emptyMsg}</div>}
        {champRows({marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8})}
      </div>
    ),cf.info);
  };
  // Context-aware: segue o toggle; em "Geral" mostra o do mês (mini-época principal).
  // (Os dois cards empilhados/compactos ficam preparados no champCard mas ainda não usados — a rever.)
  const wChamp=champCard(period==="week"?"week":"month");
  // Cartão de vencedor do período HISTÓRICO selecionado (substitui o wChamp em modo histórico).
  const wChampHist=histActive?railCard(`Vencedor · ${histLabel}`,(
    histTop.length?(
      <div>
        <div onClick={()=>histTop[0].p.key&&onSelect(histTop[0].p.key)} title="Ver portefólio" style={{cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24,lineHeight:1}}>🏆</span>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:9.5,color:"#facc15",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px"}}>{histLabel}</div>
            <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{histTop[0].p.name}</div>
          </div>
          <span style={{fontFamily:"monospace",fontSize:13,fontWeight:800,color:histTop[0].r>=0?"#4ade80":"#f87171",flexShrink:0}}>{pct(histTop[0].r)}</span>
        </div>
        {histTop.length>1&&(
          <div style={{marginTop:10,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8}}>
            <div style={{fontSize:10,color:"#64748b",fontWeight:800,textTransform:"uppercase",letterSpacing:".4px",marginBottom:6}}>Pódio</div>
            {histTop.slice(1,3).map(({p,r},i)=>(
              <div key={p.key} onClick={()=>onSelect(p.key)} title="Ver portefólio" style={{cursor:"pointer",display:"flex",justifyContent:"space-between",gap:8,padding:"4px 0",fontSize:12.5}}>
                <span style={{color:"#94a3b8",flexShrink:0}}>{i+2}º</span>
                <span style={{color:"#e2e8f0",fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,textAlign:"right"}}>{p.name}</span>
                <span style={{fontFamily:"monospace",fontWeight:800,color:r>=0?"#4ade80":"#f87171",flexShrink:0}}>{pct(r)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ):<div style={{fontSize:12.5,color:"#94a3b8"}}>Sem dados para este período.</div>
  ),period==="week"?"Vencedor da semana (2ª→6ª), apurado ao fecho de 6ª feira.":"Campeão do mês, apurado no fim do mês."):null;
  // Medalhão decorativo de vencedor à ESQUERDA do gráfico (espelha o campeão da direita). Só nas
  // mini-épocas: Mensal → "Vencedor do Mês"; Semanal → "Vencedor da Semana". No "Geral" não há
  // medalhão (não é uma época com vencedor apurado). Só visual (não clicável).
  const badgeSrc=period==="week"?"/cdi-semana-winner.webp":"/cdi-mensal-winner.webp";
  const wBadge=period==="total"?null:(
    // key={period} → remonta ao trocar de aba (Mensal↔Semanal) para a entrada "autocolante" repetir.
    // Estrutura: .cdiHolo (entrada + sombra) > .cdiHolo__inner (interação hover) > img + camadas.
    <div className="cdiHolo" key={period}>
      <div className="cdiHolo__inner">
        <img className="cdiHolo__img"
          src={badgeSrc}
          alt={period==="week"?"Vencedor da semana":"Vencedor do mês"}
          draggable={false} width={454} height={531}/>
        {/* Efeito holograma: gradiente especular em color-dodge, mascarado pela luminância do PRÓPRIO
            medalhão (substitui o "spec map" do exemplo) em multiply. Puramente decorativo. */}
        <div className="cdiHolo__spec" aria-hidden="true"
          style={{WebkitMaskImage:`url(${badgeSrc})`,maskImage:`url(${badgeSrc})`}}>
          <div className="cdiHolo__mask" style={{backgroundImage:`url(${badgeSrc})`}}/>
        </div>
        {/* Brilho estilo badge do pódio (risca diagonal branca a varrer), recortado à silhueta.
            Arranca depois da entrada (delay) e volta a passar em loop; acelera no hover. */}
        <div className="cdiHolo__shine" aria-hidden="true"
          style={{WebkitMaskImage:`url(${badgeSrc})`,maskImage:`url(${badgeSrc})`}}/>
      </div>
    </div>
  );
  const leftRail=<>{wYou}{wStocks}{wComments}</>;
  // Botão 1v1 no FUNDO do rail direito (por baixo de "Mais escolhidas"). No desktop mora aqui; em
  // mobile/tablet (rail escondido) mora no cabeçalho — ver .rkHeadV1 + o media query que o esconde >1439px.
  const wV1=ranking.length>=2?(
    <div style={{display:"flex",justifyContent:"center"}}>
      <button onClick={()=>{ setCmp(v=>!v); setSel([]); }}
        style={{cursor:"pointer",fontSize:14,fontWeight:700,borderRadius:999,padding:"9px 40px",letterSpacing:".3px",transition:"all .15s",
          color:cmp?"#0a0a0a":"#cbd5e1",background:cmp?"#3b82f6":"rgba(255,255,255,0.06)",
          border:`1px solid ${cmp?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.12)"}`}}
        onMouseEnter={e=>{ if(!cmp) e.currentTarget.style.background="rgba(255,255,255,0.10)"; }}
        onMouseLeave={e=>{ if(!cmp) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}>1v1</button>
    </div>
  ):null;
  // O campeão sai do rail direito e vai, isolado, para a linha do cabeçalho (célula .railChamp).
  // Os restantes ficam no rail direito (.railR), à altura da tabela; o 1v1 fecha o rail em baixo.
  const rightRail=<>{wVsSp}{wHi}{wPicks}{wV1}</>;
  // Tabela histórica: só o Top 10 do período fechado (rentab. do período; sem Diário/🟢🔴/sparkline,
  // que são de "hoje"). Reaproveita a grelha .rkRow para alinhar com o resto.
  const histTableEl=()=>(
    <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"clip"}}>
      <div style={{padding:"12px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <span style={{fontSize:12,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:".5px"}}>Top 10 — {histLabel}</span>
        <span style={{fontSize:11,color:"#64748b"}}>período fechado</span>
      </div>
      {histTop.length===0
        ? <div style={{padding:"28px 20px",textAlign:"center",color:"#64748b",fontSize:13}}>Sem dados para este período.</div>
        : histTop.map(({p,r},idx)=>{
            const barColor=idx<3?["#facc15","#e2e8f0","#d97706"][idx]:idx<10?"#22c55e":null;
            return(
              <div key={p.key} onClick={()=>onSelect(p.key)} className="rkRow rkDataRow"
                style={{padding:"14px 20px",borderBottom:"1px solid rgba(255,255,255,0.10)",cursor:"pointer",background:"transparent",
                  boxShadow:barColor?`inset 3px 0 0 ${barColor}`:"none",transition:"background 0.15s"}}
                onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.05)"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background="transparent"; }}>
                <span style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {idx<3
                    ? <span className="rankShine rankBreathe" style={{width:22,height:22,borderRadius:"50%",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0,...RANK_BADGE[idx+1],"--shine-delay":`${idx*1.2}s`}}>{idx+1}</span>
                    : <span style={{fontSize:13,color:"#94a3b8",fontWeight:700}}>{idx+1}</span>}
                </span>
                <span style={{fontWeight:600,fontSize:"clamp(11.5px,3.1vw,15px)",display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                  <span style={{minWidth:0,overflowWrap:"normal",wordBreak:"normal",lineHeight:1.2}}>{p.name}</span>
                  {idx===0&&<span title="Vencedor" style={{fontSize:14,lineHeight:1,flexShrink:0}}>🏆</span>}
                  {winners&&winners[p.key]&&<span style={{display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}><WinnerMedals w={winners[p.key]} size={20}/></span>}
                  {p.normName===myNorm&&<span style={{flexShrink:0,fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",borderRadius:999,padding:"2px 8px",fontWeight:700}}>Tu</span>}
                </span>
                <span className="rkSpark"/>
                <span style={{textAlign:"center",alignSelf:"center",fontWeight:800,fontFamily:"monospace",fontSize:"clamp(12.5px,3.6vw,15px)",color:r>=0?"#4ade80":"#f87171"}}>{pct(r)}</span>
                <span style={{textAlign:"center",alignSelf:"center",color:"#4b5563"}}>—</span>
                <span style={{textAlign:"center",alignSelf:"center",color:"#4b5563"}}>—</span>
                <span className="rkHide" style={{display:"flex",alignItems:"center",justifyContent:"flex-start",gap:2,flexWrap:"nowrap",overflow:"hidden"}}>
                  {(p.stocks||[]).map(s=>({s,rr:histFromTo?pfPeriodRet({stocks:[s]},histFromTo.from,histFromTo.to):null})).sort((a,b)=>(b.rr??-9)-(a.rr??-9)).map(({s,rr})=>(
                    <HoverName key={s.ticker} label={`${s.companyName||s.ticker}${rr!=null?` · ${pct(rr)}`:""}`}><StockLogo ticker={s.ticker} size={16}/></HoverName>
                  ))}
                </span>
              </div>
            );
          })}
    </div>
  );

  return(
    <div style={{maxWidth:1520,margin:"0 auto",padding:"40px 20px 120px","--rk-name-w":`${nameW}px`}}>
      <style>{`
        /* Coluna do nome = largura FIXA do nome mais comprido (--rk-name-w, medido em runtime) →
           todas as linhas alinhadas e as sparklines (1fr) começam todas no mesmo sítio, colado ao
           maior nome. Fallback 190px enquanto não mede. */
        .rkPodium{display:grid;grid-template-columns:1fr 1.22fr 1fr;gap:clamp(4px,1.6vw,18px);align-items:end;margin:6px 0 clamp(-28px,-1.8vw,-14px);padding:0 clamp(0px,1vw,10px)}
        .rkPodium + div{position:relative;z-index:2}  /* a tabela fica POR CIMA da base das moedas (as moedas surgem por trás dela) */
        .rkPodCol{position:relative;display:flex;flex-direction:column;align-items:center;min-width:0;cursor:pointer;outline:none;text-align:center}
        /* Destaque ao voltar de um portefólio: brilho na cor do lugar que se desvanece (o flash azul retangular das linhas não serve aqui) */
        @keyframes rkPodGlow{0%{filter:drop-shadow(0 0 16px rgba(var(--pod),0.95)) drop-shadow(0 0 4px rgba(var(--pod),0.9))}100%{filter:drop-shadow(0 0 0 rgba(var(--pod),0))}}
        .rkPodCol.rkHiFlash{animation:rkPodGlow 2.2s ease-out}
        /* Hover/foco: a bola salta com mola, os louros abrem, as moedas acendem e a rentabilidade cresce */
        .rkPodBall{transition:transform .38s cubic-bezier(.34,1.56,.64,1)}
        .rkPodLaurel{transition:transform .45s cubic-bezier(.34,1.56,.64,1),filter .3s ease}
        .rkPodStack svg{transition:filter .3s ease}
        .rkPodPlaque{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}
        .rkPodName{transition:transform .35s cubic-bezier(.34,1.56,.64,1),filter .3s ease}
        .rkPodCol:hover .rkPodBall,.rkPodCol:focus-visible .rkPodBall{transform:translateY(-9px) scale(1.07)}
        .rkPodCol:hover .rkPodLaurel,.rkPodCol:focus-visible .rkPodLaurel{transform:translate(-50%,-69%) scale(1.14);filter:drop-shadow(0 3px 5px rgba(0,0,0,0.4)) drop-shadow(0 0 14px rgba(var(--pod),0.65))}
        .rkPodCol:hover .rkPodStack svg,.rkPodCol:focus-visible .rkPodStack svg{filter:drop-shadow(0 10px 14px rgba(0,0,0,0.45)) drop-shadow(0 0 16px rgba(var(--pod),0.55)) brightness(1.12)}
        .rkPodCol:hover .rkPodPlaque,.rkPodCol:focus-visible .rkPodPlaque{transform:translateX(-50%) scale(1.06)}
        .rkPodCol:hover .rkPodName,.rkPodCol:focus-visible .rkPodName{transform:translateY(-5px) scale(1.07);filter:drop-shadow(0 0 8px rgba(var(--pod),0.8))}
        .rkPodCol:focus-visible .rkPodStack{outline:2px solid rgba(var(--pod),0.8);outline-offset:4px;border-radius:14px}
        .rkPodName{margin-bottom:2px;display:flex;align-items:center;justify-content:center;gap:6px;max-width:100%;font-weight:800;font-size:clamp(12.5px,3.2vw,16px);color:#f1f5f9}
        .rkPodNameTx{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:2px 0}
        .rkPod1 .rkPodName{font-size:clamp(14px,3.6vw,19px)}
        .rkPodYou{flex-shrink:0;font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;background:rgba(var(--pod),0.25);border:1px solid rgba(var(--pod),0.6);color:#fff}
        .rkPodBallWrap{position:relative;display:flex;justify-content:center;margin:clamp(24px,4vw,36px) 0 calc(clamp(34px,7vw,52px) / -2.2)}
        .rkPod1 .rkPodBallWrap{margin-top:clamp(34px,5.6vw,50px);margin-bottom:calc(clamp(42px,9vw,64px) / -2.2)}
        .rkPodLaurel{position:absolute;left:50%;top:50%;width:calc(clamp(34px,7vw,52px) * 1.9);height:calc(clamp(34px,7vw,52px) * 1.9);overflow:visible;transform:translate(-50%,-69%);clip-path:inset(-15% -15% 17% -15%);pointer-events:none;z-index:0;filter:drop-shadow(0 3px 5px rgba(0,0,0,0.4)) drop-shadow(0 0 8px rgba(var(--pod),0.3))}
        .rkPod1 .rkPodLaurel{width:calc(clamp(42px,9vw,64px) * 1.9);height:calc(clamp(42px,9vw,64px) * 1.9)}
        .rkPodBall{position:relative;z-index:3;margin:0;width:clamp(34px,7vw,52px);aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;
          background:radial-gradient(circle at 32% 26%,#fff 0%,rgba(var(--pod),1) 28%,rgba(var(--pod),0.78) 62%,rgba(0,0,0,0.55) 100%);
          box-shadow:0 10px 12px -2px rgba(0,0,0,0.45),0 0 14px rgba(var(--pod),0.35),inset 0 -4px 8px rgba(0,0,0,0.35),inset 0 2px 3px rgba(255,255,255,0.7)}
        .rkPod1 .rkPodBall{width:clamp(42px,9vw,64px)}
        .rkPodBallIn{width:56%;aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:clamp(13px,3vw,20px);color:#1e293b;
          background:radial-gradient(circle at 40% 30%,#fff,#e2e8f0 70%,#cbd5e1);box-shadow:inset 0 1px 3px rgba(0,0,0,0.3)}
        .rkPod1 .rkPodNum{display:block;transform:translateX(-0.035em)}  /* o "1" ligeiramente para a esquerda do centro do disco */
        .rkPod1 .rkPodBallIn{background:radial-gradient(circle at 40% 30%,#fff7d6,#fde68a 70%,#f59e0b);color:#451a03;font-size:clamp(16px,3.8vw,26px)}
        .rkPodLogos{display:flex;align-items:center;justify-content:center;gap:4px;margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,0.10)}
        .rkPodStack{position:relative;z-index:1;width:100%}
        .rkPodStack svg{display:block;width:100%;height:auto;overflow:visible;filter:drop-shadow(0 10px 14px rgba(0,0,0,0.45))}
        .rkPodPlaque{position:absolute;left:50%;bottom:clamp(30px,2.4vw,40px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;max-width:64%;box-sizing:border-box;
          padding:7px 13px 8px;border-radius:14px;background:rgba(8,14,30,0.74);border:1px solid rgba(var(--pod),0.4);box-shadow:0 6px 16px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.08);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
        .rkPodVal{font-variant-numeric:tabular-nums;font-weight:800;letter-spacing:-.2px;font-size:clamp(13px,3.4vw,22px);white-space:nowrap}
        .rkPod1 .rkPodVal{font-size:clamp(15px,4.2vw,28px)}
        .rkPodDay{margin-top:2px;font-variant-numeric:tabular-nums;font-size:clamp(9.5px,2.3vw,12.5px);font-weight:600;white-space:nowrap}
        .rkPodDay em{font-style:normal;font-weight:600;color:#94a3b8;margin-left:2px}
        .rkPodStat{display:none}
        @media(max-width:560px){.rkPodPlaque{display:none}.rkPodStat{display:flex;flex-direction:column;align-items:center;margin-top:1px}.rkPodStat .rkPodVal{font-size:clamp(13px,3.9vw,16px)}.rkPod1 .rkPodStat .rkPodVal{font-size:clamp(16px,4.9vw,21px)}.rkPodStat .rkPodDay{font-size:clamp(9.5px,2.6vw,11px)}.rkPodBallWrap{margin-top:clamp(26px,6.4vw,36px)!important}.rkPod1 .rkPodBallWrap{margin-top:clamp(32px,7.8vw,44px)!important}}
        @media(prefers-reduced-motion:reduce){.rkPodCol,.rkPodBall,.rkPodLaurel,.rkPodStack svg,.rkPodPlaque,.rkPodName{transition:none!important}.rkPodCol:hover .rkPodBall,.rkPodCol:hover .rkPodName{transform:none}.rkPodCol:hover .rkPodLaurel{transform:translate(-50%,-69%)}.rkPodCol:hover .rkPodPlaque{transform:translateX(-50%)}}
        .rkRow{display:grid;grid-template-columns:28px calc(var(--rk-name-w,190px) + 32px) 1fr 72px 72px 56px 150px;gap:8px}
        /* NOTA: já NÃO usamos content-visibility:auto nas linhas. Com sparkline em SVG leve (não Recharts)
           as ~124 linhas pintam bem de uma vez; o content-visibility fazia as linhas aparecerem EM BRANCO
           ao fazer scroll (o browser só as pintava ao entrar no ecrã). .rkNoCV fica como no-op inofensivo. */
        .rkSpark{display:flex;align-items:center;align-self:center;height:24px;overflow:hidden;min-width:0}
        .rkNarrowHd{display:none}   /* cabeçalhos simples #/Membro: só aparecem no mobile */
        @keyframes rkHiFlash{0%{background-color:rgba(59,130,246,0.30)}60%{background-color:rgba(59,130,246,0.15)}100%{background-color:rgba(59,130,246,0)}}
        .rkHiFlash{animation:rkHiFlash 2.6s ease-out}
        /* Toolbar do ranking pinada no topo ao fazer scroll — SÓ desktop (>1000px).
           Vidro fosco na cor do tema (--cdi-panel) + blur forte: as linhas passam por
           baixo desfocadas e a barra não fica mais escura (usa o tom do próprio tema). */
        @media(min-width:1001px){
          .rkStickyHead{position:sticky;top:71px;z-index:15;
            background:var(--cdi-panel,rgba(26,41,74,0.9));
            backdrop-filter:blur(42px) saturate(180%);-webkit-backdrop-filter:blur(42px) saturate(180%)}
        }
        /* Grelha de 2 LINHAS: linha 1 = cabeçalho (centro) + campeão (direita, à altura do 1v1);
           linha 2 = rail esquerdo + tabela + rail direito (widgets onde sempre estiveram). */
        .rkLayout{display:grid;grid-template-columns:minmax(240px,1fr) minmax(0,900px) minmax(240px,1fr);
          grid-template-rows:auto auto;grid-template-areas:"badge hdr champ" "left tbl rail";
          column-gap:16px;row-gap:0;align-items:start;justify-content:center}
        .cHeader{grid-area:hdr;min-width:0}
        .rkCenter{grid-area:tbl;min-width:0}
        .rkRail{position:sticky;top:84px;display:flex;flex-direction:column;gap:12px}
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
        /* .cdiHolo = camada externa: isolamento do blend + sombra + ENTRADA "cunhagem" (stamp). */
        .cdiHolo{position:relative;display:block;width:100%;max-width:240px;margin:0 auto;isolation:isolate;
          backface-visibility:hidden;filter:drop-shadow(0 10px 26px rgba(0,0,0,0.5));transition:filter .28s ease;
          transform-origin:center;animation:cdiStamp .5s cubic-bezier(.2,.9,.25,1) both}
        /* Entrada "cunhagem": entra grande e translúcido, encolhe e CRAVA com um ligeiro ressalto. */
        @keyframes cdiStamp{
          0%{opacity:0;transform:scale(1.35)}
          50%{opacity:1;transform:scale(.95)}   /* impacto: compressão abaixo do tamanho final */
          72%{transform:scale(1.03)}            /* ressalto */
          100%{opacity:1;transform:scale(1)}
        }
        .cdiHolo:hover{filter:drop-shadow(0 18px 34px rgba(0,0,0,0.58))}
        /* .cdiHolo__inner = camada de INTERAÇÃO: no hover o autocolante "descola" (inclina 3D + sobe),
           sem colidir com o transform da entrada (que fica na camada externa). */
        .cdiHolo__inner{position:relative;display:block;transform-origin:72% 28%;
          transition:transform .28s cubic-bezier(.2,.7,.3,1);will-change:transform}
        .cdiHolo:hover .cdiHolo__inner{transform:perspective(760px) rotateX(7deg) rotateY(-9deg) translateY(-4px) scale(1.035)}
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
        /* Brilho do pódio (1º/2º/3º): risca diagonal branca a varrer, recortada à silhueta do medalhão.
           Delay ≈ duração da entrada → só brilha "depois de estar colado"; no hover fica mais rápido. */
        .cdiHolo__shine{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;
          background-image:linear-gradient(115deg,transparent 42%,rgba(255,255,255,0.6) 50%,transparent 58%);
          background-repeat:no-repeat;background-size:220% 100%;background-position:-30% 0;
          -webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
          -webkit-mask-position:center;mask-position:center;
          mix-blend-mode:screen;animation:cdiStickerShine 4.2s ease-in-out .82s infinite}
        .cdiHolo:hover .cdiHolo__shine{animation-duration:1.6s}
        @keyframes cdiStickerShine{0%{background-position:-30% 0}55%,100%{background-position:130% 0}}
        @media(prefers-reduced-motion:reduce){.cdiHolo__spec,.cdiHolo__shine{animation:none}.cdiHolo{animation:none}.cdiHolo__inner{transition:none}}
        /* Cartão do cabeçalho (ícone+título · toggle · 1v1, com a "pill row" de info por baixo). Em
           telemóvel o flex-wrap do próprio elemento (inline style) já empilha ícone+título / toggle+1v1
           sem precisar de grid-template-areas; aqui só afinamos espaçamentos/tamanhos no estreito. */
        @media(max-width:560px){
          .rkHeadTitle{white-space:normal!important}
        }
        @media(max-width:1439px){
          .rkLayout{grid-template-columns:minmax(0,900px);grid-template-areas:"hdr" "tbl";justify-content:center}
          .rkRail,.railChamp,.railBadge{display:none}
        }
        /* Desktop largo: o 1v1 mora no rail direito (por baixo de "Mais escolhidas") → esconde o do
           cabeçalho. Em ≤1439px o rail desaparece e o 1v1 do cabeçalho reaparece (única cópia visível). */
        @media(min-width:1440px){ .rkHeadV1{display:none} }
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
      {/* "Geral": a célula (livre) recebe o FEED; nos outros períodos, o medalhão do vencedor. Ambos
          passam pelo mesmo wrapper (badgeStickyRef + badgeTop) → ficam CENTRADOS à altura do gráfico. */}
      <aside className="railBadge" ref={railBadgeRef} style={railH!=null?{height:railH}:undefined}>
        <div ref={badgeStickyRef} style={{marginTop:badgeTop}}>{period==="total"?wFeed:wBadge}</div>
      </aside>
      <aside className="rkRail railL">{histActive?null:leftRail}</aside>
      <aside className="railChamp" ref={railChampRef} style={railH!=null?{height:railH}:undefined}><div ref={champStickyRef} style={{marginTop:champTop}}>{histActive?wChampHist:wChamp}</div></aside>
      <div className="cHeader">
      <div className="rkHeadCard" style={{position:"relative",marginBottom:26}}>
        <div className="rkHeadTop" style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap",rowGap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:14,minWidth:0}}>
            <span aria-hidden="true" style={{width:50,height:50,borderRadius:15,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
              background:`linear-gradient(155deg,rgba(${thRGB},0.38),rgba(${thRGB},0.10))`,
              border:`1px solid rgba(${thRGB},0.55)`,
              boxShadow:`0 0 18px rgba(${thRGB},0.30), inset 0 1px 0 rgba(255,255,255,0.14)`}}>
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={thL} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 20V13M12 20V7M19 20V4"/>
              </svg>
            </span>
            <h1 className="rkHeadTitle" style={{fontSize:"clamp(21px,2.6vw,29px)",fontWeight:800,letterSpacing:"-0.5px",margin:0,color:"#f8fafc",whiteSpace:"nowrap"}}>
              {period==="week"?"Ranking Semanal":period==="month"?"Ranking Mensal":"Ranking Geral"}
            </h1>
          </div>
          <div style={{position:"relative",display:"flex",alignItems:"center",gap:10}}>
            {(hasMonth||hasWeek)&&!preLaunch?(
              <PeriodToggle period={period} setPeriod={setPeriod} accentL={thL} accentD={thD} accentRGB={thRGB}/>
            ):<span className="rkHeadToggle" aria-hidden="true"/>}
            {ranking.length>=2?(
              <button className="rkHeadV1" onClick={()=>{ setCmp(v=>!v); setSel([]); }}
                style={{cursor:"pointer",fontSize:13,fontWeight:700,borderRadius:999,padding:"9px 16px",
                  color:cmp?"#0a0a0a":"#cbd5e1",background:cmp?"#3b82f6":"rgba(255,255,255,0.06)",
                  border:`1px solid ${cmp?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.12)"}`}}>1v1</button>
            ):<span className="rkHeadV1" aria-hidden="true"/>}
          </div>
        </div>
        {(()=>{
          const calIcon=<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></>;
          const clockIcon=<><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.2 1.8"/></>;
          const liveIcon=<><path d="M3 16l5.5-6 4 4L21 6"/><path d="M15 6h6v6"/></>;
          const checkIcon=<><circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.5 2.5 4.7-5.2"/></>;
          const seg1Icon=histActive?calIcon:(period==="total"?liveIcon:calIcon);
          const seg1Text=histActive
            ? <>{histLabel} · {period==="week"
                ? `${new Date(histWindow.periodStart+"T00:00:00Z").toLocaleDateString("pt-PT",{day:"2-digit",month:"2-digit"})}–${new Date(histWindow.periodEnd+"T00:00:00Z").toLocaleDateString("pt-PT",{day:"2-digit",month:"2-digit"})}`
                : "mês fechado"}{histSeedWk?" · semana de arranque (4ª→6ª)":""}</>
            : <>{period==="week"?"Início 2ª feira (abertura) a 6ª feira (fecho)":period==="month"?"Início no primeiro dia do mês até ao último":"Classificação por rentabilidade total, em tempo real"}
              {period==="total"&&<>{" · "}{officials.length} {officials.length===1?"participante":"participantes"}</>}</>;
          const seg2Icon=histActive?checkIcon:clockIcon;
          const seg2Text=histActive
            ? "Resultados finais"
            : (pricesLoading?"A atualizar preços…":((pricesAsOf||pricesAt)?`Atualizado ${new Date(pricesAsOf||pricesAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}`:null));
          const pillIcon=(path)=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={thL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}>{path}</svg>;
          return(
            <div className="rkHeadPills" style={{position:"relative",display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"center",gap:10,marginTop:18}}>
              <span style={{display:"inline-flex",alignItems:"center",flexWrap:"wrap",rowGap:4,background:"rgba(255,255,255,0.045)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:999,padding:"9px 4px"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:7,padding:"0 12px",fontSize:12.5,fontWeight:600,color:"#cbd5e1",whiteSpace:"nowrap"}}>{pillIcon(seg1Icon)}{seg1Text}</span>
                {seg2Text&&<span style={{display:"inline-flex",alignItems:"center",gap:7,padding:"0 12px",borderLeft:"1px solid rgba(255,255,255,0.12)",fontSize:12.5,fontWeight:600,color:"#cbd5e1",whiteSpace:"nowrap"}}>{pillIcon(seg2Icon)}{seg2Text}</span>}
              </span>
              {(period==="week"||period==="month")&&!preLaunch&&histAvail.length>0&&(
                <PeriodPicker options={period==="week"?weekOpts:monthOpts} value={histKey} onPick={setHistKey}
                  accent={thA} accentRGB={thRGB} icon={calIcon}/>
              )}
            </div>
          );
        })()}
      </div>{/* /rkHeadCard */}
      {ranking.length>0&&(<>
        {/* Season Race + (demos) + pílula do vencedor — a toda a largura, por cima da grelha */}
        <div style={{marginBottom:10}} ref={raceWrapRef}>
          {/* Semanal pré-arranque → grelha de partida (frameStart); ao vivo/mês/geral → gráfico normal.
              Quando 2ª feira o cron captura os baselines, hasWeek fica true e entra o gráfico ao vivo. */}
          <GlowBehind><SeasonRace ranking={ranking} preLaunch={preLaunch} myNorm={myNorm} spy={spy} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""}
            periodStart={histActive?null:(period==="week"?(hasWeek?curWk:null):period==="month"?curMonthDateOnly:null)}
            frameStart={histActive?null:(period==="week"&&!hasWeek&&!preLaunch?frameWk:null)}
            periodRetOf={metricOf} gamePeriod={period}
            periodLabelText={histActive?`${histLabel} (histórico)`:(period==="week"?(hasWeek?weekLabel(curWk):weekLabel(frameWk)):period==="month"?periodLabel(curMonthYM):"")}
            hist={histActive?{periodStart:histWindow.periodStart,periodEnd:histWindow.periodEnd,retOf:histRetOf,shown:histTop.map(x=>x.p)}:undefined}/></GlowBehind>
        </div>
        {preLaunch&&demos.length>0&&(
          <div style={{marginBottom:32}}>
            {sectionTitle("Demo")}
            {tableFor(demos)}
          </div>
        )}
        {!histActive&&(
        <div style={{margin:"0 0 16px"}}>
          <CompetitionTimer settings={settings} period={period} hasWeek={hasWeek}/>
        </div>)}
      </>)}
      </div>{/* /cHeader */}
      <div className="rkCenter" style={{minWidth:0}}>
      {ranking.length===0
        ? <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>Ainda não há portefólios submetidos.</div>
        : officials.length>0
          ? (histActive?histTableEl():(preLaunch?pendingList([...officials].sort((a,b)=>String(b.submittedAt||"").localeCompare(String(a.submittedAt||"")))):tableFor(officials,{searchable:true})))
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
      <aside className="rkRail railR">{histActive?wV1:rightRail}</aside>
      </div>{/* /rkLayout */}
    </div>
  );
}

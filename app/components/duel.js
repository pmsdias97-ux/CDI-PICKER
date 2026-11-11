// Módulo "duel" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { GlowBehind, Rolling, SideBadge, Skeleton, StockLogo, Tri } from "./ui";
import { DUEL_A, DUEL_B, pct, pfDayRet, pfStats, stockRet } from "../lib/core";
import { SectorDonut } from "./detail";

// cores de identidade A (azul) / B (âmbar)
export function DuelChart({a,b,curA,curB}){
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

export function DuelMetric({label,a,b,fmt,better}){
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

export function DuelHoldings({title,tickers,color,names}){
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

export function PickCell({s,kind}){
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

export function DuelPicksSide({rows}){
  const best=rows.reduce((m,s)=>s.ret>m.ret?s:m,rows[0]);
  const worst=rows.reduce((m,s)=>s.ret<m.ret?s:m,rows[0]);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:14,textAlign:"left"}}>
      <PickCell s={best} kind="best"/>
      <PickCell s={worst} kind="worst"/>
    </div>
  );
}

export function Duel({a,b,livePrices,spy,dayChange,nav}){
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
  // Nome numa ÚNICA linha (só quebra sozinho se for demasiado largo p/ a coluna).
  const nameLines=(n)=>n;
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

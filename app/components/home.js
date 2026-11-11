// Módulo "home" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { HERO_LINE_PATH, RANK_BADGE, SUBMISSIONS_CLOSE_MS, WEEK_LIVE_FROM, fmtDateShort, isPreLaunch, nextWeek, pct, stockRet, weekFirstOpenMs, weekFriday, weekKey, weekLabel, weekPreOpen, weekTradingDone } from "../lib/core";
import { Arrow, BreatheGlow, Btn, CountUp, GoldGlow, LockIcon, MiniSparkline, Reveal, Rolling } from "./ui";

// Contador da competição: antes do arranque conta até ao fim das submissões;
// depois mostra a data do vencedor + contagem decrescente. Elegante e responsivo.
export function CompetitionTimer({settings,period,hasWeek}){
  const [now,setNow]=useState(null);
  useEffect(()=>{
    setNow(Date.now());
    const id=setInterval(()=>setNow(Date.now()),3600_000); // 1×/hora — os dias só mudam à meia-noite
    return()=>clearInterval(id);
  },[]);
  if(!settings||now==null) return null;
  const started=settings.competitionStarted;
  const dayDiff=(a,b)=>Math.floor((Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())-Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()))/86400000);
  // `pre` = prefixo (muted, ex.: "Vencedor a", "Arranca 2ª feira,"); `dateStr` = data (bold); `d` = dias.
  let pre="", dateStr=null, d;
  if(started&&period==="week"){
    // Mini-época semanal: arranca 2ª feira (abertura US) → fecha 6ª (fecho US); só ao fecho de 6ª é
    // apurado o vencedor. A mensagem segue o CALENDÁRIO (não só o hasWeek): na 2ª de manhã, antes da
    // abertura, a semana JÁ é a desta 2ª — nunca deve apontar para a 2ª seguinte.
    const nd=new Date(now);
    const wk=weekKey(nd);          // 2ª feira (UTC) desta semana
    const dowUTC=nd.getUTCDay();   // 0=dom … 6=sáb
    // "Arranca": conta até uma 2ª feira; se essa 2ª for hoje, mostra "Arranca hoje" (sem contagem).
    const arranca=(mon)=>{ const dd=dayDiff(new Date(mon+"T00:00:00Z"),nd); dateStr=fmtDateShort(mon);
      if(dd>0){ d=dd; pre="Arranca 2ª feira,"; } else { d=null; pre="Arranca hoje,"; } };
    if(wk<WEEK_LIVE_FROM){
      arranca(WEEK_LIVE_FROM);                    // antes do 1º arranque semanal (Semana 2, 06-jul)
    }else if(weekTradingDone(nd)){
      // Trading da semana terminou (hora US): 6ª pós-fecho → vencedor apurado; fim de semana → próxima 2ª.
      const nyWd=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short"}).format(nd);
      if(nyWd==="Fri"){ pre=`${weekLabel(wk)} · vencedor apurado`; dateStr=null; d=null; }
      else if(weekPreOpen(nd)){                    // 2ª antes da abertura: "Semana 16 arranca hoje às 14:30"
        const t=weekFirstOpenMs(wk); const sameDay=t!=null&&dayDiff(new Date(t),nd)===0;
        pre=`${weekLabel(wk)} arranca ${sameDay?"hoje":"às"}`; dateStr=t!=null?new Date(t).toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit"}):null; d=null;
        if(!sameDay&&t!=null){ pre=`${weekLabel(wk)} arranca ${new Date(t).toLocaleDateString("pt-PT",{weekday:"long"})},`; }
      }
      else arranca(dowUTC===1?wk:nextWeek(wk));   // fim de semana → 2ª seguinte (madrugada 2ª UTC = ainda hoje)
    }else if(!hasWeek&&dowUTC===1){
      d=null; pre="Arranca hoje,"; dateStr=fmtDateShort(wk); // 2ª de manhã, antes da abertura (baseline por capturar)
    }else{
      const fri=weekFriday(wk);                   // semana a rolar → vencedor apura-se 6ª ao fecho
      d=dayDiff(new Date(fri+"T00:00:00Z"),nd);
      pre="Vencedor a"; dateStr=fmtDateShort(fri);
    }
  }else if(started&&period==="month"){
    // Mini-época mensal: vencedor apurado no ÚLTIMO dia do mês. Faltam = (último dia − dia de hoje).
    const nd=new Date(now);
    const lastNum=new Date(nd.getFullYear(),nd.getMonth()+1,0).getDate(); // ex.: 31 (julho)
    d=lastNum-nd.getDate();                                               // 31 − 3 = 28
    const endStr=`${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,"0")}-${String(lastNum).padStart(2,"0")}`;
    pre="Vencedor a"; dateStr=fmtDateShort(endStr);
  }else{
    const targetStr=started?settings.gameEndDate:settings.gameStartDate;
    if(!targetStr) return null;
    const target=new Date(targetStr).getTime();
    if(isNaN(target)) return null;
    const diff=target-now;
    if(diff<=0) return null;
    d=Math.ceil(diff/86400000);
    if(started){ pre="Vencedor a"; dateStr=fmtDateShort(settings.gameEndDate); }
  }
  if(!pre&&dateStr==null&&d==null) return null;
  // Acento cromático do ranking ativo (Geral=azul, Mensal=roxo/lilás, Semanal=verde-água) — igual ao thA/thRGB do Ranking.
  const thA=period==="month"?"#a78bfa":period==="week"?"#2dd4bf":"#60a5fa";
  const thRGB=period==="month"?"167,139,250":period==="week"?"45,212,191":"96,165,250";
  return(
    <div style={{display:"flex",justifyContent:"center"}}>
      <div style={{display:"inline-flex",alignItems:"center",gap:14,flexWrap:"wrap",justifyContent:"center",maxWidth:"100%",
        padding:"9px 22px 9px 11px",borderRadius:999,
        background:`linear-gradient(180deg, rgba(${thRGB},0.14), rgba(${thRGB},0.05)), linear-gradient(180deg, rgba(10,16,30,0.92), rgba(6,10,20,0.95))`,
        backdropFilter:"blur(14px) saturate(160%)",WebkitBackdropFilter:"blur(14px) saturate(160%)",
        border:`1px solid rgba(${thRGB},0.30)`,
        boxShadow:`0 8px 30px rgba(0,0,0,0.42), 0 0 20px rgba(${thRGB},0.15), inset 0 1px 0 rgba(255,255,255,0.07)`}}>
        {/* Círculo com ícone de calendário (brilho do tema) */}
        <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:38,height:38,borderRadius:"50%",flexShrink:0,
          background:`rgba(${thRGB},0.10)`,border:`1px solid rgba(${thRGB},0.40)`,boxShadow:`0 0 14px rgba(${thRGB},0.22), inset 0 0 10px rgba(${thRGB},0.10)`}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={thA} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{filter:`drop-shadow(0 0 5px rgba(${thRGB},0.75))`}}>
            <rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M3 9.5h18M8 3v4M16 3v4"/>
            <circle cx="8" cy="14" r="0.75" fill={thA} stroke="none"/><circle cx="12" cy="14" r="0.75" fill={thA} stroke="none"/><circle cx="16" cy="14" r="0.75" fill={thA} stroke="none"/><circle cx="8" cy="17.5" r="0.75" fill={thA} stroke="none"/><circle cx="12" cy="17.5" r="0.75" fill={thA} stroke="none"/>
          </svg>
        </span>
        {/* Prefixo (muted) + data (bold branco) */}
        <span style={{display:"inline-flex",alignItems:"baseline",gap:8,whiteSpace:"nowrap"}}>
          {pre&&<span style={{fontSize:14.5,color:"#94a3b8",fontWeight:600}}>{pre}</span>}
          {dateStr&&<span style={{fontSize:18.5,color:"#f1f5f9",fontWeight:800,letterSpacing:"-0.3px"}}>{dateStr}</span>}
        </span>
        {/* Divisor + "faltam N dias" (número grande no acento do tema) */}
        {d!=null&&<>
          <span aria-hidden="true" style={{width:1,height:28,flexShrink:0,background:`linear-gradient(180deg, transparent, rgba(${thRGB},0.5), transparent)`}}/>
          {d>0
            ? <span style={{display:"inline-flex",alignItems:"baseline",gap:7,whiteSpace:"nowrap"}}>
                <span style={{fontSize:14,color:"#94a3b8",fontWeight:600}}>faltam</span>
                <span style={{fontSize:20,color:thA,fontWeight:800,letterSpacing:"-0.3px"}}>{d}</span>
                <span style={{fontSize:14,color:"#94a3b8",fontWeight:600}}>{d===1?"dia":"dias"}</span>
              </span>
            : <span style={{fontSize:14.5,color:thA,fontWeight:800,whiteSpace:"nowrap"}}>apura-se hoje</span>}
        </>}
      </div>
    </div>
  );
}

export function SubmissionCountdown({settings}){
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

/* ---- Home: liga ao vivo -------------------------------------------------- */

export function WinnersGrid({top,livePrices,nav,navRank}){
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
        .cdiWinners{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr));padding-top:32px}
        .cdiCell{display:flex;min-width:0}
        .cdiCell>.winCard{flex:1;min-width:0}
        .cdiPeek{display:none}
        @media(min-width:769px){
          /* Pódio: ordem 1º-2º-3º-4º, com o campeão elevado. */
          .winP1{transform:translateY(-12px)}
          .cdiWinners.has-peek{grid-template-columns:repeat(4,minmax(0,1fr)) minmax(0,0.42fr)}
          .cdiPeek{display:block;overflow:hidden;cursor:pointer;
            -webkit-mask-image:linear-gradient(to right,#000 30%,transparent 95%);
            mask-image:linear-gradient(to right,#000 30%,transparent 95%);
            filter:blur(1.5px);opacity:0.5}
          .cdiPeek>div{width:260px}
        }
        @media(max-width:768px){.cdiWinners{grid-template-columns:repeat(2,minmax(0,1fr))}.winP1{grid-column:1/-1}.winP4{display:none}.winMetric{text-align:center}.winMetric>div{justify-content:center}}
        /* Etiqueta vertical "Desde 1 de julho" à esquerda do pódio — só no desktop (onde é 1 linha). */
        .winSince{display:none}
        @media(min-width:769px){
          .winSinceWrap{display:flex;align-items:stretch;gap:16px}
          .winSinceWrap .cdiWinners{flex:1;min-width:0}
          .winSince{display:flex;align-items:center;justify-content:center;flex-shrink:0;
            writing-mode:vertical-rl;transform:rotate(180deg);
            font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#64748b;white-space:nowrap}
        }
      `}</style>
      <div className="winSinceWrap">
        <div className="winSince" aria-hidden="true">Desde 1 de julho</div>
        <div className={`cdiWinners${peek?" has-peek":""}`}>
          {main.map((p,i)=>(
            <div key={p.key} className={`cdiCell winP${i+1}`}>
              <WinnerCard p={p} rank={i+1} livePrices={livePrices}
                series={seriesById[p.id]||[]} onClick={()=>navRank("total")}/>
            </div>
          ))}
          {peek&&(
            <div className="cdiPeek" onClick={()=>navRank("total")} aria-hidden="true">
              <div>
                <WinnerCard p={peek} rank={5} livePrices={livePrices} series={seriesById[peek.id]||[]} onClick={()=>navRank("total")}/>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function WinnerCard({p,rank,livePrices,series,onClick}){
  const up=p.total>=0;
  const col=up?"#34d399":"#fb7185";
  const isTop=rank===1;
  const baseShadow=isTop
    ? "0 14px 44px rgba(0,0,0,0.38), 0 0 0 1px rgba(251,191,36,0.28), 0 0 34px rgba(245,158,11,0.14), inset 0 1px 0 rgba(255,255,255,0.16)"
    : "0 10px 36px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10)";
  const badge=RANK_BADGE[rank]||{background:"rgba(255,255,255,0.06)",color:"#94a3b8",border:"1px solid rgba(255,255,255,0.14)"};
  return(
    <div onClick={onClick} className="winCard"
      onMouseEnter={e=>{ e.currentTarget.style.transform="translateY(-3px)"; e.currentTarget.style.boxShadow=isTop?"0 20px 52px rgba(251,191,36,0.20), 0 0 0 1px rgba(251,191,36,0.40), inset 0 1px 0 rgba(255,255,255,0.18)":"0 18px 46px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14)"; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow=baseShadow; }}
      style={{position:"relative",cursor:"pointer",borderRadius:22,padding:isTop?"26px 24px 24px":22,
        background:isTop
          ? "linear-gradient(160deg, rgba(251,191,36,0.16) 0%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0.028) 100%)"
          : "linear-gradient(160deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.028) 100%)",
        backdropFilter:"blur(22px) saturate(170%)",WebkitBackdropFilter:"blur(22px) saturate(170%)",
        border:`1px solid ${isTop?"rgba(251,191,36,0.45)":"rgba(255,255,255,0.10)"}`,
        boxShadow:baseShadow,transition:"transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease"}}>
      {isTop&&(
        <GoldGlow src="/cdi-louros.webp" alt="Louros de campeão" maskSrc="/cdi-louros.webp" glow={22}
          baseFilter="drop-shadow(0 8px 16px rgba(0,0,0,0.5)) drop-shadow(0 0 16px rgba(245,158,11,0.45))"
          wrapStyle={{position:"absolute",top:-50,left:"50%",transform:"translateX(-50%)",width:58,zIndex:5,pointerEvents:"none"}}
          imgStyle={{width:"100%",height:"auto"}}/>
      )}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:9,marginBottom:18}}>
        <div style={{width:isTop?36:32,height:isTop?36:32,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:isTop?15:13,fontWeight:800,...badge}}>{rank}</div>
        <span style={{fontWeight:700,fontSize:isTop?"clamp(14px,3.8vw,18px)":"clamp(12.5px,3.4vw,16px)",letterSpacing:"-0.4px",flex:"0 1 auto",minWidth:0,lineHeight:1.2,overflowWrap:"anywhere",textAlign:"center"}}>{p.name}</span>
      </div>
      <div className="winMetric" style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"center",gap:8}}>
          <span style={{fontSize:isTop?15:13,color:col}}>{up?"▲":"▼"}</span>
          <span style={{fontFamily:"'SF Mono',ui-monospace,monospace",fontWeight:800,fontSize:isTop?38:30,letterSpacing:"-1.5px",color:col}}>
            <Rolling text={pct(Math.abs(p.total)).replace(/[+-]/,"")}/>
          </span>
        </div>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:14}}>
        {p.stocks.map(s=>{ const g=stockRet(s,livePrices)>=0; return(
          <span key={s.ticker} title={s.companyName||s.ticker} style={{flex:1,height:6,borderRadius:999,
            background:g?"linear-gradient(180deg,#34d399,#10b981)":"linear-gradient(180deg,#fb7185,#ef4444)",
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.25)"}}/>
        ); })}
      </div>
      <MiniSparkline series={series} current={p.total} height={isTop?56:48}/>
    </div>
  );
}

/* ---- Updates e feedbacks (homepage, área do membro) ---------------------- */
// Recap diário do que a plataforma levou (escrito pelo admin). A área de feedback dos membros foi removida.
export function UpdatesFeedback({myName}){
  const [updates,setUpdates]=useState([]);
  const [activeDay,setActiveDay]=useState(null); // data antiga (chip) ativa — mostra o conteúdo por baixo
  useEffect(()=>{ let ok=true;
    (async()=>{ try{ const r=await fetch("/api/updates/list"); const j=await r.json(); if(ok&&Array.isArray(j.updates)) setUpdates(j.updates); }catch{} })();
    return()=>{ ok=false; };
  },[]);
  const fmtDay=(d)=>{ try{ return new Date(d+"T00:00:00Z").toLocaleDateString("pt-PT",{day:"numeric",month:"short",timeZone:"UTC"}); }catch{ return d; } };
  const fmtDayShort=(d)=>{ try{ const [,m,dd]=String(d).split("-"); return `${dd}/${m}`; }catch{ return d; } };
  const bodyLines=(t)=>String(t||"").split("\n").map(s=>s.replace(/^\s*[-•]\s*/,"").trim()).filter(Boolean);
  return(
    <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:"clamp(20px,4vw,32px)"}}>
      <h2 style={{fontSize:20,fontWeight:700,letterSpacing:"-0.3px",margin:"0 0 4px",textAlign:"center"}}>
        Updates
      </h2>
      <p style={{fontSize:13,color:"#6b7280",margin:"0 0 22px",textAlign:"center"}}>O que vai mudando na plataforma.</p>

      {/* Updates */}
      <div>
        <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:"1.2px",fontWeight:700,marginBottom:14}}>Novidades</div>
        {updates.length===0?(
          <p style={{fontSize:14,color:"#6b7280",margin:0}}>Ainda sem novidades por aqui. Fica atento. 👀</p>
        ):(()=>{
          const bodyBlock=(u)=>(
            <div style={{minWidth:0,display:"flex",flexDirection:"column",gap:5}}>
              {bodyLines(u.body).map((l,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{color:"#22c55e",fontWeight:700,marginTop:1,flexShrink:0,fontSize:13}}>›</span>
                  <span style={{fontSize:14,color:"#cbd5e1",lineHeight:1.5}}>{l}</span>
                </div>
              ))}
            </div>
          );
          return(
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {/* Mais recente — sempre à vista, data a verde. */}
              <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{flexShrink:0,minWidth:52,fontSize:12,fontWeight:700,color:"#4ade80",paddingTop:2,textTransform:"lowercase"}}>{fmtDay(updates[0].day)}</div>
                {bodyBlock(updates[0])}
              </div>
              {/* Anteriores — chips horizontais (fluem e quebram de linha, não crescem em altura).
                  Clicar num chip abre o conteúdo desse dia por baixo; clicar no ativo fecha. */}
              {updates.length>1&&(()=>{
                const older=updates.slice(1);
                const activeUpdate=activeDay?older.find(u=>u.day===activeDay):null;
                return(
                  <div style={{paddingTop:6}}>
                    <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:"1px",fontWeight:700,marginBottom:9}}>Anteriores</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {older.map(u=>{ const active=activeDay===u.day;
                        return(
                          <button key={u.day} onClick={()=>setActiveDay(active?null:u.day)}
                            style={{display:"inline-flex",alignItems:"center",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,
                              borderRadius:999,padding:"5px 12px",transition:"all .15s",
                              background:active?"rgba(74,222,128,0.12)":"rgba(255,255,255,0.05)",
                              border:`1px solid ${active?"rgba(74,222,128,0.4)":"rgba(255,255,255,0.12)"}`,
                              color:active?"#4ade80":"#94a3b8"}}>
                            {fmtDayShort(u.day)}
                          </button>
                        );
                      })}
                    </div>
                    {activeUpdate&&(
                      <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.08)",display:"flex",gap:14,alignItems:"flex-start"}}>
                        <div style={{flexShrink:0,minWidth:52,fontSize:12,fontWeight:700,color:"#4ade80",paddingTop:2,textTransform:"lowercase"}}>{fmtDay(activeUpdate.day)}</div>
                        {bodyBlock(activeUpdate)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export function Home({nav,navRank,submitted,settings,ranking,livePrices,onMyPortfolio,myName}){
  const officialCount=(ranking||[]).filter(p=>p.official).length;
  // Pulso que viaja pela linha do gráfico. O SVG do fundo usa preserveAspectRatio="none"
  // (estica → deformaria qualquer <circle>), por isso o ponto é um <div> HTML redondo,
  // posicionado a amostrar a geometria REAL da linha (getPointAtLength) → círculo perfeito e em cima da linha.
  const heroLineRef=useRef(null), heroDotsRef=useRef(null), heroGridRef=useRef(null);
  const heroEndRef=useRef(null), heroEndCoreRef=useRef(null);
  useEffect(()=>{
    const path=heroLineRef.current, wrap=heroDotsRef.current;
    const end=heroEndRef.current, endCore=heroEndCoreRef.current;
    const svg=path&&path.ownerSVGElement;
    if(!path||!wrap||!svg) return;
    const len=path.getTotalLength();
    // Pré-calcula os pontos da linha UMA vez (sem getPointAtLength no loop → sem jank).
    const SAMPLES=200, pts=[];
    for(let i=0;i<=SAMPLES;i++){ const q=path.getPointAtLength(i/SAMPLES*len); pts.push([q.x,q.y]); }
    const at=(t)=>{ const s=Math.max(0,Math.min(1,t))*SAMPLES, i=Math.floor(s), f=s-i,
      a=pts[i], b=pts[Math.min(SAMPLES,i+1)]; return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]; };
    const endPt=pts[SAMPLES];
    // Mede o SVG sempre que o seu tamanho REAL muda (ResizeObserver) — não só no resize da janela.
    // O layout da hero pode mudar por outros motivos (fontes a carregar, reflow ao voltar de outra
    // página em SPA) sem disparar "resize"; com o listener antigo os pontos ficavam com a medida velha
    // e desalinhavam da linha (o path em si acompanha sempre, por ser SVG percentual — só os <div> dos
    // pontos, medidos em px, ficavam presos ao tamanho antigo).
    let rw=0, rh=0;
    const grid=heroGridRef.current, CELL=5.6;
    const measure=()=>{ const r=svg.getBoundingClientRect(); rw=r.width; rh=r.height;
      if(grid&&rw&&rh) grid.setAttribute("width",(CELL*(rh/60)/(rw/100)).toFixed(3)); };
    measure();
    let ro=null;
    if(typeof ResizeObserver!=="undefined"){ ro=new ResizeObserver(measure); ro.observe(svg); }
    else if(typeof window!=="undefined") window.addEventListener("resize",measure); // fallback muito antigo
    const put=(el,p)=>{ if(rw&&rh) el.style.transform=`translate(${p[0]/100*rw}px, ${p[1]/60*rh}px)`; };
    const reduce=typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const anims=[];
    // O farol fica QUIETO (estado de repouso, sem pulsar sozinho) e só PULSA quando um pulso viajante
    // lhe bate (chega ao fim da linha) — não é um pulsar contínuo independente dos viajantes.
    if(endCore){ endCore.style.transform="scale(0.55)"; endCore.style.opacity="0.4"; }
    // Um-tiro (não infinito) — não entra em `anims` (não precisa de cancelar: acaba sozinho em 650ms).
    const flashEnd=()=>{ if(!endCore||!endCore.animate||reduce) return; endCore.animate(
      [{transform:"scale(0.55)",opacity:0.4},{transform:"scale(1.3)",opacity:1},{transform:"scale(0.55)",opacity:0.4}],
      {duration:650,easing:"ease-out"}); };
    const pulse=(el,dur,delay)=>{ if(el&&el.animate&&!reduce) anims.push(el.animate(
      [{transform:"scale(0.55)",opacity:0.4},{transform:"scale(1)",opacity:0.95},{transform:"scale(0.55)",opacity:0.4}],
      {duration:dur,iterations:Infinity,easing:"ease-in-out",delay:delay||0})); };
    // vários pontos viajantes com fase/velocidade/intervalo aleatórios → orgânico
    const travelers=Array.from(wrap.children).map((el)=>({ el, core:el.firstChild,
      dur:2600+Math.random()*2600, delay:900+Math.random()*3200, off:Math.random()*7000, armed:true }));
    travelers.forEach(t=>pulse(t.core,1900+Math.random()*900,Math.random()*1200));
    const cleanupGrid=()=>{ if(ro) ro.disconnect(); else if(typeof window!=="undefined") window.removeEventListener("resize",measure); };
    if(reduce){ put(end,endPt); travelers.forEach(t=>{ t.el.style.opacity="0"; }); return ()=>{ anims.forEach(a=>a.cancel()); cleanupGrid(); }; }
    let raf, start;
    const loop=(ts)=>{ if(start==null) start=ts; const now=ts-start;
      put(end,endPt);
      for(const t of travelers){ const period=t.dur+t.delay; const e=(now+t.off)%period; const traveling=e>=t.delay;
        const p=traveling?(e-t.delay)/t.dur:0;
        // surge já em movimento; dissolve só mesmo no impacto (janela curta) → "bate" na luz do farol.
        const fade=traveling?Math.min(Math.max(0,(p-0.14)/0.12),Math.max(0,(1-p)/0.04)):0;
        t.el.style.opacity=String(fade); if(traveling) put(t.el,at(p));
        if(traveling&&p>=0.97&&t.armed){ t.armed=false; flashEnd(); } // impacto → o farol pulsa
        if(!traveling) t.armed=true; // re-arma para a próxima volta
      }
      raf=requestAnimationFrame(loop); };
    raf=requestAnimationFrame(loop);
    return ()=>{ cancelAnimationFrame(raf); anims.forEach(a=>a.cancel()); cleanupGrid(); };
  },[]);
  const compDay=(()=>{ const d=settings?.gameStartDate?new Date(settings.gameStartDate):null; if(!d||isNaN(d)) return 1; return Math.max(1,Math.min(365,Math.floor((Date.now()-d.getTime())/86400000)+1)); })();
  const iconProps={viewBox:"0 0 24 24",fill:"none",stroke:"#8ea2bf",strokeWidth:1.6,strokeLinecap:"round",strokeLinejoin:"round",width:22,height:22,"aria-hidden":true};
  return(
    <div>
      {/* Hero */}
      <section style={{position:"relative",overflow:"hidden",textAlign:"center",padding:"clamp(72px,11vw,116px) 24px 80px",maxWidth:900,margin:"0 auto"}}>
        {/* gráfico de bolsa a subir, de fundo subtil (esbatido nas bordas) */}
        <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:0,pointerEvents:"none",
          WebkitMaskImage:"radial-gradient(130% 100% at 50% 30%, #000 34%, transparent 82%)",
          maskImage:"radial-gradient(130% 100% at 50% 30%, #000 34%, transparent 82%)"}}>
          <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none" style={{display:"block"}}>
            <defs>
              <linearGradient id="heroChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4ade80" stopOpacity="0.03"/>
                <stop offset="100%" stopColor="#4ade80" stopOpacity="0"/>
              </linearGradient>
              <linearGradient id="heroChartLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#4ade80" stopOpacity="0.15"/>
                <stop offset="55%" stopColor="#4ade80" stopOpacity="0.5"/>
                <stop offset="100%" stopColor="#6ee7a8" stopOpacity="0.85"/>
              </linearGradient>
              <filter id="heroChartGlow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="0.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              {/* grelha ténue só por baixo da linha, com fade vertical até desaparecer */}
              <pattern id="heroGrid" ref={heroGridRef} width="5.6" height="5.6" patternUnits="userSpaceOnUse">
                <path d="M0 0 H99 M0 0 V99" fill="none" stroke="rgba(120,240,180,0.34)" strokeWidth="0.7" vectorEffect="non-scaling-stroke"/>
              </pattern>
              <clipPath id="heroAreaClip">
                <path d="M0,24 C12,23 14,20 25,21 C36,22 40,16 50,18 C60,21 66,13 75,14 C84,14 89,11 94,10 L94,33 L0,33 Z"/>
              </clipPath>
              <linearGradient id="heroGridFadeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity="1"/>
                <stop offset="55%" stopColor="#fff" stopOpacity="0"/>
              </linearGradient>
              <mask id="heroGridMask"><rect x="0" y="0" width="100" height="60" fill="url(#heroGridFadeGrad)"/></mask>
            </defs>
            {/* área muito ténue sob a curva */}
            <path d="M0,24 C12,23 14,20 25,21 C36,22 40,16 50,18 C60,21 66,13 75,14 C84,14 89,11 94,10 L94,33 L0,33 Z"
              fill="url(#heroChartFill)"/>
            {/* grelha por baixo da linha (clipada à área + fade vertical) */}
            <g clipPath="url(#heroAreaClip)" mask="url(#heroGridMask)">
              <rect x="0" y="0" width="100" height="60" fill="url(#heroGrid)"/>
            </g>
            {/* linha de cotação suave a subir (com brilho subtil) */}
            <path ref={heroLineRef} d={HERO_LINE_PATH}
              fill="none" stroke="url(#heroChartLine)" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"
              vectorEffect="non-scaling-stroke" filter="url(#heroChartGlow)"/>
          </svg>
          {/* farol fixo a pulsar no FIM da linha */}
          <div ref={heroEndRef} aria-hidden="true" style={{position:"absolute",top:0,left:0,pointerEvents:"none",willChange:"transform"}}>
            <div ref={heroEndCoreRef} style={{width:28,height:28,margin:"-14px 0 0 -14px",borderRadius:"50%",
              background:"radial-gradient(circle, rgba(230,255,239,0.98) 0%, rgba(110,231,168,0.6) 40%, rgba(110,231,168,0) 72%)"}}/>
          </div>
          {/* vários pulsos redondos (divs HTML) que viajam pela linha e vão ter com o farol final —
              círculos perfeitos, imunes ao "none" do SVG; fases/velocidades aleatórias */}
          <div ref={heroDotsRef} aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none"}}>
            {[0,1,2,3].map(i=>(
              <div key={i} style={{position:"absolute",top:0,left:0,willChange:"transform",opacity:0}}>
                <div style={{width:13,height:13,margin:"-6.5px 0 0 -6.5px",borderRadius:"50%",
                  background:"radial-gradient(circle, rgba(230,255,239,0.95) 0%, rgba(110,231,168,0.55) 38%, rgba(110,231,168,0) 70%)"}}/>
              </div>
            ))}
          </div>
        </div>
        <div style={{position:"relative",zIndex:1}}>
          <span style={{position:"relative",display:"inline-block",margin:"0 auto 32px"}}>
            <BreatheGlow color="rgba(245,200,80,0.5)" mid="rgba(245,158,11,0.16)" inset="-34% -16%" base={0.4} duration={9000}/>
            <span style={{position:"relative",zIndex:1,display:"inline-block"}}>
              <GoldGlow src="/logo.png" alt="Conversas de Investidores" maskSrc="/logo.png" glow={20}
                wrapStyle={{display:"block"}}
                imgStyle={{width:"clamp(120px,18vw,180px)",height:"auto"}}/>
            </span>
          </span>
          <h1 className="heroTitle" style={{fontSize:"clamp(34px,11vw,104px)",fontWeight:800,lineHeight:0.98,letterSpacing:"-0.02em",margin:"0 0 20px"}}>
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
          <style>{`@media(max-width:520px){.heroTitle{font-size:clamp(32px,10vw,46px)!important;letterSpacing:-0.01em!important;line-height:1.05}.heroBtns{flex-wrap:nowrap;gap:10px;align-items:stretch}.heroBtns>button{flex:1;min-width:0;padding:14px 10px!important;font-size:15px!important;line-height:1.2}.heroBrk{display:none}} `}</style>
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
          {officialCount>0&&<p style={{marginTop:22,fontSize:13,color:"#94a3b8"}}>{officialCount} {officialCount===1?"portefólio":"portefólios"} já submetidos</p>}
        </div>
      </section>

      {/* Liga ao vivo — vencedores */}
      {ranking&&ranking.length>0&&(
        <section style={{maxWidth:1120,margin:"0 auto",padding:"0 24px 80px"}}>
          <Reveal>
          <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
            <span style={{display:"inline-flex",alignItems:"center",gap:7,background:"rgba(239,68,68,0.12)",
              border:"1px solid rgba(239,68,68,0.3)",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:700,color:"#f87171",letterSpacing:"0.5px"}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#ef4444",display:"inline-block"}}/>AO VIVO
            </span>
          </div>
          <WinnersGrid top={ranking.filter(p=>Number.isFinite(p.total)).slice(0,5)} livePrices={livePrices} nav={nav} navRank={navRank}/>
          </Reveal>
        </section>
      )}

      {/* A competição em números (métricas reais do jogo) */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <style>{`
          /* Sem box: 3 stats numa linha limpa (sem moldura nem divisórias). Tudo dimensionado por vw
             → cabe sempre no ecrã do telemóvel (o problema era o inline sobrepor-se ao @media). */
          .statGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(4px,2vw,20px);align-items:start}
          .statCell{text-align:center;padding:0 2px;min-width:0}
          .statIcon{display:inline-flex;align-items:center;justify-content:center;color:#94a3b8;margin-bottom:clamp(8px,2.5vw,14px)}
          .statIcon svg{width:clamp(20px,5.5vw,26px);height:clamp(20px,5.5vw,26px)}
          .statNum{font-size:clamp(24px,7.5vw,44px);font-weight:800;letter-spacing:-1px;line-height:1;color:#e2e8f0;font-variant-numeric:tabular-nums;white-space:nowrap}
          .statLabel{font-size:clamp(9px,2.5vw,11px);color:#6b7280;text-transform:uppercase;letter-spacing:clamp(.5px,0.4vw,1.5px);font-weight:600;margin-top:clamp(6px,1.6vw,10px);text-wrap:balance}
        `}</style>
        <Reveal style={{background:"transparent"}}>
          <div className="statGrid">
            {[
              {icon:<svg {...iconProps}><path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,val:<CountUp to={officialCount}/>,label:"Participantes registados"},
              {icon:<svg {...iconProps}><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,val:<><CountUp to={compDay}/><span style={{color:"#4b5563",fontWeight:700}}>/<CountUp to={365}/></span></>,label:"Dia da competição"},
              {icon:<svg {...iconProps}><line x1="6" y1="20" x2="6" y2="13"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="9"/></svg>,val:<CountUp to={officialCount*8}/>,label:"Ações escolhidas"},
            ].map((s,i)=>(
              <div key={i} className="statCell">
                <div className="statIcon">{s.icon}</div>
                <div className="statNum">{s.val}</div>
                <div className="statLabel">{s.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Como funciona */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <Reveal><h2 style={{textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:40,textWrap:"balance"}}>Como funciona</h2></Reveal>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {n:"01",icon:(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),t:"Inscreveram-se",d:"Cada membro entrou com o mesmo nome que tem no grupo de Telegram da comunidade."},
            {n:"02",icon:(<><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></>),t:"Escolheram 8 ações",d:"Cada participante selecionou exatamente 8 posições (peso igual)."},
            {n:"03",icon:(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>),t:"Em competição",d:"As submissões foram encerradas e os portefólios bloqueados; a competição arrancou a 1 de julho."},
          ].map((c,i)=>(
            <Reveal key={c.n} delay={i*90}>
            <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24,position:"relative",overflow:"hidden",height:"100%",boxSizing:"border-box"}}>
              <div style={{position:"absolute",top:16,right:20,fontSize:36,fontWeight:800,color:"#1f2937",lineHeight:1}}>{c.n}</div>
              <div style={{marginBottom:16}}>
                <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#8ea2bf" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg>
              </div>
              <h3 style={{fontSize:17,fontWeight:700,marginBottom:8,letterSpacing:"-0.3px"}}>{c.t}</h3>
              <p style={{fontSize:14,color:"#94a3b8",lineHeight:1.6,margin:0}}>{c.d}</p>
            </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Regras */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <Reveal>
        <div style={{background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"clamp(22px,5vw,40px)"}}>
          <h2 style={{fontSize:22,fontWeight:700,marginBottom:28,letterSpacing:"-0.3px",textAlign:"center",textWrap:"balance"}}>Regras do Jogo</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(260px,100%),1fr))",gap:"12px 40px"}}>
            {[
              "Cada participante criou 1 portefólio com 8 posições",
              "Cada posição representa exatamente 12,5% do portefólio",
              "Cada um podia abrir até 2 posições short",
              "Os portefólios de todos só ficaram visíveis quando a competição começou, a 1 de julho de 2026",
              "Depois de submetidos, os portefólios ficaram bloqueados e não vistos por ninguém",
              "As posições arrancaram ao preço de abertura do mercado de 1 de julho",
              "A rentabilidade é calculada como a média das 8 ações",
              "A rentabilidade não inclui dividendos. Conta só a variação de preço",
              "O ranking usa os preços de mercado mais recentes",
              "A competição dura 1 ano: o vencedor é apurado a 30 de junho de 2027",
            ].map((r,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12}}>
                <span style={{color:"#22c55e",fontWeight:700,marginTop:1,flexShrink:0}}>✓</span>
                <span style={{fontSize:14,color:"#cbd5e1",lineHeight:1.5}}>{r}</span>
              </div>
            ))}
          </div>
        </div>
        </Reveal>
      </section>

      {/* Updates e feedbacks — só para membros autenticados */}
      {submitted&&(
        <section id="updates-feedbacks" style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px",scrollMarginTop:96}}>
          <UpdatesFeedback myName={myName}/>
        </section>
      )}

      {/* CTA */}
      {!submitted&&(
        <section style={{maxWidth:700,margin:"0 auto",padding:"0 24px 100px"}}>
          <Reveal>
          <div style={{background:"linear-gradient(135deg,#0d1f12,#0a1520)",border:"1px solid rgba(34,197,94,0.2)",
            borderRadius:20,padding:"48px 40px",textAlign:"center"}}>
            <h2 style={{fontSize:26,fontWeight:700,marginBottom:8,letterSpacing:"-0.5px",textWrap:"balance"}}>A competição arranca a 1 de julho</h2>
            <p style={{fontSize:15,color:"#94a3b8",marginBottom:28}}>As submissões estão encerradas. Entra com o teu nome e código para veres o teu portefólio, ou acompanha o ranking ao vivo.</p>
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
          </Reveal>
        </section>
      )}
    </div>
  );
}

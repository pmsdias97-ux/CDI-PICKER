// Módulo "race" (extraído de app/page.js — sem alterações de comportamento).

import { LineChart, CartesianGrid, XAxis, YAxis, ReferenceLine, Line, ResponsiveContainer, Tooltip } from "recharts";
import { useState, useMemo, useEffect, useRef } from "react";
import { toBlob } from "html-to-image";
import { supabase } from "../supabase";
import { createPortal } from "react-dom";
import { PT_WEEKDAY_SHORT, RACE_FS_BG, RACE_SNAP_CACHE, SNAP_W, fmtDateShort, isMktOpen, marketStatus, raceColorOf, raceFull, raceLsGet, raceLsSet, raceTick } from "../lib/core";

// Ponto "live" pulsante no fim de uma linha do gráfico race (cor da linha). Halo a pulsar (SMIL).
export function RaceLiveDot({cx,cy,color}){
  if(!Number.isFinite(cx)||!Number.isFinite(cy)) return null;
  return(
    <g style={{pointerEvents:"none"}}>
      <circle cx={cx} cy={cy} r={3.5} fill={color} opacity={0.5}>
        <animate attributeName="r" values="3.5;11" dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.5;0" dur="1.6s" repeatCount="indefinite"/>
      </circle>
      <circle cx={cx} cy={cy} r={3.2} fill={color}/>
    </g>
  );
}

// índice = Date.getDay()
export function SeasonRaceTooltip({active,payload,label,gamePeriod}){
  if(!active||!payload||!payload.length) return null;
  const rows=[...payload].filter(p=>p.value!=null);
  // Só no ranking SEMANAL: o dia da semana correspondente à data (ex.: "31/08" → "2ª-feira") — a
  // aba semanal desenrola-se por dias da semana (2ª→6ª), sem isso o "dia 31" é ambíguo.
  const wdLabel=(()=>{ if(gamePeriod!=="week") return null; const d=new Date(label); return Number.isNaN(d.getTime())?null:PT_WEEKDAY_SHORT[d.getDay()]; })();
  // "A tua" linha (name termina em " (tu)", posto pelo Line `name=`) e o S&P 500 não pertencem ao
  // Top 10 — separados por um traço ténue e ligeiramente esbatidos, para não se misturarem visualmente
  // com o ranking (o utilizador pode nem estar no Top 10; o S&P é só a referência).
  const isExtra=p=>p.dataKey==="S&P 500"||(typeof p.name==="string"&&p.name.endsWith(" (tu)"));
  const top10=rows.filter(p=>!isExtra(p)).sort((a,b)=>b.value-a.value);
  const extra=rows.filter(isExtra).sort((a,b)=>b.value-a.value);
  const row=(p,muted)=>(
    <div key={p.dataKey} style={{display:"flex",alignItems:"center",gap:8,lineHeight:1.6,opacity:muted?0.68:1}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
      <span style={{color:muted?"#94a3b8":"#cbd5e1",flex:1,whiteSpace:"nowrap"}}>{p.name||p.dataKey}</span>
      <span style={{fontFamily:"monospace",fontWeight:700,color:p.value>=0?"#4ade80":"#f87171"}}>{p.value>=0?"+":""}{p.value.toFixed(2)}%</span>
    </div>
  );
  return(
    <div style={{background:"rgba(8,15,32,0.95)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"8px 11px",fontSize:12,boxShadow:"0 8px 24px rgba(0,0,0,0.45)"}}>
      <div style={{color:"#94a3b8",marginBottom:6,fontFamily:"monospace"}}>{raceFull(label)}{wdLabel&&<span style={{color:"#5eead4",fontWeight:700}}> · {wdLabel}</span>}</div>
      {top10.map(p=>row(p,false))}
      {extra.length>0&&(
        <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed rgba(255,255,255,0.14)"}}>
          {extra.map(p=>row(p,true))}
        </div>
      )}
    </div>
  );
}

export function SnapshotCard({cardRef,shown,data,raceYMin,raceYMax,dateStr,compDay,dayTicks,hasSpy,valueOf,gamePeriod,periodLabelText}){
  const top10=shown.slice(0,10);
  // Cada snapshot transmite o JOGO (Geral/Mensal/Semanal) — etiqueta colorida + período no cabeçalho.
  const g=({
    month:{label:"Ranking Mensal", fg:"#c4b5fd",bg:"rgba(129,140,248,0.20)",br:"rgba(129,140,248,0.45)"},
    week: {label:"Ranking Semanal",fg:"#5eead4",bg:"rgba(20,184,166,0.18)",br:"rgba(20,184,166,0.42)"},
  }[gamePeriod])||{label:"Ranking Geral",fg:"#93c5fd",bg:"rgba(59,130,246,0.18)",br:"rgba(59,130,246,0.42)"};
  const capLabel=periodLabelText?periodLabelText.charAt(0).toUpperCase()+periodLabelText.slice(1):"";
  const sub=`${capLabel?`${capLabel} · `:""}Top 10 · ${dateStr}${(gamePeriod==="total"||!gamePeriod)?` · Dia ${compDay}/365`:""}`;
  return(
    <div ref={cardRef} style={{width:SNAP_W,boxSizing:"border-box",padding:34,
      background:"radial-gradient(1200px 700px at 50% -10%, rgba(37,99,235,0.22), transparent 70%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 100%)",
      color:"#e2e8f0",fontFamily:"system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"}}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
        <img src="/logo.png" alt="" width={52} height={52} style={{display:"block",flexShrink:0}}/>
        <div style={{display:"flex",flexDirection:"column",lineHeight:1.15,gap:7}}>
          <span style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px"}}>CDI PICKER</span>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{display:"inline-block",padding:"3px 12px",borderRadius:999,fontSize:12,fontWeight:800,letterSpacing:.6,textTransform:"uppercase",
              color:g.fg,background:g.bg,border:`1px solid ${g.br}`,whiteSpace:"nowrap"}}>{g.label}</span>
            <span style={{fontSize:13.5,color:"#94a3b8",fontWeight:600}}>{sub}</span>
          </div>
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

export function SeasonRace({ranking,preLaunch,myNorm,spy,competitionStarted,gameStartDate,periodStart,periodLabelText,frameStart,periodRetOf,gamePeriod,hist}){
  const [snaps,setSnaps]=useState([]); // [] em vez de null → o gráfico desenha logo (baseline início→agora)
  const nowIso=useMemo(()=>new Date().toISOString(),[]); // "agora" fixo → conteúdo do data estável (não re-anima)
  const [mounted,setMounted]=useState(false);
  const [hi,setHi]=useState(null); // portefólio em destaque (hover no nome ou na linha)
  const [legendAll,setLegendAll]=useState(false); // mobile: legenda mostra Top 5; "ver todos" expande
  // "Live": ponto pulsante no fim das linhas só com o mercado US aberto (e só desktop).
  const [mktLive,setMktLive]=useState(false);
  const [animDone,setAnimDone]=useState(false); // bolinhas só depois de as linhas "crescerem"
  const [snapsLoaded,setSnapsLoaded]=useState(false); // só anima DEPOIS de os snapshots carregarem (senão a animação recomeça quando o fetch chega)
  const [animate,setAnimate]=useState(false); // anima o "crescimento" só na 1ª carga (sem cache); revisitas com cache = instantâneo, sem re-animar
  useEffect(()=>{
    // Pulsar segue o mercado REAL (fecha às 16:00 ET, como a pill "Mercado fechado") — não o isMktOpen,
    // que tem folga até às 16:15 (essa folga é só para filtrar snapshots, não para o "ao vivo").
    const ck=()=>setMktLive(marketStatus().open&&typeof window!=="undefined"&&window.matchMedia("(min-width:861px)").matches);
    ck(); const id=setInterval(ck,30000);
    if(typeof window!=="undefined") window.addEventListener("resize",ck);
    return()=>{ clearInterval(id); if(typeof window!=="undefined") window.removeEventListener("resize",ck); };
  },[]);
  const [snapOpen,setSnapOpen]=useState(false); // modal do snapshot (desktop)
  // ECRÃ INTEIRO do gráfico: API nativa (requestFullscreen) quando existe; senão (ex.: iPhone) cai num
  // "ecrã inteiro" por CSS (position:fixed). Esc / botão sai nos dois casos.
  const fsRef=useRef(null);
  const [fsMode,setFsMode]=useState(null); // null | "native" | "css"
  const isFs=fsMode!==null;
  const [winH,setWinH]=useState(0);
  const toggleFs=async()=>{
    if(fsMode){ try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{} setFsMode(null); return; }
    try{ if(fsRef.current?.requestFullscreen){ await fsRef.current.requestFullscreen(); setFsMode("native"); return; } }catch{}
    setFsMode("css");
  };
  useEffect(()=>{
    const onChange=()=>{ if(!document.fullscreenElement) setFsMode(m=>m==="native"?null:m); }; // saiu com Esc (modo nativo)
    document.addEventListener("fullscreenchange",onChange);
    return()=>document.removeEventListener("fullscreenchange",onChange);
  },[]);
  useEffect(()=>{
    if(!fsMode) return;
    const onKey=(e)=>{ if(e.key==="Escape") setFsMode(null); };       // Esc no modo CSS (o nativo já trata)
    const onResize=()=>setWinH(window.innerHeight);
    onResize(); window.addEventListener("resize",onResize); window.addEventListener("keydown",onKey);
    const prev=document.body.style.overflow; if(fsMode==="css") document.body.style.overflow="hidden";
    return()=>{ window.removeEventListener("resize",onResize); window.removeEventListener("keydown",onKey); document.body.style.overflow=prev; };
  },[fsMode]);
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
    // Histórico: o Top 10 do período FECHADO vem já calculado do pai (não recomputa por p.total).
    if(hist&&Array.isArray(hist.shown)) return hist.shown.map(p=>({...p,_me:!!(myNorm&&p.normName===myNorm)}));
    let pool=preLaunch
      ? ranking.filter(p=>!p.official&&Number.isFinite(p.total))
      : ranking.filter(p=>p.official&&Number.isFinite(p.total));
    // Modo período (semana/mês): ordena pelo retorno do PERÍODO → o Top 10 do gráfico = o Top 10 do
    // ranking semanal/mensal (não o total). Em "Geral" mantém a ordem por total.
    if(periodStart&&typeof periodRetOf==="function"){
      pool=[...pool].map(p=>({p,r:periodRetOf(p)})).filter(x=>Number.isFinite(x.r)).sort((a,b)=>b.r-a.r).map(x=>x.p);
    }
    let list=pool.slice(0,10);
    const me=myNorm?pool.find(p=>p.normName===myNorm):null; // só se estiver no mesmo grupo (tem dados)
    if(me&&!list.some(p=>p.id===me.id)) list=[...list,{...me,_me:true}];
    return list.map(p=>({...p,_me:p._me||(myNorm&&p.normName===myNorm)}));
  },[ranking,preLaunch,myNorm,hist,periodStart,periodRetOf]);
  const ids=shown.map(p=>p.id).join(",");
  useEffect(()=>{
    const idList=ids?ids.split(","):[];
    if(!idList.length){ setSnaps([]); return; } // sem membros ainda → mantém em "a carregar" (placeholder)
    // Chave de cache independente da ORDEM (Geral/Semanal/Mensal têm os mesmos snaps crus, só re-baseiam).
    const cacheKey=idList.slice().sort().join(",");
    let cached=RACE_SNAP_CACHE.get(cacheKey);
    if(!cached){ const ls=raceLsGet(cacheKey); if(ls&&ls.length){ cached=ls; RACE_SNAP_CACHE.set(cacheKey,ls); } } // F5: último estado conhecido, já
    // Anima SEMPRE o crescimento; a cache serve só para eliminar o DELAY do fetch na revisita.
    if(cached){ setSnaps(cached); setSnapsLoaded(true); } // revisita: dados já em cache → anima logo, sem esperar a rede
    else { setSnapsLoaded(false); }                       // 1ª carga: placeholder até os dados chegarem
    setAnimate(true);
    let cancel=false;
    (async()=>{
      try{
        // Paginação: sem isto o Supabase corta aos 1000 registos (os mais ANTIGOS, por ordem ascendente),
        // deixando as semanas recentes de fora → o gráfico do período ficava só com 2 pontos (reta). Busca TUDO.
        // Em PARALELO: pede a 1.ª página com a contagem total e dispara as restantes todas de uma vez
        // (antes eram páginas em série: a demora era a SOMA dos pedidos). Mesma ordem (id asc), mesmos dados.
        const PAGE=1000, cols="id,portfolio_id,captured_at,total_return";
        const mk=(q)=>q.in("portfolio_id",idList).order("id",{ascending:true});
        const first=await mk(supabase.from("portfolio_snapshots").select(cols,{count:"exact"})).range(0,PAGE-1);
        if(first.error) throw first.error;
        let data=[...(first.data||[])]; const cancelled=false;
        const total=first.count??data.length;
        if(total>PAGE&&!cancel){
          const pages=Math.ceil(total/PAGE);
          const rest=await Promise.all(Array.from({length:pages-1},(_,i)=>mk(supabase.from("portfolio_snapshots").select(cols)).range((i+1)*PAGE,(i+2)*PAGE-1)));
          for(const r of rest){ if(r.error) throw r.error; data.push(...(r.data||[])); }
        }
        if(!cancel&&!cancelled){
          const arr=data||[]; const prev=RACE_SNAP_CACHE.get(cacheKey);
          RACE_SNAP_CACHE.set(cacheKey,arr); raceLsSet(cacheKey,arr);
          const same=prev&&prev.length===arr.length&&prev.every((r,i)=>r.portfolio_id===arr[i].portfolio_id&&r.captured_at===arr[i].captured_at&&r.total_return===arr[i].total_return);
          // Só re-aplica se os dados MUDARAM. Igual (revisita típica) → não mexe: a animação em curso não é interrompida
          // nem recomeça. Se mudaram numa revisita, aplica sem re-animar (animate=false) p/ evitar duplo crescimento.
          if(!same){ if(prev) setAnimate(false); setSnaps(arr); }
        }
      }catch{ /* mantém os snaps anteriores (cache) */ }
      finally{ if(!cancel) setSnapsLoaded(true); } // desbloqueia o gráfico mesmo se o fetch falhar
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
    // Benchmark S&P 500 ancorado a 0 no t0. Base do S&P = MESMA data-base das ações: total + mês de
    // ARRANQUE → lock de 30-jun (spyInitialPrice); meses/semanas seguintes → fecho do SPY ANTES do
    // início do período (closeBefore) — a mesma âncora dos baselines semanal/mensal dos membros.
    const useLockSpy=!periodStart||(gameStartDate&&periodStart===String(gameStartDate).slice(0,10));
    const spyBase=(()=>{
      if(!useLockSpy){ const b=(spy&&spy.closeBefore&&t0)?spy.closeBefore(t0):null; if(Number.isFinite(b)&&b>0) return b; }
      for(const p of shown){ const s=p.spyInitialPrice; if(Number.isFinite(s)&&s>0) return s; }
      const b=(spy&&spy.priceAt&&t0)?spy.priceAt(t0):null; return (Number.isFinite(b)&&b>0)?b:null;
    })();
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
  const liveData=useMemo(()=>{
    const key=JSON.stringify(dataRaw);
    if(dataStable.current&&dataStable.current.key===key) return dataStable.current.val;
    dataStable.current={key,val:dataRaw};
    return dataRaw;
  },[dataRaw]);
  // MODO HISTÓRICO: reconstrói a corrida de um período FECHADO a partir dos snapshots dentro da
  // janela [periodStart, periodEnd]. Âncora-no-fim: o último ponto de cada linha = a rentab. oficial
  // do período (hist.retOf, a MESMA da tabela). Sem ponto "agora", sem S&P.
  const histData=useMemo(()=>{
    if(!hist||!hist.periodStart) return null;
    const t0=`${hist.periodStart}T00:00:00.000Z`;
    const t1=`${hist.periodEnd||hist.periodStart}T23:59:59.999Z`;
    const nameById={}; shown.forEach(p=>{ nameById[p.id]=p.name; });
    const byT={}, lastByName={};
    for(const s of (snaps||[])){
      const nm=nameById[s.portfolio_id]; if(!nm) continue;
      const t=s.captured_at; if(!t||t<t0||t>t1||!isMktOpen(t)) continue;
      const v=Number(s.total_return); if(!Number.isFinite(v)) continue;
      (byT[t]=byT[t]||{t})[nm]=v; lastByName[nm]=v; // snaps asc → fica o último da janela
    }
    const off={}; shown.forEach(p=>{ const rp=typeof hist.retOf==="function"?hist.retOf(p):null;
      if(Number.isFinite(lastByName[p.name])&&Number.isFinite(rp)) off[p.name]=lastByName[p.name]-rp; });
    const rows=Object.values(byT).map(row=>{ const out={t:row.t};
      shown.forEach(p=>{ if(Number.isFinite(row[p.name])&&(p.name in off)) out[p.name]=(row[p.name]-off[p.name])*100; }); return out; });
    const zero={t:t0}; shown.forEach(p=>{ if(p.name in off) zero[p.name]=0; }); // arranque comum a 0%
    return [zero,...rows].sort((a,b)=>a.t<b.t?-1:1);
  },[hist,snaps,shown]);
  const data=hist?(histData||[]):liveData;
  const frameMode=!!frameStart;
  // Espera a animação de "crescimento" das linhas terminar antes de mostrar as bolinhas live.
  useEffect(()=>{
    if(frameMode||!(data&&data.length>=2)){ setAnimDone(false); return; }
    if(!animate){ setAnimDone(true); return; } // revisita instantânea (sem animação) → bolinhas já
    setAnimDone(false);
    const t=setTimeout(()=>setAnimDone(true),1170);
    return()=>clearTimeout(t);
  },[data,frameMode,shown.length,animate]);
  // Valor por membro (cabeçalho/legenda): histórico → rentab. do período fechado; período ao vivo
  // (semana/mês) → rentab. DESSE período (não o total); "Geral" → total.
  const valOf=(p)=> (hist&&typeof hist.retOf==="function") ? hist.retOf(p)
    : (periodStart&&typeof periodRetOf==="function") ? periodRetOf(p) : p.total;

  // MODO "GRELHA DE PARTIDA" (semana ainda não arrancou): desenha o gráfico VAZIO já com as
  // proporções certas — eixo X = 2ª→6ª feira da semana que vai começar, todos a 0%. Quando chegar
  // 2ª feira e o cron capturar os baselines, o pai passa a NÃO enviar frameStart → entra o gráfico
  // ao vivo com os dados reais (transição automática, mesmo componente).
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

  const accRGB=gamePeriod==="month"?"167,139,250":gamePeriod==="week"?"45,212,191":"96,165,250"; // cor do ranking
  const fsBg=RACE_FS_BG[gamePeriod]||RACE_FS_BG.total;
  const accL=gamePeriod==="month"?"#c4b5fd":gamePeriod==="week"?"#5eead4":"#93c5fd";
  const chartH=isFs?Math.max(280,(winH||700)-250):320; // em ecrã inteiro o gráfico ocupa a altura toda menos título+legenda
  const snapDate=fmtDateShort(nowIso);
  const snapDay=(()=>{ const d=gameStartDate?new Date(gameStartDate):null; if(!d||isNaN(d)) return 1; return Math.max(1,Math.min(365,Math.floor((Date.now()-d.getTime())/86400000)+1)); })();
  const snapDownload=()=>{ if(!snapUrl) return; const a=document.createElement("a"); a.href=snapUrl; a.download=`cdi-picker-${gamePeriod||"geral"}-top10-${nowIso.slice(0,10)}.png`; a.click(); };
  const snapCopy=async()=>{
    if(!snapBlob) return;
    try{
      if(!navigator.clipboard||typeof window.ClipboardItem==="undefined") throw new Error("no-api");
      // blob JÁ pronto (dentro do gesto do clique, sem fetch) → funciona em Chrome/Edge/Safari.
      await navigator.clipboard.write([new window.ClipboardItem({[snapBlob.type||"image/png"]:snapBlob})]);
      setSnapMsg("Imagem copiada ✓");
    }catch(e){ console.error("snapshot copy failed:",e); setSnapMsg("O browser não deixou copiar — descarrega em vez disso."); }
  };
  // Conteúdo do cartão (JSX) — usado no sítio normal, em ecrã inteiro nativo, ou num portal (fallback CSS).
  const cardBody=(<>
      {enoughData&&!frameMode&&(
      <button className="fsBtn" onClick={toggleFs} title={isFs?"Sair do ecrã inteiro (Esc)":"Ver em ecrã inteiro"} aria-label={isFs?"Sair do ecrã inteiro":"Ver em ecrã inteiro"}
        style={{position:isFs?"fixed":"absolute",top:isFs?14:12,zIndex:2,display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:9,cursor:"pointer",background:`rgba(${accRGB},0.14)`,border:`1px solid rgba(${accRGB},0.50)`,color:accL}}>
        {isFs
          ?<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
          :<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>}
      </button>)}
      {!frameMode&&!hist&&(
      <button className="snapBtn" onClick={()=>setSnapOpen(true)} title="Guardar imagem do Top 10"
        style={{position:isFs?"fixed":"absolute",top:isFs?14:12,right:52,zIndex:2,display:"inline-flex",alignItems:"center",justifyContent:"center",width:32,height:32,borderRadius:9,cursor:"pointer",background:`rgba(${accRGB},0.14)`,border:`1px solid rgba(${accRGB},0.50)`,color:accL}}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>)}
      <p style={{fontSize:12,margin:"0 0 12px",textAlign:"center",minHeight:17,lineHeight:1.4}}>
        {(()=>{
          const hp=hi&&shown.find(p=>p.name===hi);
          const v=hp?valOf(hp):null;
          if(hp&&Number.isFinite(v)) return(<>
            <span style={{color:"#e2e8f0",fontWeight:700}}>{hp._me?`${hp.name} (tu)`:hp.name}</span>
            {" · "}
            <span style={{fontFamily:"ui-monospace, monospace",fontWeight:800,color:v>=0?"#4ade80":"#f87171"}}>{v>=0?"+":""}{(v*100).toFixed(2)}%</span>
          </>);
          return <span style={{color:"#94a3b8"}}>{preLaunch?"Pré-visualização com os portefólios demo. A partir de 1 de julho mostrará o Top 10 oficial":(periodStart||frameMode||hist)?`Top 10 — ${periodLabelText}`:"Top 10 — rentabilidade ao longo da competição"}</span>;
        })()}
      </p>
      {(!mounted||(!hist&&!frameMode&&!snapsLoaded))?(
        <div style={{height:chartH}}/>
      ):frameMode?(
        // Grelha de partida: frame completo (2ª→6ª feira), todos a 0% — pronto a preencher 2ª feira.
        <ResponsiveContainer width="100%" height={chartH}>
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
        <ResponsiveContainer width="100%" height={chartH}>
          <LineChart data={data} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} ticks={dayTicks} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
            <YAxis domain={[raceYMin,raceYMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            <Tooltip content={<SeasonRaceTooltip gamePeriod={gamePeriod}/>} offset={80}/>
            {(()=>{ const lastIdx=data.length-1; const live=mktLive&&!frameMode&&!hist&&animDone;
              // Render em ordem INVERSA (último lugar primeiro) → o 1º lugar pinta por cima: a sua
              // bolinha tem prioridade sobre a do 2º, a do 2º sobre a do 3º, etc.
              return shown.map((p,i)=>({p,i})).reverse().map(({p,i})=>{
              const dim=hi&&hi!==p.name;
              return(
                <Line key={p.key} type="monotone" dataKey={p.name} name={p._me?`${p.name} (tu)`:p.name}
                  stroke={raceColorOf(p,i)}
                  strokeWidth={hi===p.name?(p._me?4.5:3.2):(p._me?3.5:2)}
                  strokeOpacity={dim?0.15:1}
                  dot={(live&&!dim)?((dp)=> dp&&dp.index===lastIdx?<RaceLiveDot key={`ld-${p.key}`} cx={dp.cx} cy={dp.cy} color={raceColorOf(p,i)}/>:null):false}
                  connectNulls isAnimationActive={animate} animationDuration={550} animationEasing="ease-out" animationBegin={i*10}
                  activeDot={hi===p.name?{r:4}:(p._me?{r:3.5}:false)}/>
              );
            }); })()}
            {hasSpy&&<Line type="monotone" dataKey="S&P 500" name="S&P 500" stroke="#ffffff" strokeWidth={1.8} strokeDasharray="6 5" strokeOpacity={0.75} dot={false} connectNulls isAnimationActive={animate} animationDuration={550} animationEasing="ease-out"/>}
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
              {(legendAll?shown:shown.slice(0,5)).map((p,i)=>(
                <div key={p.key} style={{display:"flex",alignItems:"center",gap:9,padding:"5px 2px",borderTop:i===0?"none":"1px solid rgba(255,255,255,0.06)"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:raceColorOf(p,i),flexShrink:0}}/>
                  <span style={{flex:1,minWidth:0,fontSize:13.5,color:p._me?"#f1f5f9":"#cbd5e1",fontWeight:p._me?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p._me?`${p.name} (tu)`:p.name}</span>
                  <span style={{fontFamily:"ui-monospace, monospace",fontSize:13.5,fontWeight:800,color:(frameMode||!Number.isFinite(valOf(p)))?"#64748b":(valOf(p)>=0?"#4ade80":"#f87171")}}>{frameMode?"—":(Number.isFinite(valOf(p))?`${valOf(p)>=0?"+":""}${(valOf(p)*100).toFixed(2)}%`:"—")}</span>
                </div>
              ))}
              {shown.length>5&&(
                <button onClick={()=>setLegendAll(v=>!v)} style={{marginTop:6,alignSelf:"center",background:"none",border:"none",color:"#93c5fd",fontSize:12.5,fontWeight:700,cursor:"pointer",padding:"4px 8px",fontFamily:"inherit"}}>
                  {legendAll?"Ver menos":`Ver todos (${shown.length})`}
                </button>
              )}
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
  </>);
  return(<>
    <style>{`.raceLegendV{display:none;flex-direction:column;gap:2px}.fsBtn{right:12px}.fsBtn:hover,.snapBtn:hover{filter:brightness(1.35)}@media(max-width:640px){.snapBtn{display:none}.fsBtn{right:12px!important}.raceLegendH{display:none}.raceLegendV{display:flex}}`}</style>
    <div ref={fsRef} style={fsMode==="native"?{...{boxSizing:"border-box",overflow:"auto",background:fsBg.bg,backgroundColor:fsBg.color,padding:"26px 24px 18px",borderRadius:0},position:"relative"}:{position:"relative",background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:"20px 16px 12px"}}>
      {fsMode==="css"?<div style={{minHeight:380}}/>:cardBody}
    </div>
    {fsMode==="css"&&typeof document!=="undefined"&&createPortal(
      <div style={{...{boxSizing:"border-box",overflow:"auto",background:fsBg.bg,backgroundColor:fsBg.color,padding:"26px 24px 18px",borderRadius:0},position:"fixed",inset:0,zIndex:9500}}>{cardBody}</div>,document.body)}
    {snapOpen && (<>
      <div aria-hidden="true" style={{position:"fixed",left:-99999,top:0,pointerEvents:"none"}}>
        <SnapshotCard cardRef={cardRef} shown={shown} data={data} raceYMin={raceYMin} raceYMax={raceYMax} dateStr={snapDate} compDay={snapDay} dayTicks={dayTicks} hasSpy={hasSpy} valueOf={snapValueOf} gamePeriod={gamePeriod} periodLabelText={periodLabelText}/>
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

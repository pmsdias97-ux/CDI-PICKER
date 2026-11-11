// Módulo "detail" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, ReferenceLine, Tooltip, Line } from "recharts";
import { toBlob } from "html-to-image";
import { BADGE_ICONS, COMMENT_REACTIONS, K, RANK_BADGE, SECTORS, SECTOR_COLORS, curPrice, isMktOpen, lastDayLabel, money, norm, pct, pfDayRet, pfStats, rSign, raceFull, raceTick, sget, sset, stockRet, timeAgo, useBackRail } from "../lib/core";
import { BreatheGlow, Confetti, GoldGlow, Reveal, Rolling, SideBadge, Skeleton, StockLogo, TiltCard, Tri } from "./ui";
import { LeftBackRail } from "./shell";
import { WinnerMedals } from "./ranking";

/* ---- Evolution chart -----------------------------------------------------
   Lê os snapshots diários (gravados pelo cron) e desenha a evolução da
   rentabilidade. Acrescenta o ponto "hoje" ao vivo para nunca ficar vazio.
   Enche-se ao longo dos dias à medida que o cron corre.
--------------------------------------------------------------------------- */
export function EvoTooltip({active,payload,label,ownLabel="A tua"}){
  if(!active||!payload||!payload.length) return null;
  const rows=payload.filter(p=>p.value!=null);
  if(!rows.length) return null;
  const nameOf=k=>k==="spy"?"S&P 500":ownLabel;
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

export function EvolutionChart({portfolioId,currentReturn,submittedAt,competitionStarted,gameStartDate,spy,spyInitialPrice,mine=true,ownerName,height=210}){
  // No perfil de OUTRO membro, o tooltip/legenda mostram o nome dele (não "A tua").
  const ownLabel=mine?"A tua":(ownerName||"Membro");
  const legendLabel=mine?"A tua rentabilidade":(ownerName||"Rentabilidade");
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
  // Benchmark S&P 500 ancorado a 0 no arranque. Base = spyInitialPrice (SPY no LOCK de 30-jun), a MESMA
  // data-base da rentabilidade do membro (total_return conta desde o lock) → comparação coerente.
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
        <div style={{height}}/>
      ):!enough?(
        <div style={{height:120,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#4b5563",textAlign:"center"}}>
          Começa a preencher-se nos próximos dias.
        </div>
      ):(
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{top:8,right:14,left:-6,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" vertical={false}/>
            <XAxis dataKey="t" tickFormatter={raceTick} ticks={dayTicks} tick={{fill:"#94a3b8",fontSize:11}} minTickGap={28} axisLine={false} tickLine={false}/>
            <YAxis domain={[yMin,yMax]} tickFormatter={(v)=>`${v>0?"+":""}${v}%`} tick={{fill:"#94a3b8",fontSize:11}} width={46} axisLine={false} tickLine={false}/>
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.30)" strokeDasharray="4 4"/>
            <Tooltip content={<EvoTooltip ownLabel={ownLabel}/>}/>
            <Line type="monotone" dataKey="r" name={ownLabel} stroke={col} strokeWidth={2.4} dot={false} isAnimationActive={false}/>
            {hasSpy&&<Line type="monotone" dataKey="spy" name="S&P 500" stroke="#ffffff" strokeWidth={1.8} strokeDasharray="6 5" strokeOpacity={0.7} dot={false} connectNulls isAnimationActive={false}/>}
          </LineChart>
        </ResponsiveContainer>
      )}
      {enough&&hasSpy&&(
        <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:8,fontSize:11.5,color:"#94a3b8"}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:14,height:2,background:col,display:"inline-block",borderRadius:2}}/>{legendLabel}</span>
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
export function SectorDonut({stocks}){
  // Setores 100% do mapa curado (SECTORS) — sem APIs nem "A identificar…".
  // Cobre todos os tickers em uso; um ticker novo (raro) cai em "Outros".
  const [hi,setHi]=useState(null); // setor em destaque (hover)
  const sec=t=>SECTORS[String(t).toUpperCase()]||"Outros";
  const counts={};
  stocks.forEach(s=>{ const k=sec(s.ticker); counts[k]=(counts[k]||0)+1; });
  const total=stocks.length||1;
  // Ordena por peso e agrupa a cauda em "Outros" (máx. ~6 fatias). Assim o card
  // não cresce com o nº de setores — mantém a altura ≈ a do gráfico de Evolução
  // ao lado, para a coluna direita não passar por baixo da lista de ações.
  let entries=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const MAX=6;
  if(entries.length>MAX){
    const head=entries.slice(0,MAX-1);
    const rest=entries.slice(MAX-1).reduce((a,[,n])=>a+n,0);
    entries=[...head,["Outros",rest]];
  }
  const segs=entries.map(([name,n],i)=>({name,n,pct:n/total,
    color:name==="Outros"?"#64748b":SECTOR_COLORS[i%SECTOR_COLORS.length]}));
  // Empresas de cada fatia (para o hover). "Outros" = tudo o que não é um dos setores mostrados.
  const segNames=new Set(segs.filter(s=>s.name!=="Outros").map(s=>s.name));
  const membersOf=name=> name==="Outros"
    ? stocks.filter(s=>!segNames.has(sec(s.ticker)))
    : stocks.filter(s=>sec(s.ticker)===name);
  const R=32.5,SW=26,C=2*Math.PI*R;
  let off=0;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
      <svg viewBox="0 0 100 100" style={{width:"clamp(104px,28vw,128px)",height:"auto",flexShrink:0,overflow:"visible",transform:"rotate(-90deg)"}}>
        {segs.map((s,i)=>{ const len=s.pct*C; const el=(
          <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={s.color}
            strokeWidth={hi===i?SW+4:SW} opacity={hi==null||hi===i?1:0.28}
            style={{transition:"opacity .15s, stroke-width .15s",cursor:"pointer"}}
            onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)}
            strokeDasharray={`${len.toFixed(2)} ${(C-len).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)}/>
        ); off+=len; return el; })}
      </svg>
      {/* Há no máximo 6 linhas (MAX acima), por isso mostramos a legenda completa sem scroll interno. */}
      <div style={{width:"100%",display:"flex",flexDirection:"column",gap:3}}>
        {segs.map((s,i)=>(
          <div key={i} onMouseEnter={()=>setHi(i)} onMouseLeave={()=>setHi(null)}
            style={{display:"flex",alignItems:"center",gap:9,fontSize:12.5,padding:"1px 6px",borderRadius:7,cursor:"pointer",
              opacity:hi==null||hi===i?1:0.4,background:hi===i?"rgba(255,255,255,0.05)":"transparent",transition:"opacity .15s, background .15s"}}>
            <span style={{width:10,height:10,borderRadius:3,background:s.color,flexShrink:0}}/>
            <span style={{flex:1,minWidth:0,color:"#cbd5e1",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.name}</span>
            <span style={{color:"#e2e8f0",fontWeight:700,fontFamily:"monospace"}}>{s.n}</span>
            <span style={{color:"#6b7280",fontFamily:"monospace",minWidth:38,textAlign:"right"}}>{Math.round(s.pct*100)}%</span>
          </div>
        ))}
      </div>
      {/* Empresas do setor em destaque (hover) — área reservada para não mexer no layout. */}
      <div style={{width:"100%",minHeight:30,paddingTop:8}}>
        {hi!=null&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:5,alignItems:"center",justifyContent:"center"}}>
            {membersOf(segs[hi].name).map(s=>(
              <span key={s.ticker} title={s.companyName||s.ticker}
                style={{fontSize:10.5,fontFamily:"monospace",fontWeight:700,color:"#cbd5e1",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.10)",borderRadius:6,padding:"2px 6px"}}>{s.ticker}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Detail -------------------------------------------------------------- */
// Pré-1jul: o próprio desbloqueia o seu portefólio com o código de 3 dígitos.
export function OwnLockedGate({pf,nav,reload,showToast}){
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

export function PortfolioReactions({pf,myNorm,myUserId,adminPw,showToast,onOpenMember,focusRef}){
  const [comments,setComments]=useState(null); // null = a carregar
  const [focusId,setFocusId]=useState(null); // comentário a destacar (vindo de "Últimos comentários")
  const [likeCount,setLikeCount]=useState(0);
  const [liked,setLiked]=useState(false);
  const [draft,setDraft]=useState("");
  const [busy,setBusy]=useState(false);
  const [likeBusy,setLikeBusy]=useState(false);
  const [rx,setRx]=useState({}); // { [commentId]: { emoji: {count, mine} } }
  const loggedIn=!!myUserId;
  const isOwn=!!myNorm && pf.normName===myNorm;
  const creds=()=>({ name:sget(K.MYNAME), pin:sget(K.MYPIN) });
  const aggregateRx=(rows,uid)=>{ const m={}; for(const r of rows||[]){ const c=(m[r.comment_id]=m[r.comment_id]||{}); const e=(c[r.emoji]=c[r.emoji]||{count:0,mine:false,names:[]}); e.count++; e.names.push(r.users?.telegram_name||"Anónimo"); if(uid&&r.user_id===uid) e.mine=true; } return m; };
  // "Pedro" · "Pedro e Maria" · "Pedro, João e Maria" — para o tooltip de quem reagiu.
  const listNames=(a)=>a.length<=1?(a[0]||""):`${a.slice(0,-1).join(", ")} e ${a[a.length-1]}`;

  useEffect(()=>{
    let cancel=false;
    // Consome a intenção de "aterrar num comentário" JÁ (síncrono) → se o utilizador sair antes de
    // carregar, a ref não fica presa e não afeta o próximo perfil aberto.
    const wantFocus=(focusRef&&focusRef.current&&focusRef.current.commentId)||null;
    if(wantFocus) focusRef.current=null;
    (async()=>{
      const { data:cm }=await supabase
        .from("portfolio_comments")
        .select("id, content, created_at, user_id, users!portfolio_comments_user_id_fkey(telegram_name)")
        .eq("portfolio_id",pf.id).order("created_at",{ascending:false}).limit(100);
      if(!cancel) setComments(cm||[]);
      const ids=(cm||[]).map(c=>c.id);
      if(ids.length){
        const { data:rr }=await supabase.from("comment_reactions")
          .select("comment_id, emoji, user_id, users!comment_reactions_user_id_fkey(telegram_name)")
          .in("comment_id",ids);
        if(!cancel) setRx(aggregateRx(rr,myUserId));
      } else if(!cancel){ setRx({}); }
      const { count }=await supabase
        .from("portfolio_likes").select("portfolio_id",{count:"exact",head:true}).eq("portfolio_id",pf.id);
      if(!cancel) setLikeCount(count||0);
      if(myUserId){
        const { data:mine }=await supabase
          .from("portfolio_likes").select("portfolio_id").eq("portfolio_id",pf.id).eq("user_id",myUserId).maybeSingle();
        if(!cancel) setLiked(!!mine);
      }else if(!cancel){ setLiked(false); }
      // Intenção "aterrar num comentário" (vinda do cartão "Últimos comentários"): já consumida
      // acima; se ainda válida e não saímos, faz scroll até ao comentário (ou à secção) e destaca ~2.5s.
      if(!cancel && wantFocus){
        const cid=wantFocus;
        setFocusId(cid);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          const el=(typeof document!=="undefined")&&(document.getElementById(`cmt-${cid}`)||document.getElementById("detComments"));
          if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
        }));
        setTimeout(()=>{ if(!cancel) setFocusId(null); },2600);
      }
    })();
    return()=>{ cancel=true; };
  },[pf.id,myUserId]);

  const toggleLike=async()=>{
    if(!loggedIn){ showToast&&showToast("Submete um portefólio para reagir.","error"); return; }
    if(likeBusy) return; setLikeBusy(true);
    const prev=liked, prevN=likeCount;
    setLiked(!prev); setLikeCount(prevN+(prev?-1:1)); // otimista
    try{
      const { name,pin }=creds();
      const res=await fetch("/api/likes/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,pin,portfolioId:pf.id})});
      const j=await res.json().catch(()=>({}));
      if(!res.ok){ setLiked(prev); setLikeCount(prevN); showToast&&showToast(j.error||"Falha ao gostar.","error"); }
      else setLiked(!!j.liked);
    }catch{ setLiked(prev); setLikeCount(prevN); showToast&&showToast("Falha de ligação.","error"); }
    finally{ setLikeBusy(false); }
  };

  const submit=async()=>{
    const text=draft.trim();
    if(!loggedIn){ showToast&&showToast("Submete um portefólio para comentar.","error"); return; }
    if(!text||busy) return;
    if(text.length>500){ showToast&&showToast("Máx. 500 caracteres.","error"); return; }
    setBusy(true);
    try{
      const { name,pin }=creds();
      const res=await fetch("/api/comments/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,pin,portfolioId:pf.id,content:text})});
      const j=await res.json().catch(()=>({}));
      if(!res.ok||!j.comment){ showToast&&showToast(j.error||"Falha ao publicar.","error"); }
      else { setComments(cs=>[{...j.comment,users:{telegram_name:name}},...(cs||[])]); setDraft(""); }
    }catch{ showToast&&showToast("Falha de ligação.","error"); }
    finally{ setBusy(false); }
  };

  const del=async(c)=>{
    const mine=myUserId&&c.user_id===myUserId;
    const asAdmin=!mine&&!!adminPw;
    if(!mine&&!asAdmin) return;
    const prev=comments;
    setComments(cs=>(cs||[]).filter(x=>x.id!==c.id)); // otimista
    try{
      const body=asAdmin?{commentId:c.id,adminPassword:adminPw}:{commentId:c.id,...creds()};
      const res=await fetch("/api/comments/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(!res.ok){ const j=await res.json().catch(()=>({})); setComments(prev); showToast&&showToast(j.error||"Falha ao apagar.","error"); }
    }catch{ setComments(prev); showToast&&showToast("Falha de ligação.","error"); }
  };

  const toggleReaction=async(commentId,emoji)=>{
    if(!loggedIn){ showToast&&showToast("Submete um portefólio para reagir.","error"); return; }
    const cur=rx[commentId]?.[emoji]||{count:0,mine:false,names:[]};
    const nextMine=!cur.mine;
    const setCell=(cell)=>setRx(prev=>{ const c={...(prev[commentId]||{})}; c[emoji]=cell; return {...prev,[commentId]:c}; });
    // otimista — mantém a lista de QUEM reagiu (tooltip) coerente: junta/retira o próprio nome.
    const me=(creds().name||"").trim();
    const nextNames=nextMine?[...(cur.names||[]),me||"Tu"]:(cur.names||[]).filter(n=>norm(n)!==norm(me));
    setCell({count:Math.max(0,cur.count+(nextMine?1:-1)),mine:nextMine,names:nextNames}); // otimista
    try{
      const { name,pin }=creds();
      const res=await fetch("/api/comments/react",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,pin,commentId,emoji})});
      const j=await res.json().catch(()=>({}));
      if(!res.ok){ setCell(cur); showToast&&showToast(j.error||"Falha ao reagir.","error"); }
    }catch{ setCell(cur); showToast&&showToast("Falha de ligação.","error"); }
  };

  const card={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24};
  const canSend=!busy&&!!draft.trim();
  return(
    <div style={card}>
      <style>{`
        .cmtReactBtn{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;
          font-size:12.5px;font-weight:700;line-height:1;font-family:inherit;transition:all .12s;cursor:pointer;
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);color:#94a3b8}
        /* Wrapper do chip (tooltip "quem reagiu"). DECLARADO ANTES do .cmtReactPick: com a mesma
           especificidade, a regra mais TARDIA ganha — o display:none do picker tem de vencer este
           display:inline-flex (senão o picker ficava sempre visível). */
        .cmtWho{position:relative;display:inline-flex}
        /* Só em rato/hover: o picker (emojis ainda não escolhidos) esconde-se e aparece ao passar por
           cima do comentário. Em ecrãs táteis (sem hover) fica sempre visível para continuar acessível. */
        @media (hover:hover){
          .cmtReactPick{display:none}
          .cmtRow:hover .cmtReactPick{display:inline-flex}
        }
        /* Bolha "quem reagiu": tooltip próprio, instantâneo, no WRAPPER do chip — o title nativo não
           aparece em botões disabled (próprio comentário) nem é imediato. Só em dispositivos com rato. */
        @media (hover:hover){
          .cmtWho[data-who]:hover::after{content:attr(data-who);position:absolute;bottom:calc(100% + 7px);left:50%;
            transform:translateX(-50%);background:rgba(10,15,28,0.96);border:1px solid rgba(255,255,255,0.14);
            color:#e2e8f0;font-size:11.5px;font-weight:600;line-height:1.35;padding:5px 9px;border-radius:8px;
            width:max-content;max-width:240px;white-space:normal;text-align:center;z-index:40;pointer-events:none;
            box-shadow:0 10px 24px rgba(0,0,0,0.45)}
        }
        @keyframes cmtFlashKf{0%,55%{background:rgba(96,165,250,0.16)}100%{background:transparent}}
        .cmtFlash{animation:cmtFlashKf 2.6s ease-out;border-radius:10px}
      `}</style>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,minHeight:34,marginBottom:16,flexWrap:"wrap"}}>
        <h3 style={{fontSize:15,fontWeight:700,margin:0,color:"#e2e8f0"}}>Comentários</h3>
        {!isOwn&&(
          <button onClick={toggleLike} disabled={likeBusy}
            title={loggedIn?(liked?"Remover gosto":"Dar gosto"):"Submete para reagir"}
            style={{display:"inline-flex",alignItems:"center",gap:8,cursor:loggedIn?"pointer":"not-allowed",
              border:`1px solid ${liked?"rgba(244,63,94,0.5)":"rgba(255,255,255,0.14)"}`,borderRadius:999,padding:"7px 14px",
              background:liked?"rgba(244,63,94,0.14)":"rgba(255,255,255,0.05)",color:liked?"#fb7185":"#cbd5e1",fontWeight:700,fontSize:14,opacity:loggedIn?1:0.65,transition:"all .15s"}}>
            <span style={{fontSize:16,lineHeight:1}}>{liked?"❤️":"🤍"}</span>{likeCount}
          </button>
        )}
      </div>
      {loggedIn?(
        <div style={{marginBottom:18}}>
          <textarea value={draft} onChange={e=>setDraft(e.target.value.slice(0,500))} rows={2}
            placeholder={isOwn?"Responde aos comentários…":"Escreve aqui..."}
            style={{width:"100%",boxSizing:"border-box",resize:"vertical",minHeight:52,background:"rgba(0,0,0,0.22)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:12,padding:"10px 12px",color:"#e2e8f0",fontSize:14,outline:"none",fontFamily:"inherit",lineHeight:1.5}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:8,gap:10}}>
            <span style={{fontSize:12,color:"#64748b"}}>{draft.length}/500</span>
            <button onClick={submit} disabled={!canSend}
              style={{cursor:canSend?"pointer":"not-allowed",border:"none",borderRadius:10,padding:"8px 18px",fontSize:14,fontWeight:700,
                background:canSend?"linear-gradient(180deg,#3b82f6,#2563eb)":"rgba(255,255,255,0.08)",color:canSend?"#fff":"#64748b"}}>
              {busy?"A publicar…":"Publicar"}
            </button>
          </div>
        </div>
      ):(
        <div style={{marginBottom:18,padding:"12px 14px",borderRadius:12,background:"rgba(255,255,255,0.04)",border:"1px dashed rgba(255,255,255,0.12)",fontSize:13.5,color:"#94a3b8",textAlign:"center"}}>
          Submete um portefólio para dar gosto e comentar.
        </div>
      )}
      {comments===null?(
        <div style={{fontSize:13,color:"#64748b",padding:"8px 0"}}>A carregar…</div>
      ):comments.length===0?null:(
        <div>
          {comments.map(c=>{
            const author=c.users?.telegram_name||"Anónimo";
            const isMyComment=!!myUserId&&c.user_id===myUserId;
            const canDel=isMyComment||!!adminPw;
            const canOpen=!!onOpenMember&&!!c.user_id;
            const openAuthor=()=>{ if(canOpen) onOpenMember(c.user_id); };
            return(
              <div key={c.id} id={`cmt-${c.id}`} className={"cmtRow"+(focusId===c.id?" cmtFlash":"")} style={{display:"flex",gap:11,padding:"11px 0",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                <div onClick={openAuthor} title={canOpen?"Ver portefólio":undefined} style={{width:34,height:34,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.10)",fontWeight:800,fontSize:14,color:"#cbd5e1",cursor:canOpen?"pointer":"default"}}>{author.slice(0,1).toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span onClick={openAuthor} title={canOpen?"Ver portefólio":undefined} style={{fontWeight:700,fontSize:13.5,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:canOpen?"pointer":"default"}}
                      onMouseEnter={canOpen?(e=>e.currentTarget.style.textDecoration="underline"):undefined}
                      onMouseLeave={canOpen?(e=>e.currentTarget.style.textDecoration="none"):undefined}>{author}</span>
                    <span style={{fontSize:11.5,color:"#64748b",flexShrink:0}}>{timeAgo(c.created_at)}</span>
                    {canDel&&<button onClick={()=>del(c)} title="Apagar" style={{marginLeft:"auto",background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:12,padding:2,flexShrink:0}}>apagar</button>}
                  </div>
                  {/* Texto + reações "à frente" (inline a seguir). Já escolhidas → sempre visíveis;
                      o resto do picker só aparece ao passar o rato (classe cmtReactPick). */}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:2}}>
                    <span style={{fontSize:14,color:"#cbd5e1",lineHeight:1.5,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{c.content}</span>
                    <span style={{display:"inline-flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
                      {/* Reações DADAS primeiro (mais contagens à esquerda); o picker (0) fica à direita
                          e só aparece em hover (cmtReactPick). Sort estável → empates mantêm ❤️🔥😂. */}
                      {[...COMMENT_REACTIONS].sort((x,y)=>(rx[c.id]?.[y]?.count||0)-(rx[c.id]?.[x]?.count||0)).map(emoji=>{
                        const cell=rx[c.id]?.[emoji]; const count=cell?.count||0; const mine=!!cell?.mine;
                        // No PRÓPRIO comentário não se pode reagir: esconde o picker; mostra só as reações
                        // (dos outros) que já existem, de leitura.
                        if(isMyComment&&count===0) return null;
                        // Hover num chip com reações → bolha própria com QUEM reagiu (o title nativo não
                        // aparece em botões disabled — próprio comentário — nem é imediato). Picker (0) mantém a dica.
                        const who=count>0?listNames(cell.names||[]):null;
                        return(
                          <span key={emoji} className={`cmtWho${count>0?"":" cmtReactPick"}`} data-who={who||undefined}>
                            <button onClick={isMyComment?undefined:()=>toggleReaction(c.id,emoji)}
                              className="cmtReactBtn" disabled={isMyComment}
                              title={who?undefined:(isMyComment?"Reações ao teu comentário":(loggedIn?(mine?"Remover reação":"Reagir"):"Submete para reagir"))}
                              style={{...(mine?{borderColor:"rgba(96,165,250,0.55)",background:"rgba(96,165,250,0.15)",color:"#93c5fd"}:{}),...(isMyComment?{cursor:"default"}:(loggedIn?{}:{cursor:"not-allowed"}))}}>
                              <span style={{fontSize:13}}>{emoji}</span>{count>0&&<span>{count}</span>}
                            </button>
                          </span>
                        );
                      })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Gráfico "líderes e atrasados": as 8 ações da carteira ordenadas por rentabilidade, em barras
// DIVERGENTES (verde à direita = ganho da POSIÇÃO, vermelho à esquerda = perda; short = espelho),
// com toggle Dia/Semana/Mês. Enche o espaço vazio da coluna de análises (flex:1). Só desktop.
export function SlotChart({pf,livePrices,dayChange,monthBase,weekBase}){
  const [period,setPeriod]=useState("day");
  const rows=useMemo(()=>{
    const out=(pf.stocks||[]).map(s=>{
      const init=s.initialPrice, cur=curPrice(s.ticker,init,livePrices);
      const mir=(v)=> s.side==="short"?-v:v; // short = espelho (a posição ganha quando a ação cai)
      let ret=null;
      if(period==="day"){ const d=dayChange&&dayChange[s.ticker]; if(Number.isFinite(d)) ret=mir(d); }
      else if(period==="week"){ const wb=weekBase&&weekBase[s.ticker]; if(wb>0&&Number.isFinite(cur)&&cur>0) ret=mir(cur/wb-1); }
      else { const mb=monthBase&&monthBase[s.ticker]; const b=(mb>0)?mb:init; if(b>0&&Number.isFinite(cur)&&cur>0) ret=mir(cur/b-1); }
      return {ticker:s.ticker,ret};
    }).filter(x=>x.ret!=null);
    out.sort((a,b)=>b.ret-a.ret);
    return out;
  },[pf.stocks,period,livePrices,dayChange,monthBase,weekBase]);
  const maxAbs=Math.max(0.0001,...rows.map(r=>Math.abs(r.ret)));
  // justifyContent:center → o bloco [toggle + barras] fica centrado na vertical: margem igual em cima e em baixo.
  const card={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:"20px",flex:1,minHeight:0,display:"flex",flexDirection:"column",justifyContent:"center"};
  const tog=(k,lbl)=>(
    <button key={k} onClick={()=>setPeriod(k)} style={{cursor:"pointer",fontSize:11.5,fontWeight:700,borderRadius:999,padding:"5px 11px",border:"none",whiteSpace:"nowrap",transition:"all .15s",color:period===k?"#0a0a0a":"#cbd5e1",background:period===k?"#4ade80":"transparent"}}>{lbl}</button>
  );
  return(
    <div style={card}>
      {/* Sem título; toggle centrado. marginBottom = padding do cartão (18) → mesma margem em cima e em baixo. */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:18}}>
        <div style={{display:"inline-flex",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:999,padding:2}}>
          {tog("day","Dia")}{tog("week","Semana")}{tog("month","Mês")}
        </div>
      </div>
      {rows.length?(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {rows.map(r=>{ const w=(Math.abs(r.ret)/maxAbs)*50, up=r.ret>=0; return(
            <div key={r.ticker} style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{width:50,flexShrink:0,fontSize:12.5,fontWeight:700,color:"#e2e8f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.ticker}</span>
              <div style={{flex:1,position:"relative",height:14,minWidth:0}}>
                <div style={{position:"absolute",left:"50%",top:-3,bottom:-3,width:1,background:"rgba(255,255,255,0.14)"}}/>
                <div style={{position:"absolute",top:0,bottom:0,width:`${w}%`,...(up?{left:"50%",background:"linear-gradient(90deg,#16a34a,#4ade80)",borderRadius:"0 4px 4px 0"}:{right:"50%",background:"linear-gradient(270deg,#dc2626,#f87171)",borderRadius:"4px 0 0 4px"})}}/>
              </div>
              <span style={{width:66,flexShrink:0,textAlign:"right",fontFamily:"ui-monospace, monospace",fontSize:12.5,fontWeight:800,color:up?"#4ade80":"#f87171"}}>{pct(r.ret)}</span>
            </div>
          ); })}
        </div>
      ):(
        <div style={{padding:"48px 0",textAlign:"center",color:"#64748b",fontSize:13}}>
          {period==="week"?"O ranking semanal arranca 2ª feira.":"Sem dados disponíveis."}
        </div>
      )}
    </div>
  );
}

// Badges de conquistas de um portefólio (gamificação leve). Vive dentro da box "Overview".
export function AchievementBadges({pf,rank,wins,card}){
  const [badges,setBadges]=useState(null);
  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        const slug=encodeURIComponent(pf?.name||pf?.normName||"");
        const rq=(Number.isInteger(rank)&&rank>=1)?`&rank=${rank}`:""; // rank AO VIVO → 3º = Pódio, não Top 10
        const res=await fetch(`/api/portfolio/badges?slug=${slug}${rq}`);
        const json=await res.json();
        if(!cancel) setBadges(json.ok?json.badges||[]:[]);
      }catch{
        if(!cancel) setBadges([]);
      }
    })();
    return()=>{cancel=true};
  },[pf?.name,pf?.normName,rank]);

  // Enquanto carrega ou sem conquistas → nada (não deixa o cartão vazio).
  const hasWins=!!(wins&&wins.length);
  if(!badges||(!badges.length&&!hasWins)) return null;

  const colors={
    "beat-spy":{bg:"rgba(245,158,11,0.15)",border:"rgba(245,158,11,0.35)",color:"#facc15"},
    "all-green":{bg:"rgba(34,197,94,0.15)",border:"rgba(34,197,94,0.35)",color:"#4ade80"},
    "short-master":{bg:"rgba(56,189,248,0.15)",border:"rgba(56,189,248,0.35)",color:"#7dd3fc"},
    resilient:{bg:"rgba(168,85,247,0.15)",border:"rgba(168,85,247,0.35)",color:"#c084fc"},
    leader:{bg:"rgba(250,204,21,0.18)",border:"rgba(250,204,21,0.42)",color:"#fde047"},
    podium:{bg:"rgba(217,119,6,0.15)",border:"rgba(217,119,6,0.35)",color:"#fbbf24"},
    top10:{bg:"rgba(96,165,250,0.15)",border:"rgba(96,165,250,0.35)",color:"#93c5fd"},
    "gain-10":{bg:"rgba(34,197,94,0.15)",border:"rgba(34,197,94,0.35)",color:"#4ade80"},
    "gain-20":{bg:"rgba(16,185,129,0.18)",border:"rgba(16,185,129,0.4)",color:"#34d399"},
    "green-streak":{bg:"rgba(251,146,60,0.16)",border:"rgba(251,146,60,0.38)",color:"#fb923c"},
  };
  const tiles=[
    ...(hasWins?[{id:"weekly-wins",label:`Vencedor ${wins.length>1?`(${wins.length}×)`:"semanal"}`,description:wins.join(", "),_c:{bg:"rgba(250,204,21,0.16)",border:"rgba(250,204,21,0.42)",color:"#fde047"},_emoji:"🏆"}]:[]),
    ...badges,
  ];
  return(
    <div style={card}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",minHeight:34,marginBottom:12}}>
        <h3 style={{fontSize:15,fontWeight:700,margin:0,color:"#e2e8f0"}}>Conquistas</h3>
        <span style={{fontSize:11.5,fontWeight:800,color:"#94a3b8",padding:"3px 10px",borderRadius:999,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.10)"}}>{tiles.length} {tiles.length===1?"desbloqueada":"desbloqueadas"}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
        {tiles.map((b)=>{
          const c=b._c||colors[b.id]||{bg:"rgba(255,255,255,0.08)",border:"rgba(255,255,255,0.18)",color:"#e2e8f0"};
          return(
            <div key={b.id} title={b.description} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,minWidth:0,
              background:`linear-gradient(135deg,${c.bg},rgba(255,255,255,0.02))`,border:`1px solid ${c.border}`,boxShadow:`0 0 18px ${c.bg}`}}>
              <span style={{width:38,height:38,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                background:c.bg,border:`1px solid ${c.border}`,color:c.color,boxShadow:`0 0 14px ${c.bg}`,fontSize:18}}>
                {b._emoji||<svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{BADGE_ICONS[b.id]||null}</svg>}
              </span>
              <span style={{minWidth:0}}>
                <span style={{display:"block",fontSize:13.5,fontWeight:800,color:c.color,lineHeight:1.2}}>{b.label}</span>
                {b.description&&<span style={{display:"block",fontSize:11.5,color:"#94a3b8",marginTop:3,lineHeight:1.3}}>{b.description}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cartão "Conquistas": troféus/badges do membro (as posições Geral/Mensal/Semanal vivem agora no hero). standings vem do App.
export function GameStandings({standings,pf}){
  if(!standings||!pf) return null;
  const card={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24};
  return <AchievementBadges pf={pf} rank={standings?.geral?.rank} wins={standings.weeklyWins} card={card}/>;
}

// Cartão PARTILHÁVEL do portefólio (fundos SÓLIDOS → captura limpa com html-to-image). Usa os logótipos
// reais (StockLogo → img.logo.dev, com fallback Monograma) e mostra os lugares Geral/Mensal/Semanal.
export function PortfolioShareCard({cardRef,name,total,stocks,ranks}){
  const pos=total>=0;
  const A=pos?{rgb:"52,211,153",c:"#34d399"}:{rgb:"251,113,133",c:"#fb7185"}; // verde / vermelho do resultado
  const list=[...(stocks||[])].sort((a,b)=>b.ret-a.ret);
  const maxAbs=Math.max(0.0001,...list.map(s=>Math.abs(s.ret)));
  const nPos=list.filter(s=>rSign(s.ret)>0).length, nNeg=list.filter(s=>rSign(s.ret)<0).length;
  const tiles=[
    ranks?.geral!=null&&{label:"Geral",v:ranks.geral,c:"#60a5fa",bg:"#13264d",bd:"rgba(96,165,250,0.45)"},
    ranks?.month!=null&&{label:"Mensal",v:ranks.month,c:"#a78bfa",bg:"#231d4a",bd:"rgba(167,139,250,0.45)"},
    ranks?.week!=null&&{label:"Semanal",v:ranks.week,c:"#2dd4bf",bg:"#0f3040",bd:"rgba(45,212,191,0.45)"},
  ].filter(Boolean);
  const date=new Date().toLocaleDateString("pt-PT",{day:"numeric",month:"short",year:"numeric"});
  return(
    <div ref={cardRef} style={{width:420,boxSizing:"border-box",padding:"26px 24px 24px",fontFamily:"var(--font-app), system-ui, sans-serif",
      background:`radial-gradient(420px 260px at 50% -40px, rgba(${A.rgb},0.20) 0%, rgba(${A.rgb},0) 70%), linear-gradient(180deg,#0f1e3d 0%,#0a1428 100%)`,
      color:"#e2e8f0",borderRadius:22,border:`1px solid rgba(${A.rgb},0.28)`}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:11,fontWeight:800,letterSpacing:"2.4px",textTransform:"uppercase",color:"#64748b"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:7}}><span style={{width:7,height:7,borderRadius:"50%",background:A.c,display:"inline-block"}}/>CDI Picker</span>
        <span style={{letterSpacing:"0.4px",textTransform:"none",fontWeight:600}}>{date}</span>
      </div>
      <div style={{textAlign:"center",marginTop:22}}>
        <div style={{fontSize:24,fontWeight:800,letterSpacing:"-0.4px"}}>{name}</div>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",color:"#64748b",marginTop:14}}>Rentabilidade total</div>
        <div style={{display:"inline-flex",alignItems:"center",gap:10,marginTop:4,color:A.c,fontSize:56,fontWeight:800,letterSpacing:"-1.5px",lineHeight:1.05}}>
          <Tri up={pos} size={34} color={A.c}/>{pct(Math.abs(total))}
        </div>
      </div>
      {list.length>0&&(
        <div style={{marginTop:18}}>
          <div style={{display:"flex",gap:4}}>
            {list.map((s,i)=>{ const d=rSign(s.ret); return <span key={i} style={{flex:1,height:6,borderRadius:3,background:d>0?"#34d399":d<0?"#fb7185":"#64748b"}}/>; })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:7,fontSize:12,fontWeight:700}}>
            <span style={{color:"#34d399"}}>{nPos} positivas</span><span style={{color:"#fb7185"}}>{nNeg} negativas</span>
          </div>
        </div>
      )}
      {tiles.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:`repeat(${tiles.length},1fr)`,gap:9,marginTop:18}}>
          {tiles.map(t=>(
            <div key={t.label} style={{background:t.bg,border:`1px solid ${t.bd}`,borderRadius:14,padding:"11px 6px 12px",textAlign:"center"}}>
              <div style={{fontSize:10.5,fontWeight:800,letterSpacing:"1.6px",textTransform:"uppercase",color:t.c}}>{t.label}</div>
              <div style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",lineHeight:1.1,marginTop:4,color:"#f8fafc"}}>{t.v}º</div>
            </div>
          ))}
        </div>
      )}
      <div style={{marginTop:18,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {list.map((s,i)=>{
          const up=s.ret>=0, w=Math.max(8,Math.min(100,Math.abs(s.ret)/maxAbs*100));
          return(
            <div key={i} style={{background:"#101c36",border:"1px solid rgba(255,255,255,0.08)",borderRadius:12,padding:"9px 11px 10px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <StockLogo ticker={s.ticker} size={22}/>
                <span style={{fontWeight:800,fontSize:13.5,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.ticker}{s.side==="short"?" ↓":""}</span>
                <span style={{fontWeight:800,fontSize:13,color:up?"#34d399":"#fb7185"}}>{pct(s.ret)}</span>
              </div>
              <div style={{height:4,borderRadius:2,background:"rgba(255,255,255,0.07)",marginTop:8,overflow:"hidden"}}>
                <div style={{width:`${w}%`,height:"100%",borderRadius:2,background:up?"#34d399":"#fb7185"}}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Detail({pf,rank,rowHover="#0a1120",livePrices,priceStale,dayChange,marketClosed,spy,nav,onBack,myNorm,myUserId,adminPw,preLaunch,competitionStarted,gameStartDate,winners,standings,monthBase,weekBase,reload,showToast,onOpenMember,focusRef}){
  const goBack=onBack||(()=>nav("ranking")); // voltar ao ranking (com destaque da linha, via onBack)
  // Coluna de rentabilidade da lista: "total" (desde a compra) ↔ "day" (diário).
  const [retMode,setRetMode]=useState("total");
  const rail=useBackRail();
  // Cartão partilhável (hooks ANTES dos early returns → contagem de hooks estável).
  const [shareOpen,setShareOpen]=useState(false);
  const [shareUrl,setShareUrl]=useState("");
  const [shareBlob,setShareBlob]=useState(null);
  const [shareMsg,setShareMsg]=useState("");
  const shareCardRef=useRef(null);
  useEffect(()=>{
    if(!shareOpen){ setShareUrl(""); setShareBlob(null); setShareMsg(""); return; }
    let cancel=false;
    const t=setTimeout(async()=>{
      try{
        if(!shareCardRef.current) return;
        const blob=await toBlob(shareCardRef.current,{pixelRatio:2,cacheBust:true,backgroundColor:"#0a1428"});
        if(cancel) return;
        if(!blob){ setShareMsg("Falha ao gerar a imagem."); return; }
        setShareBlob(blob);
        const rd=new FileReader(); rd.onload=()=>{ if(!cancel) setShareUrl(String(rd.result||"")); }; rd.readAsDataURL(blob);
      }catch(e){ console.error("Partilha: falha ao gerar a imagem",e); if(!cancel) setShareMsg("Falha ao gerar a imagem."); }
    },250);
    return()=>{ cancel=true; clearTimeout(t); };
  },[shareOpen]);
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
  // Cartão partilhável: dados + ações (download / copiar / partilha nativa em mobile).
  const shareDate=new Date().toLocaleDateString("pt-PT",{day:"numeric",month:"short"});
  const shareStocks=bySorted.map(s=>({ticker:s.ticker,side:s.side,ret:s.ret}));
  const shareFileName=`cdi-picker-${String(pf.name||"portefolio").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"portefolio"}.png`;
  const shareDownload=()=>{ if(!shareUrl) return; const a=document.createElement("a"); a.href=shareUrl; a.download=shareFileName; a.click(); };
  const shareCopy=async()=>{ if(!shareBlob) return; try{ if(!navigator.clipboard||typeof window.ClipboardItem==="undefined") throw 0; await navigator.clipboard.write([new window.ClipboardItem({[shareBlob.type||"image/png"]:shareBlob})]); setShareMsg("Imagem copiada ✓"); }catch{ setShareMsg("O browser não deixou copiar — descarrega em vez disso."); } };
  const shareNative=async()=>{ if(!shareBlob) return; try{ const file=new File([shareBlob],shareFileName,{type:shareBlob.type||"image/png"}); if(navigator.canShare&&navigator.canShare({files:[file]})) await navigator.share({files:[file],title:"CDI Picker",text:`${pf.name} · ${pct(st.total)} no CDI Picker`}); else shareDownload(); }catch{} };
  // Destaques: melhor/pior performance DO DIA (variação vs fecho anterior),
  // espelhada para shorts. Só inclui ações com variação diária disponível.
  const dc=dayChange||{};
  const byDay=rows.map(s=>{
    const raw=dc[s.ticker];
    if(!Number.isFinite(raw)) return null;
    return {...s,ret:s.side==="short"?-raw:raw};
  }).filter(Boolean).sort((a,b)=>b.ret-a.ret);
  // Maior |retorno| da coluna ativa → escala as barras de magnitude da tabela.
  const retMaxAbs=Math.max(0.0001,...bySorted.map(s=>{ if(retMode==="day"){ const d=dc[s.ticker]; return Number.isFinite(d)?Math.abs(d):0; } return Math.abs(s.ret); }));
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  return(
    <div style={{maxWidth:1320,margin:"0 auto",padding:"40px 20px 80px"}}>
      {rail.active&&<LeftBackRail gap={rail.gap} onBack={goBack}/>}
      {rank===1&&<Confetti key={pf.key} intense={!!myNorm && pf.normName===myNorm}/>}
      <style>{`
        /* Duas colunas INDEPENDENTES: a esquerda = lista de ações + "Overview"; a direita = análises +
           comentários. Cada coluna flui a SUA altura → o "Overview" fica sempre colado à lista de ações,
           sem a gap que surgia quando a coluna direita (donut com muitos setores) ficava mais alta. */
        .cdiDetail{display:grid;gap:16px;grid-template-columns:1fr}
        .detColL,.detColR{display:contents}   /* mobile: os 4 cartões fluem direto na grelha (ordem via order) */
        .detLeft{order:1}.detRight{order:2}.detStats{order:3}.detComments{order:4}
        .detLeft,.detRight,.detStats,.detComments{min-width:0}
        .detSlot{display:none}   /* gráfico só em desktop */
        @media(min-width:1000px){
          .cdiDetail{grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);align-items:start}
          .detColL,.detColR{display:flex;flex-direction:column;gap:16px;min-width:0}
          .detRight{display:flex;flex-direction:column}
          .detSlot{display:flex;margin-top:16px}
        }
      `}</style>
      {!rail.active&&(
      <button onClick={goBack} className="backLink"
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        <span className="backArrow">←</span> Ranking
      </button>
      )}

      <div className="cdiDetail">
      <div className="detColL">
      <div className="detLeft">{/* coluna esquerda: portefólio */}
      <div style={{position:"relative",marginBottom:16}}>
        {/* 📚 Piada da casa: o ÚLTIMO lugar do Ranking Geral ganha o livro "Pai Rico, Pai Pobre"
            pousado no cartão — clicar abre o PDF numa nova aba. (Só oficiais, com ≥2 classificados.) */}
        {standings?.geral&&standings.geral.n>=2&&standings.geral.rank===standings.geral.n&&(
          <a href="https://dn710201.ca.archive.org/0/items/pai-rico-pai-pobre-edicao-de-20-anos-atualizada-e-ampliada-o-que-os-ricos-ensina/Pai%20Rico,%20Pai%20Pobre%20-%20Edi%C3%A7%C3%A3o%20de%2020%20anos%20atualizada%20e%20ampliada%20O%20que%20os%20ricos%20ensinam%20a%20seus%20filhos%20sobre%20dinheiro%20(Robert%20T.%20Kiyosaki)%20(Z-Library).pdf"
            target="_blank" rel="noopener noreferrer" title="Leitura recomendada 📚"
            style={{position:"absolute",top:"clamp(-42px,-4.5vw,-30px)",right:"clamp(2px,1.5vw,14px)",width:"clamp(62px,7vw,86px)",zIndex:6,display:"block",
              transform:"rotate(10deg)",transition:"transform .25s ease, filter .25s ease",
              filter:"drop-shadow(0 10px 20px rgba(0,0,0,0.5))"}}
            onMouseEnter={e=>{ e.currentTarget.style.transform="rotate(5deg) scale(1.08)"; e.currentTarget.style.filter="drop-shadow(0 14px 26px rgba(0,0,0,0.55))"; }}
            onMouseLeave={e=>{ e.currentTarget.style.transform="rotate(10deg)"; e.currentTarget.style.filter="drop-shadow(0 10px 20px rgba(0,0,0,0.5))"; }}>
            <img src="/pairicopaipobre.webp" alt="Pai Rico, Pai Pobre" style={{width:"100%",height:"auto",display:"block"}}/>
          </a>
        )}
        {rank>=1&&rank<=3&&(
          <BreatheGlow inset="-16% -10%" base={0.4}
            color={rank===1?"rgba(245,200,80,0.55)":rank===2?"rgba(203,213,225,0.5)":"rgba(217,140,60,0.55)"}
            mid={rank===1?"rgba(245,158,11,0.18)":rank===2?"rgba(226,232,240,0.16)":"rgba(217,119,6,0.18)"}/>
        )}
        {rank>=1&&rank<=3&&(()=>{
          // Louros por lugar: 1º ouro, 2º prata (grey), 3º bronze (brown) — com o brilho a condizer.
          const L={
            1:{src:"/cdi-louros.webp",       g:"245,158,11", s:"253,224,71", bf:"rgba(245,158,11,0.4)"},
            2:{src:"/cdi-louros-grey.webp",  g:"148,163,184", s:"241,245,249", bf:"rgba(203,213,225,0.4)"},
            3:{src:"/cdi-louros-brown.webp", g:"180,83,9",   s:"251,191,36", bf:"rgba(217,119,6,0.4)"},
          }[rank];
          return (
            <GoldGlow src={L.src} alt={`Louros de ${rank}º lugar`} maskSrc={L.src} glow={26} glowRGB={L.g} sparkRGB={L.s}
              baseFilter={`drop-shadow(0 12px 22px rgba(0,0,0,0.5)) drop-shadow(0 0 20px ${L.bf})`}
              wrapStyle={{position:"absolute",top:"clamp(-66px,-7vw,-54px)",left:"50%",transform:"translateX(-50%)",width:"clamp(60px,7vw,72px)",zIndex:5}}
              imgStyle={{width:"100%",height:"auto"}}/>
          );
        })()}
      <TiltCard style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:acc?acc.border:"1px solid rgba(255,255,255,0.10)",boxShadow:acc?`${acc.glow}, 0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.16)`:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:28,zIndex:1,position:"relative"}}>
        <button onClick={()=>setShareOpen(true)} title="Partilhar cartão" aria-label="Partilhar cartão"
          style={{position:"absolute",top:14,right:14,width:24,height:24,padding:0,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",zIndex:3,
            background:"none",border:"none",color:"#94a3b8",opacity:0.7,transition:"opacity .15s, color .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.color="#e2e8f0";}}
          onMouseLeave={e=>{e.currentTarget.style.opacity="0.7";e.currentTarget.style.color="#94a3b8";}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>
        </button>
        <div style={{textAlign:"center"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",flexWrap:"wrap",gap:14,marginBottom:16,minWidth:0}}>
            {rank>0&&(rank<=3
              ? <span className="rankShine rankBreathe" style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:20,fontWeight:800,...RANK_BADGE[rank],"--shine-delay":`${(rank-1)*1.2}s`}}>{rank}</span>
              : <span style={{width:46,height:46,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,fontWeight:800,color:"#94a3b8",border:"2px solid rgba(255,255,255,0.12)"}}>{rank}</span>
            )}
            <h1 style={{fontSize:"clamp(22px,5vw,26px)",fontWeight:800,letterSpacing:"-0.5px",margin:0,minWidth:0,lineHeight:1.2,overflowWrap:"anywhere"}}>{pf.name}</h1>
            <WinnerMedals w={winners&&winners[pf.key]} size={36}/>
          </div>
          <div style={{fontSize:"clamp(34px,9vw,42px)",fontWeight:800,fontFamily:"monospace",lineHeight:1,
            color:st.total>=0?"#4ade80":"#f87171"}}><Tri up={st.total>=0} size="0.78em"/> <Rolling text={pct(Math.abs(st.total)).replace(/[+-]/,"")}/></div>
          <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"center",gap:"8px 12px",marginTop:10}}>
            {dayRet!=null&&(
              <span title={marketClosed?"Rentabilidade no último pregão":"Rentabilidade do portefólio hoje"}
                style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:12,fontWeight:700,color:"#cbd5e1",padding:"4px 11px",borderRadius:999,
                  background:dayRet>=0?"rgba(34,197,94,0.10)":"rgba(239,68,68,0.10)",border:`1px solid ${dayRet>=0?"rgba(34,197,94,0.32)":"rgba(239,68,68,0.32)"}`}}>
                {lastDayLabel()}
                <strong style={{fontFamily:"monospace",color:dayRet>=0?"#4ade80":"#f87171"}}><Rolling text={pct(dayRet)}/></strong>
              </span>
            )}
          </div>
          {/* Saúde da carteira: 1 segmento por ação (verde = ganho, vermelho = perda), da melhor à pior. */}
          <div style={{marginTop:22,textAlign:"left"}}>
            <div style={{display:"flex",gap:5,height:10}}>
              {bySorted.map(s=>{ const g=rSign(s.ret); return(
                <span key={s.ticker} title={`${s.ticker} ${pct(s.ret)}`} style={{flex:1,borderRadius:5,
                  background:g>0?"linear-gradient(180deg,#4ade80,#16a34a)":g<0?"linear-gradient(180deg,#f87171,#dc2626)":"#475569",
                  boxShadow:g>0?"0 0 10px rgba(74,222,128,0.35)":g<0?"0 0 10px rgba(248,113,113,0.30)":"none"}}/>
              );})}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:9,fontSize:12.5,fontWeight:600}}>
              <span style={{color:"#4ade80"}}><Tri size={11}/> {st.pos} {st.pos===1?"positiva":"positivas"}</span>
              <span style={{color:"#f87171"}}>{st.neg} {st.neg===1?"negativa":"negativas"} <Tri up={false} size={11}/></span>
            </div>
          </div>
          {/* Posição nos 3 jogos: mosaicos nas cores de cada período (azul/roxo/verde-água). */}
          {standings&&(()=>{
            const medal=(r)=>r===1?"#facc15":r===2?"#e2e8f0":r===3?"#fb923c":"#f8fafc";
            const T=[
              {k:"Geral",   rgb:"96,165,250",  a:"#60a5fa", d:standings.geral},
              {k:"Mensal",  rgb:"167,139,250", a:"#a78bfa", d:standings.mensal},
              {k:"Semanal", rgb:"45,212,191",  a:"#2dd4bf", d:standings.semanal, wins:standings.weeklyWins},
            ];
            return(
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10,marginTop:20}}>
                {T.map(t=>(
                  <div key={t.k} style={{borderRadius:14,padding:"12px 6px 11px",textAlign:"center",minWidth:0,
                    background:`linear-gradient(180deg,rgba(${t.rgb},0.20),rgba(${t.rgb},0.04))`,border:`1px solid rgba(${t.rgb},0.36)`,
                    boxShadow:`0 0 22px rgba(${t.rgb},0.10), inset 0 1px 0 rgba(${t.rgb},0.20)`}}>
                    <div style={{fontSize:10.5,fontWeight:800,letterSpacing:"1.2px",textTransform:"uppercase",color:t.a}}>{t.k}</div>
                    {t.d?(<>
                      <div style={{marginTop:5,lineHeight:1.1,whiteSpace:"nowrap"}}>
                        <span style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",color:medal(t.d.rank),textShadow:t.d.rank<=3?`0 0 16px ${medal(t.d.rank)}66`:"none"}}>{t.d.rank}º</span>
                        
                      </div>
                      <div style={{fontFamily:"monospace",fontSize:12,fontWeight:800,marginTop:4,color:t.d.ret>=0?"#4ade80":"#f87171"}}>{pct(t.d.ret)}</div>
                    </>):(
                      <div style={{fontSize:12.5,fontWeight:700,marginTop:12,lineHeight:1.3,color:t.wins&&t.wins.length?"#facc15":"#64748b"}}>
                        {t.wins&&t.wins.length?`🏆 ${t.wins.join(", ")}`:t.k==="Semanal"?"Arranca 2ª feira":"—"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </TiltCard>
      </div>

      {shareOpen&&(<>
        {/* Cartão escondido (off-screen) só para a captura */}
        <div aria-hidden="true" style={{position:"fixed",left:-99999,top:0,pointerEvents:"none"}}>
          <PortfolioShareCard cardRef={shareCardRef} name={pf.name} total={st.total} stocks={shareStocks} ranks={{geral:standings?.geral?.rank,month:standings?.mensal?.rank,week:standings?.semanal?.rank}}/>
        </div>
        <div onClick={()=>setShareOpen(false)} style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(3,7,18,0.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#0a1428",border:"1px solid rgba(255,255,255,0.12)",borderRadius:16,padding:18,maxWidth:"min(94vw,440px)",width:"100%",maxHeight:"92vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.6)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <span style={{fontSize:15,fontWeight:800}}>Partilhar portefólio</span>
              <button onClick={()=>setShareOpen(false)} style={{background:"none",border:"none",color:"#94a3b8",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            {shareUrl
              ? <img src={shareUrl} alt="Cartão do portefólio" style={{display:"block",width:"100%",borderRadius:12,border:"1px solid rgba(255,255,255,0.10)"}}/>
              : <div style={{height:300,display:"flex",alignItems:"center",justifyContent:"center",color:"#64748b",fontSize:14}}>{shareMsg||"A gerar imagem…"}</div>}
            <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:14,justifyContent:"center"}}>
              {typeof navigator!=="undefined"&&navigator.share&&<button onClick={shareNative} disabled={!shareBlob} style={{padding:"11px 20px",borderRadius:12,fontSize:14,fontWeight:800,cursor:shareBlob?"pointer":"default",background:"#22c55e",border:"none",color:"#06281a",opacity:shareBlob?1:0.5}}>Partilhar</button>}
              <button onClick={shareDownload} disabled={!shareUrl} style={{padding:"11px 20px",borderRadius:12,fontSize:14,fontWeight:800,cursor:shareUrl?"pointer":"default",background:(typeof navigator!=="undefined"&&navigator.share)?"rgba(255,255,255,0.06)":"#22c55e",border:(typeof navigator!=="undefined"&&navigator.share)?"1px solid rgba(255,255,255,0.16)":"none",color:(typeof navigator!=="undefined"&&navigator.share)?"#e2e8f0":"#06281a",opacity:shareUrl?1:0.5}}>Descarregar</button>
              <button onClick={shareCopy} disabled={!shareBlob} style={{padding:"11px 20px",borderRadius:12,fontSize:14,fontWeight:700,cursor:shareBlob?"pointer":"default",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.16)",color:"#e2e8f0",opacity:shareBlob?1:0.5}}>Copiar</button>
            </div>
            {shareMsg&&shareUrl&&<div style={{marginTop:10,textAlign:"center",fontSize:12.5,color:shareMsg.includes("✓")?"#4ade80":"#f87171"}}>{shareMsg}</div>}
          </div>
        </div>
      </>)}

      <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,overflow:"hidden"}}>
        <div style={{display:"grid",alignItems:"center",gridTemplateColumns:"1.6fr 1fr 1fr 1.4fr",
          padding:"10px 20px",borderBottom:`1px solid ${divider}`,
          fontSize:11,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600,lineHeight:1.2}}>
          <span></span>
          <span style={{textAlign:"center"}}>Preço inicial</span>
          <span style={{textAlign:"center"}}>Preço atual</span>
          <span onClick={()=>setRetMode(m=>m==="total"?"day":"total")}
            title={`Clica para alternar entre 'Desde o início' e '${lastDayLabel()}'`}
            style={{textAlign:"center",cursor:"pointer",userSelect:"none",lineHeight:1.2,display:"block"}}>
            {retMode==="day"?(lastDayLabel()):"Desde o início"}
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
                  <SideBadge side={s.side} label/>
                  {priceStale&&priceStale[s.ticker]&&(
                    <span title={`Sem cotação desde ${new Date(priceStale[s.ticker]).toLocaleDateString("pt-PT")} — a ação pode ter deixado de negociar. Conta com o último preço conhecido.`}
                      style={{marginLeft:6,fontSize:9.5,fontWeight:800,letterSpacing:".3px",textTransform:"uppercase",color:"#fbbf24",background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.40)",borderRadius:999,padding:"2px 7px",whiteSpace:"nowrap"}}>sem cotação</span>
                  )}
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
              const base={fontFamily:"monospace",fontSize:"clamp(11px,2.9vw,15px)",fontWeight:800,
                whiteSpace:"nowrap",cursor:"pointer",userSelect:"none",
                alignSelf:"stretch",margin:"-14px 0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6};
              if(v==null) return <span onClick={toggle} title="Alternar Desde o início / Diário" style={{...base,color:"#4b5563"}}>—</span>;
              const w=Math.max(8,Math.min(100,Math.abs(v)/retMaxAbs*100)); // magnitude relativa à maior da lista
              return(
                <span onClick={toggle} title="Alternar Desde o início / Diário"
                  style={{...base,color:v>=0?"#4ade80":"#f87171"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:4}}><Tri up={v>=0} size={13}/> {pct(Math.abs(v)).replace(/[+-]/,"")}</span>
                  <span aria-hidden="true" style={{display:"block",width:"76%",height:4,borderRadius:3,background:"rgba(255,255,255,0.07)",overflow:"hidden"}}>
                    <span style={{display:"block",height:"100%",width:`${w}%`,borderRadius:3,
                      background:v>=0?"linear-gradient(90deg,#16a34a,#4ade80)":"linear-gradient(90deg,#dc2626,#f87171)",
                      boxShadow:v>=0?"0 0 8px rgba(74,222,128,0.5)":"0 0 8px rgba(248,113,113,0.5)"}}/>
                  </span>
                </span>
              );
            })()}
          </div>
        ))}
      </div>
      </div>{/* /coluna esquerda */}
      <div className="detStats"><Reveal><GameStandings standings={standings} pf={pf}/></Reveal></div>
      </div>{/* /detColL */}

      <div className="detColR">
      <div className="detRight">{/* coluna direita: análises */}
      {/* Evolução (#5) + Exposição por setor */}
      <Reveal>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:16}}>
        <TiltCard style={{...GLASS,borderRadius:16,padding:24,display:"flex",flexDirection:"column"}}>
          <h3 className="detailCardTitle" style={{fontSize:13,fontWeight:800,letterSpacing:"1px",textTransform:"uppercase",marginBottom:16,color:"#cbd5e1",display:"flex",alignItems:"center",gap:10}}><span aria-hidden="true" style={{width:4,height:16,borderRadius:2,background:"linear-gradient(180deg,#60a5fa,#a78bfa)"}}/>Evolução da rentabilidade</h3>
          <EvolutionChart portfolioId={pf.id} currentReturn={st.total} submittedAt={pf.submittedAt} competitionStarted={competitionStarted} gameStartDate={gameStartDate} spy={spy} spyInitialPrice={pf.spyInitialPrice} mine={!!isOwn} ownerName={pf.name} height={250}/>
        </TiltCard>
        <TiltCard style={{...GLASS,borderRadius:16,padding:24,display:"flex",flexDirection:"column"}}>
          <h3 className="detailCardTitle" style={{fontSize:13,fontWeight:800,letterSpacing:"1px",textTransform:"uppercase",marginBottom:16,color:"#cbd5e1",display:"flex",alignItems:"center",gap:10}}><span aria-hidden="true" style={{width:4,height:16,borderRadius:2,background:"linear-gradient(180deg,#60a5fa,#a78bfa)"}}/>Exposição por setor</h3>
          <SectorDonut stocks={pf.stocks}/>
        </TiltCard>
      </div>
      </Reveal>

      {/* Destaques — melhores/piores DO DIA. Cabeçalho: texto à ESQUERDA + seta à direita. */}
      <style>{`
        .dayGrid{display:grid;gap:16px;align-items:start;grid-template-columns:1fr 1fr;grid-template-areas:"best worst"}
        @media(max-width:560px){.dayGrid{grid-template-columns:1fr;grid-template-areas:"best" "worst"}}
      `}</style>
      <Reveal delay={80}>
      <div className="dayGrid">
        <TiltCard style={{...GLASS,gridArea:"best",minWidth:0,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(34,197,94,0.12), rgba(34,197,94,0.03))",
          border:"1px solid rgba(34,197,94,0.20)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minHeight:26,marginBottom:14}}>
            <DayChip up/>
            <span style={{fontSize:12.5,fontWeight:800,letterSpacing:"1px",textTransform:"uppercase",color:"#4ade80",whiteSpace:"nowrap"}}>Melhores do dia</span>
          </div>
          {byDay.length?<TopList items={byDay.slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </TiltCard>
        <TiltCard style={{...GLASS,gridArea:"worst",minWidth:0,borderRadius:16,padding:24,
          background:"linear-gradient(160deg, rgba(239,68,68,0.12), rgba(239,68,68,0.03))",
          border:"1px solid rgba(239,68,68,0.20)"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minHeight:26,marginBottom:14}}>
            <DayChip up={false}/>
            <span style={{fontSize:12.5,fontWeight:800,letterSpacing:"1px",textTransform:"uppercase",color:"#f87171",whiteSpace:"nowrap"}}>Piores do dia</span>
          </div>
          {byDay.length?<TopList items={[...byDay].reverse().slice(0,3)}/>:<p style={{fontSize:13,color:"#6b7280",textAlign:"center",margin:0}}>Sem variação do dia disponível.</p>}
        </TiltCard>
      </div>
      </Reveal>
      {/* Gráfico "líderes e atrasados" — só desktop; enche o espaço vazio que sobra na coluna direita
          (a coluna estica à altura da lista de ações e este cartão ocupa o resto via flex:1). */}
      <Reveal><div className="detSlot"><SlotChart pf={pf} livePrices={livePrices} dayChange={dayChange} monthBase={monthBase} weekBase={weekBase}/></div></Reveal>
      </div>{/* /coluna direita (análises) */}
      <div className="detComments" id="detComments" style={{scrollMarginTop:88}}><Reveal><PortfolioReactions pf={pf} myNorm={myNorm} myUserId={myUserId} adminPw={adminPw} showToast={showToast} onOpenMember={onOpenMember} focusRef={focusRef}/></Reveal></div>
      </div>{/* /detColR */}
      </div>{/* /cdiDetail */}
    </div>
  );
}

export function DayChip({up=false}){
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

export function TopList({items}){
  return(
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {items.map((s,i)=>(
        <div key={s.ticker} style={{display:"flex",alignItems:"center",gap:10,
          background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 12px"}}>
          <span style={{fontSize:12,fontWeight:700,color:"#4b5563",minWidth:16}}>{i+1}</span>
          <StockLogo ticker={s.ticker} size={26}/>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:13,fontWeight:800,color:"#e2e8f0",display:"flex",alignItems:"center",gap:6}}>{s.ticker}{s.side==="short"&&<SideBadge side="short" label/>}</div>
            <div style={{fontSize:11,color:"#6b7280",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.companyName}</div>
          </div>
          <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:s.ret>=0?"#4ade80":"#f87171"}}>{pct(s.ret)}</span>
        </div>
      ))}
    </div>
  );
}

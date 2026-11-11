// Módulo "admin" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect } from "react";
import { curPrice, dlCSV, dt, isPreLaunch, mapPortfolioFromSupabase, pct, pfStats, timeAgo } from "../lib/core";

/* ---- Admin --------------------------------------------------------------- */
export function Admin({settings,setSettings,portfolios,ranking,livePrices,reload,showToast,adminPw,setAdminPw}){
  // authed derivado da password de admin ELEVADA ao App (persiste entre páginas na sessão → permite
  // moderar comentários inline nos perfis). pw = input local, inicializado a partir de adminPw.
  const authed=!!adminPw;
  const [pw,setPw]=useState(adminPw||"");
  const [checking,setChecking]=useState(false);
  // The password is validated server-side; on success we keep it in memory only
  // to authorize subsequent admin actions (it is sent with each request).
  const tryAuth=async()=>{
    if(checking||!pw) return;
    setChecking(true);
    try{
      const res=await fetch("/api/admin/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      if(res.ok) setAdminPw(pw);
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

export function AdminPanel({settings,setSettings,portfolios,ranking,livePrices,reload,showToast,pw}){
  const [tab,setTab]=useState("portfolios");
  const [editKey,setEditKey]=useState(null);
  const [editName,setEditName]=useState("");
  const [editPinKey,setEditPinKey]=useState(null);
  const [editPin,setEditPin]=useState("");
  const [pins,setPins]=useState({}); // { user_id: pin } — códigos dos membros
  const [fullPfs,setFullPfs]=useState(null); // portefólios completos (com ações dos oficiais) via service_role
  const [readiness,setReadiness]=useState(null); // relatório de prontidão para o lançamento
  const [checkingRd,setCheckingRd]=useState(false);
  const [aUpdates,setAUpdates]=useState(null); // updates (recap diário) — null = por carregar
  const [aFeedback,setAFeedback]=useState(null); // feedback dos membros (com autor, só admin)
  const [bodyEdits,setBodyEdits]=useState({}); // { day: texto } em edição
  // Notificação manual (broadcast) para todos os membros.
  const [nTitle,setNTitle]=useState("");
  const [nBody,setNBody]=useState("");
  const [nLink,setNLink]=useState("");
  const [nSending,setNSending]=useState(false);
  async function sendNotifyAll(){
    const title=nTitle.trim(); if(!title){ showToast("Escreve um título.","error"); return; }
    if(!confirm(`Enviar esta notificação a TODOS os membros?\n\n"${title}"`)) return;
    setNSending(true);
    try{
      const r=await fetch("/api/admin/notify-all",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,title,body:nBody.trim(),link:nLink})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok){ showToast(j.error||"Não foi possível enviar.","error"); return; }
      setNTitle(""); setNBody(""); setNLink("");
      showToast(`Notificação enviada a ${j.count} ${j.count===1?"membro":"membros"}.`);
      loadNotifList();
    }catch{ showToast("Falha de ligação.","error"); }
    finally{ setNSending(false); }
  }
  // Histórico de notificações enviadas (broadcasts + automáticas), editar e ver quem leu.
  const [notifList,setNotifList]=useState(null);
  const [notifLoading,setNotifLoading]=useState(false);
  const [readersOf,setReadersOf]=useState(null); // {createdAt, read:[], unread:[], loading}
  const [editT,setEditT]=useState(null);         // alvo em edição {batchCreatedAt|id, title, body, link}
  // Corte VISUAL das automáticas (só no browser do admin): esconde os lançamentos até esta data.
  // Os membros mantêm as notificações — não apaga nada na BD. Serve para "recomeçar" a vista.
  const [autoSince,setAutoSince]=useState(()=>{ try{ return localStorage.getItem("cdi_admin_notif_since")||""; }catch{ return ""; } });
  function clearAutoView(){
    if(!confirm("Limpar a vista do admin (só aqui)? As notificações continuam nos membros — isto só esconde o histórico atual para recomeçares.")) return;
    const t=new Date().toISOString();
    try{ localStorage.setItem("cdi_admin_notif_since",t); }catch{}
    setAutoSince(t);
  }
  async function loadNotifList(){
    setNotifLoading(true);
    try{
      const r=await fetch("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"list"})});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j.ok) setNotifList({broadcasts:j.broadcasts||[],autoGroups:j.autoGroups||[]});
      else showToast(j.error||"Não foi possível carregar.","error");
    }catch{ showToast("Falha de ligação.","error"); }
    finally{ setNotifLoading(false); }
  }
  async function openReaders(createdAt){
    if(readersOf&&readersOf.createdAt===createdAt){ setReadersOf(null); return; } // toggle
    setReadersOf({createdAt,loading:true});
    try{
      const r=await fetch("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"readers",createdAt})});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&j.ok) setReadersOf({createdAt,read:j.read||[],unread:j.unread||[]});
      else { setReadersOf(null); showToast(j.error||"Não foi possível.","error"); }
    }catch{ setReadersOf(null); showToast("Falha de ligação.","error"); }
  }
  async function saveEditNotif(){
    if(!editT) return;
    const title=(editT.title||"").trim(); if(!title){ showToast("Escreve um título.","error"); return; }
    try{
      const payload={password:pw,action:"edit",title,body:(editT.body||"").trim(),link:editT.link||""};
      if(editT.batchCreatedAt) payload.batchCreatedAt=editT.batchCreatedAt; else payload.id=editT.id;
      const r=await fetch("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok){ showToast(j.error||"Não foi possível guardar.","error"); return; }
      setEditT(null); showToast("Notificação atualizada."); loadNotifList();
    }catch{ showToast("Falha de ligação.","error"); }
  }
  async function deleteNotif(target){ // {batchCreatedAt}|{groupCreatedAt}|{id}
    const msg=target.batchCreatedAt?"Apagar este broadcast em TODOS os membros? Não pode ser desfeito."
      :target.groupCreatedAt?"Apagar este lote de notificações automáticas em todos os membros? Não pode ser desfeito."
      :"Apagar esta notificação? Não pode ser desfeito.";
    if(!confirm(msg)) return;
    try{
      const r=await fetch("/api/admin/notifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"delete",...target})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok){ showToast(j.error||"Não foi possível apagar.","error"); return; }
      setReadersOf(null); setEditT(null); showToast("Notificação apagada."); loadNotifList();
    }catch{ showToast("Falha de ligação.","error"); }
  }
  const NOTIF_TYPE_LABEL={overtaken:"Mudança de ranking",weekly_win:"Vencedor da semana",weekly_digest:"Resumo semanal",comment:"Comentário no perfil",reaction:"Reação",mention:"Menção no chat"};
  const typeLabel=(t)=>NOTIF_TYPE_LABEL[t]||t;
  // Saúde operacional (só leitura).
  const [health,setHealth]=useState(null);
  const [loadingHealth,setLoadingHealth]=useState(false);
  async function loadHealth(){
    setLoadingHealth(true);
    try{
      const r=await fetch("/api/admin/health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){ showToast(j.error||"Não foi possível carregar.","error"); }
      else setHealth(j);
    }catch{ showToast("Falha de ligação.","error"); }
    finally{ setLoadingHealth(false); }
  }
  async function loadUpdates(){
    try{
      const r=await fetch("/api/admin/updates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"list"})});
      const j=await r.json(); if(r.ok&&Array.isArray(j.updates)){ setAUpdates(j.updates); setBodyEdits(Object.fromEntries(j.updates.map(u=>[u.day,u.body||""]))); }
    }catch{}
  }
  async function loadAdminFeedback(){
    try{
      const r=await fetch("/api/admin/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action:"list"})});
      const j=await r.json(); if(r.ok&&Array.isArray(j.feedback)) setAFeedback(j.feedback);
    }catch{}
  }
  async function updAction(action,day,extra){
    try{
      const r=await fetch("/api/admin/updates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action,day,...(extra||{})})});
      const j=await r.json(); if(!r.ok||!j.ok){ showToast(j.error||"Não foi possível.","error"); return; }
      await loadUpdates(); showToast("Feito.");
    }catch{ showToast("Falha de ligação.","error"); }
  }
  async function fbAction(action,id){
    try{
      const r=await fetch("/api/admin/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pw,action,id})});
      const j=await r.json(); if(!r.ok||!j.ok){ showToast(j.error||"Não foi possível.","error"); return; }
      await loadAdminFeedback();
    }catch{ showToast("Falha de ligação.","error"); }
  }
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
  useEffect(()=>{ if(tab==="updates"&&aUpdates===null) loadUpdates(); if(tab==="feedback"&&aFeedback===null) loadAdminFeedback(); if(tab==="health"&&health===null&&!loadingHealth) loadHealth(); if(tab==="notify"&&notifList===null&&!notifLoading) loadNotifList(); },[tab]);// eslint-disable-line
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

  const TABS=[["portfolios","👥 Portefólios"],["game","⚙️ Jogo"],["updates","📣 Updates"],["notify","🔔 Notificar"],["health","🩺 Saúde"],["feedback","💬 Feedback"],["export","⬇️ Exportar"]];
  const memberCount=apfs.filter(p=>p.official).length;

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

      {/* Updates — recap diário */}
      {tab==="updates"&&(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24}}>
          <p style={{fontSize:13,color:"#6b7280",margin:"0 0 20px"}}>Recap por dia. O <strong style={{color:"#94a3b8"}}>rascunho</strong> junta os assuntos dos commits do dia — reescreve em linguagem simples (uma ideia por linha) e <strong style={{color:"#94a3b8"}}>publica</strong>. Só os publicados aparecem na homepage.</p>
          {aUpdates===null?(
            <p style={{color:"#4b5563"}}>A carregar…</p>
          ):aUpdates.length===0?(
            <p style={{color:"#4b5563"}}>Ainda sem dias. Um push para o repositório cria o rascunho de hoje.</p>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:20}}>
              {aUpdates.map(u=>(
                <div key={u.day} style={{borderBottom:"1px solid rgba(255,255,255,0.07)",paddingBottom:20}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <strong style={{fontSize:14}}>{u.day}</strong>
                    <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",borderRadius:999,padding:"2px 8px",
                      background:u.status==="published"?"rgba(34,197,94,0.14)":"rgba(148,163,184,0.14)",
                      color:u.status==="published"?"#4ade80":"#94a3b8",border:`1px solid ${u.status==="published"?"rgba(34,197,94,0.3)":"rgba(148,163,184,0.3)"}`}}>
                      {u.status==="published"?"Publicado":"Rascunho"}
                    </span>
                  </div>
                  {Array.isArray(u.draft_lines)&&u.draft_lines.length>0&&(
                    <details style={{marginBottom:10}}>
                      <summary style={{fontSize:12,color:"#64748b",cursor:"pointer"}}>Semente (commits do dia · {u.draft_lines.length})</summary>
                      <ul style={{margin:"8px 0 0",paddingLeft:18,fontSize:12.5,color:"#94a3b8",lineHeight:1.6}}>
                        {u.draft_lines.map((l,i)=><li key={i}>{l}</li>)}
                      </ul>
                    </details>
                  )}
                  <textarea value={bodyEdits[u.day]??""} onChange={e=>setBodyEdits(p=>({...p,[u.day]:e.target.value}))} rows={4}
                    placeholder="Escreve o recap do dia (uma ideia por linha, direto e não-técnico)…"
                    style={{width:"100%",boxSizing:"border-box",resize:"vertical",background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"10px 12px",color:"#e2e8f0",fontSize:13.5,lineHeight:1.5,fontFamily:"inherit"}}/>
                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    <button onClick={()=>updAction("save",u.day,{body:bodyEdits[u.day]??""})} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,color:"#e2e8f0",cursor:"pointer"}}>Guardar</button>
                    {u.status==="published"?(
                      <button onClick={()=>updAction("unpublish",u.day)} style={{background:"rgba(148,163,184,0.1)",border:"1px solid rgba(148,163,184,0.3)",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,color:"#94a3b8",cursor:"pointer"}}>Despublicar</button>
                    ):(
                      <button onClick={()=>updAction("publish",u.day,{body:bodyEdits[u.day]??""})} style={{background:"rgba(34,197,94,0.12)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:700,color:"#4ade80",cursor:"pointer"}}>Guardar e publicar</button>
                    )}
                    <button onClick={()=>{ if(confirm(`Apagar o dia ${u.day}?`)) updAction("delete",u.day); }} style={{background:"none",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,color:"#f87171",cursor:"pointer",marginLeft:"auto"}}>Apagar</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notificar — broadcast manual a todos os membros (as automáticas continuam a funcionar) */}
      {tab==="notify"&&(<>
        <style>{`.notifGrid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}@media(min-width:980px){.notifGrid{grid-template-columns:minmax(0,460px) minmax(0,1fr)}}`}</style>
        <div className="notifGrid">
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24}}>
          <p style={{fontSize:13,color:"#6b7280",margin:"0 0 4px"}}>Escreve uma notificação e envia a <strong style={{color:"#94a3b8"}}>todos os {memberCount} membros</strong>. Aparece no sino de cada um (não lida). As notificações automáticas (comentários, reações, vencedor da semana…) continuam na mesma.</p>
          <div style={{display:"flex",flexDirection:"column",gap:14,marginTop:18}}>
            <label style={{display:"flex",flexDirection:"column",gap:6}}>
              <span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>Título <span style={{color:"#64748b",fontWeight:400}}>({nTitle.length}/120)</span></span>
              <input value={nTitle} onChange={e=>setNTitle(e.target.value.slice(0,120))} placeholder="Ex.: Nova funcionalidade no ranking 🎉"
                style={{background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"11px 12px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",width:"100%",boxSizing:"border-box",outline:"none"}}/>
            </label>
            <label style={{display:"flex",flexDirection:"column",gap:6}}>
              <span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>Mensagem <span style={{color:"#64748b",fontWeight:400}}>(opcional · {nBody.length}/300)</span></span>
              <textarea value={nBody} onChange={e=>setNBody(e.target.value.slice(0,300))} rows={3} placeholder="Detalhe (opcional). Aparece por baixo do título."
                style={{background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"11px 12px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",width:"100%",boxSizing:"border-box",outline:"none",resize:"vertical"}}/>
            </label>
            <label style={{display:"flex",flexDirection:"column",gap:6}}>
              <span style={{fontSize:12,color:"#94a3b8",fontWeight:600}}>Ao clicar, abre</span>
              <select value={nLink} onChange={e=>setNLink(e.target.value)}
                style={{background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"11px 12px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",width:"100%",boxSizing:"border-box",outline:"none"}}>
                <option value="">Nada (só a mensagem)</option>
                <option value="ranking">Ranking Geral</option>
                <option value="ranking-month">Ranking Mensal</option>
                <option value="ranking-week">Ranking Semanal</option>
                <option value="mine">As Minhas 8</option>
                <option value="updates">Secção Updates (Homepage)</option>
                <option value="ath">ATH</option>
              </select>
            </label>
            {(nTitle.trim()||nBody.trim())&&(
              <div style={{background:"rgba(96,165,250,0.08)",border:"1px solid rgba(96,165,250,0.25)",borderRadius:12,padding:"11px 14px"}}>
                <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700,marginBottom:6}}>Pré-visualização</div>
                <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",lineHeight:1.35}}>{nTitle.trim()||"(título)"}</div>
                {nBody.trim()&&<div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>{nBody.trim()}</div>}
                <div style={{fontSize:10.5,color:"#64748b",marginTop:4}}>agora</div>
              </div>
            )}
            <div>
              <button onClick={sendNotifyAll} disabled={nSending||!nTitle.trim()}
                style={{border:"none",borderRadius:10,padding:"12px 22px",fontSize:14,fontWeight:800,cursor:nSending||!nTitle.trim()?"not-allowed":"pointer",
                  background:nSending||!nTitle.trim()?"rgba(255,255,255,0.08)":"#2563eb",color:"#fff"}}>
                {nSending?"A enviar…":`Enviar a ${memberCount} membros`}
              </button>
            </div>
          </div>
        </div>
        {/* Coluna direita: histórico de notificações (broadcasts + automáticas) */}
        {(()=>{
          const inputSt={background:"rgba(0,0,0,0.28)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:9,padding:"9px 11px",color:"#e2e8f0",fontSize:14,fontFamily:"inherit",width:"100%",boxSizing:"border-box",outline:"none"};
          const btnP={border:"none",borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:800,cursor:"pointer",background:"#22c55e",color:"#04120a"};
          const btnG={border:"1px solid rgba(255,255,255,0.16)",borderRadius:9,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",background:"rgba(255,255,255,0.06)",color:"#cbd5e1"};
          const lk={background:"none",border:"none",color:"#93c5fd",cursor:"pointer",fontSize:11.5,fontWeight:700,padding:0};
          const lkDel={...lk,color:"#f87171"};
          const OPTS=[["","Nada (só a mensagem)"],["ranking","Ranking Geral"],["ranking-month","Ranking Mensal"],["ranking-week","Ranking Semanal"],["mine","As Minhas 8"],["updates","Secção Updates (Homepage)"],["ath","ATH"]];
          const linkSel=(val,on)=><select value={val||""} onChange={on} style={inputSt}>{OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>;
          const editForm=(withLink)=>(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input value={editT.title} onChange={e=>setEditT({...editT,title:e.target.value.slice(0,120)})} style={inputSt}/>
              <textarea value={editT.body} onChange={e=>setEditT({...editT,body:e.target.value.slice(0,300)})} rows={2} style={{...inputSt,resize:"vertical"}}/>
              {withLink&&linkSel(editT.link,e=>setEditT({...editT,link:e.target.value}))}
              <div style={{display:"flex",gap:8}}><button onClick={saveEditNotif} style={btnP}>Guardar</button><button onClick={()=>setEditT(null)} style={btnG}>Cancelar</button></div>
            </div>
          );
          return(
            <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <div style={{fontSize:15,fontWeight:800,color:"#e2e8f0"}}>Enviadas</div>
                <button onClick={loadNotifList} disabled={notifLoading} style={{border:"1px solid rgba(255,255,255,0.16)",background:"rgba(255,255,255,0.06)",color:"#e2e8f0",borderRadius:9,padding:"7px 12px",fontSize:12.5,fontWeight:700,cursor:notifLoading?"default":"pointer"}}>{notifLoading?"A ler…":"Atualizar"}</button>
              </div>
              {!notifList?(
                <p style={{color:"#4b5563",fontSize:13}}>{notifLoading?"A carregar…":"—"}</p>
              ):(<>
                <div style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700,margin:"0 0 8px"}}>Broadcasts ({notifList.broadcasts.length})</div>
                {notifList.broadcasts.length===0?<p style={{color:"#4b5563",fontSize:13}}>Ainda não enviaste nenhuma.</p>:(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {notifList.broadcasts.map(b=>{ const isEdit=editT&&editT.batchCreatedAt===b.createdAt; const isR=readersOf&&readersOf.createdAt===b.createdAt;
                      return(
                        <div key={b.createdAt} style={{border:"1px solid rgba(255,255,255,0.10)",borderRadius:12,padding:"11px 13px",background:"rgba(255,255,255,0.03)"}}>
                          {isEdit?editForm(true):(<>
                            <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",lineHeight:1.35}}>{b.title}</div>
                            {b.body&&<div style={{fontSize:12,color:"#94a3b8",marginTop:2}}>{b.body}</div>}
                            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8,fontSize:11.5,color:"#64748b",flexWrap:"wrap"}}>
                              <span>{new Date(b.createdAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}</span>
                              <span style={{color:"#4ade80",fontWeight:700}}>{b.read}/{b.total} lidas</span>
                              <button onClick={()=>openReaders(b.createdAt)} style={lk}>{isR?"ocultar":"quem leu"}</button>
                              <button onClick={()=>setEditT({batchCreatedAt:b.createdAt,title:b.title,body:b.body||"",link:b.link||""})} style={lk}>editar</button>
                              <button onClick={()=>deleteNotif({batchCreatedAt:b.createdAt})} style={lkDel}>apagar</button>
                            </div>
                            {isR&&(
                              <div style={{marginTop:8,borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:8}}>
                                {readersOf.loading?<span style={{fontSize:12,color:"#64748b"}}>A carregar…</span>:(<>
                                  <div style={{fontSize:11.5,color:"#4ade80",fontWeight:700,marginBottom:3}}>Leram ({readersOf.read.length})</div>
                                  <div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.5}}>{readersOf.read.length?readersOf.read.join(", "):"—"}</div>
                                  <div style={{fontSize:11.5,color:"#f87171",fontWeight:700,margin:"8px 0 3px"}}>Por ler ({readersOf.unread.length})</div>
                                  <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>{readersOf.unread.length?readersOf.unread.join(", "):"—"}</div>
                                </>)}
                              </div>
                            )}
                          </>)}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{display:"flex",alignItems:"center",gap:10,margin:"18px 0 4px",flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:"#64748b",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:700}}>Automáticas (por lançamento)</span>
                  {(()=>{const shown=notifList.autoGroups.filter(g=>!autoSince||g.createdAt>autoSince);return shown.length>0&&(
                    <button onClick={clearAutoView} style={{...lkDel,marginLeft:"auto"}}>limpar vista</button>
                  );})()}
                </div>
                <p style={{color:"#4b5563",fontSize:11,margin:"0 0 8px"}}>Cada linha é um lançamento (não cada notificação personalizada): quando saiu e quem leu. {autoSince&&<span style={{color:"#64748b"}}>Vista limpa em {new Date(autoSince).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})} — os membros mantêm tudo. <button onClick={()=>{try{localStorage.removeItem("cdi_admin_notif_since");}catch{} setAutoSince("");}} style={{...lk,padding:0}}>repor</button></span>}</p>
                {(()=>{ const shown=notifList.autoGroups.filter(g=>!autoSince||g.createdAt>autoSince); return shown.length===0?<p style={{color:"#4b5563",fontSize:13}}>Nenhuma.</p>:(
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {shown.map(g=>{ const isR=readersOf&&readersOf.createdAt===g.createdAt;
                      return(
                        <div key={g.createdAt} style={{border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"9px 11px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:12.5,fontWeight:700,color:"#e2e8f0",flex:1,minWidth:0}}>{g.types.map(typeLabel).join(" · ")}</span>
                            <span style={{fontSize:11.5,color:"#4ade80",fontWeight:700,whiteSpace:"nowrap"}}>{g.read}/{g.total} lidas</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:12,marginTop:6,fontSize:11.5,color:"#64748b",flexWrap:"wrap"}}>
                            <span>{new Date(g.createdAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}</span>
                            <button onClick={()=>openReaders(g.createdAt)} style={lk}>{isR?"ocultar":"quem leu"}</button>
                            <button onClick={()=>deleteNotif({groupCreatedAt:g.createdAt})} style={lkDel}>apagar</button>
                          </div>
                          {isR&&(
                            <div style={{marginTop:8,borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:8}}>
                              {readersOf.loading?<span style={{fontSize:12,color:"#64748b"}}>A carregar…</span>:(<>
                                <div style={{fontSize:11.5,color:"#4ade80",fontWeight:700,marginBottom:3}}>Leram ({readersOf.read.length})</div>
                                <div style={{fontSize:12,color:"#cbd5e1",lineHeight:1.5}}>{readersOf.read.length?readersOf.read.join(", "):"—"}</div>
                                <div style={{fontSize:11.5,color:"#f87171",fontWeight:700,margin:"8px 0 3px"}}>Por ler ({readersOf.unread.length})</div>
                                <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.5}}>{readersOf.unread.length?readersOf.unread.join(", "):"—"}</div>
                              </>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ); })()}
              </>)}
            </div>
          );
        })()}
        </div>{/* /notifGrid */}
      </>)}

      {/* Saúde operacional — diagnóstico só de leitura */}
      {tab==="health"&&(()=>{
        const card={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:20,marginBottom:14};
        const G="#4ade80",Y="#facc15",R="#f87171";
        const Dot=({c})=><span style={{width:9,height:9,borderRadius:"50%",background:c,flexShrink:0,boxShadow:`0 0 8px ${c}`}}/>;
        const Row=({c,label,value})=><div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0"}}><Dot c={c}/><span style={{fontSize:13,color:"#cbd5e1",flex:1}}>{label}</span><span style={{fontSize:13,fontWeight:700,color:"#e2e8f0",fontVariantNumeric:"tabular-nums"}}>{value}</span></div>;
        const h=health;
        return(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
              <p style={{fontSize:13,color:"#6b7280",margin:0}}>Diagnóstico só de leitura. Verde = ok · amarelo = atenção · vermelho = corrigir.{h?.now&&<> · <span style={{color:"#4b5563"}}>lido {new Date(h.now).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}</span></>}</p>
              <button onClick={loadHealth} disabled={loadingHealth} style={{border:"1px solid rgba(255,255,255,0.16)",background:"rgba(255,255,255,0.06)",color:"#e2e8f0",borderRadius:9,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:loadingHealth?"default":"pointer"}}>{loadingHealth?"A ler…":"Atualizar"}</button>
            </div>
            {!h?(
              <p style={{color:"#4b5563"}}>{loadingHealth?"A carregar…":"Sem dados."}</p>
            ):(<>
              {/* Integridade — as mesmas verificações do alerta automático (GitHub: "Saúde dos dados") */}
              {(()=>{ const g=h.integrity; if(!g) return null; const np=(g.problems||[]).length, nw=(g.warnings||[]).length;
                return <div style={{...card,border:`1px solid ${np?"rgba(248,113,113,0.45)":nw?"rgba(250,204,21,0.30)":"rgba(74,222,128,0.30)"}`}}>
                  <div style={{fontSize:12,fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Integridade dos dados</div>
                  <Row c={np?R:G} label="Problemas (falham o alerta)" value={np}/>
                  <Row c={nw?Y:G} label="Avisos" value={nw}/>
                  {[...(g.problems||[]).map(x=>({...x,_p:1})),...(g.warnings||[])].map((x,i)=>(
                    <div key={i} style={{marginTop:6,fontSize:12.5,color:"#e2e8f0",background:x._p?"rgba(248,113,113,0.07)":"rgba(250,204,21,0.06)",border:`1px solid ${x._p?"rgba(248,113,113,0.28)":"rgba(250,204,21,0.22)"}`,borderRadius:8,padding:"6px 10px"}}>
                      <div style={{fontWeight:700}}>{x.msg}</div>
                      {x.tickers&&<div style={{color:"#94a3b8",marginTop:2}}>{x.tickers.join(", ")}{x.count>x.tickers.length?` … (+${x.count-x.tickers.length})`:""}</div>}
                    </div>
                  ))}
                  <div style={{marginTop:8,fontSize:11.5,color:"#64748b"}}>Verificado 2×/dia (12:30 e 23:30 UTC); se houver problemas, o GitHub envia email de falha.</div>
                </div>; })()}
              {/* Snapshots */}
              {(()=>{ const s=h.snapshots||{}; const c=s.missingCount===0?(s.daysSince>4?Y:G):(s.missingCount<5?Y:R);
                return <div style={card}>
                  <div style={{fontSize:12,fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Snapshots (gráfico de evolução)</div>
                  <Row c={c} label="Último dia" value={s.latestDate||"—"}/>
                  <Row c={s.missingCount===0?G:(s.missingCount<5?Y:R)} label="Cobertura dos oficiais" value={`${s.covered}/${s.officials}${s.missingCount?` · faltam ${s.missingCount}`:""}`}/>
                  <Row c={s.daysSince>4?R:(s.daysSince>3?Y:G)} label="Dias desde o último" value={s.daysSince==null?"—":`${s.daysSince}`}/>
                  {s.missingCount>0&&<div style={{marginTop:6,fontSize:12,color:"#94a3b8"}}>Sem snapshot: {s.missing.join(", ")}{s.missingCount>s.missing.length?"…":""}</div>}
                </div>; })()}
              {/* Baselines semanais */}
              {(()=>{ const w=h.week||{}; const c=w.missingCount===0?G:R;
                return <div style={card}>
                  <div style={{fontSize:12,fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Baselines semanais · {w.period}</div>
                  <Row c={w.tickers>0?G:R} label="Tickers com baseline" value={w.tickers}/>
                  <Row c={G} label="Semana fechada (fecho gravado)" value={w.closed?"sim":"não (ao vivo)"}/>
                  <Row c={c} label="Tickers oficiais sem baseline" value={w.missingCount}/>
                  {w.missingCount>0&&<div style={{marginTop:6,fontSize:12,color:"#f87171"}}>{w.missingTickers.join(", ")}{w.missingCount>w.missingTickers.length?"…":""}</div>}
                </div>; })()}
              {/* Baseline mensal */}
              {(()=>{ const m=h.month||{};
                return <div style={card}>
                  <div style={{fontSize:12,fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Baseline mensal · {m.period}</div>
                  <Row c={m.tickers>0?G:Y} label="Tickers com baseline do mês" value={m.tickers}/>
                </div>; })()}
              {/* Preços */}
              {(()=>{ const p=h.prices||{}; const stale=p.staleHours!=null&&p.staleHours>=24;
                return <div style={card}>
                  <div style={{fontSize:12,fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Preços (pipeline sp500_ath)</div>
                  <Row c={stale?Y:G} label="Última atualização do pipeline" value={p.athLatest?`há ${p.staleHours}h`:"—"}/>
                  <Row c={p.suspiciousCount===0?G:Y} label="Preços suspeitos (desvio >40% / sem preço)" value={p.suspiciousCount}/>
                  {p.suspiciousCount>0&&(
                    <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
                      {p.suspicious.map((x,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:"#e2e8f0",background:"rgba(250,204,21,0.06)",border:"1px solid rgba(250,204,21,0.22)",borderRadius:8,padding:"6px 10px"}}>
                          <span style={{fontWeight:800,minWidth:56}}>{x.ticker}</span>
                          <span style={{color:"#94a3b8",flex:1}}>{x.reason}</span>
                          <span style={{fontVariantNumeric:"tabular-nums"}}>{x.price==null?"—":x.price} {x.ref!=null?`vs ${x.ref}`:""} {x.dev!=null?`(${x.dev>=0?"+":""}${(x.dev*100).toFixed(0)}%)`:""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{marginTop:8,fontSize:11.5,color:"#64748b"}}>Nota: ao fim de semana os preços já são congelados no fecho de 6ª (guarda automática) — suspeitos aqui indicam tick mau do pipeline a corrigir.</div>
                </div>; })()}
            </>)}
          </div>
        );
      })()}

      {/* Feedback — moderação (autor visível só ao admin) */}
      {tab==="feedback"&&(
        <div style={{background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",borderRadius:16,padding:24}}>
          <p style={{fontSize:13,color:"#6b7280",margin:"0 0 20px"}}>Feedback dos membros. Para eles é <strong style={{color:"#94a3b8"}}>anónimo</strong>; aqui vês o autor. Oculta ou apaga o que não deva aparecer.</p>
          {aFeedback===null?(
            <p style={{color:"#4b5563"}}>A carregar…</p>
          ):aFeedback.length===0?(
            <p style={{color:"#4b5563"}}>Ainda sem feedback.</p>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {aFeedback.map(f=>(
                <div key={f.id} style={{background:f.hidden?"rgba(239,68,68,0.05)":"rgba(255,255,255,0.03)",border:`1px solid ${f.hidden?"rgba(239,68,68,0.18)":"rgba(255,255,255,0.07)"}`,borderRadius:10,padding:"12px 14px"}}>
                  <div style={{fontSize:14,color:"#cbd5e1",lineHeight:1.5,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{f.message}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:11.5,color:"#64748b"}}><strong style={{color:"#94a3b8"}}>{f.author||"(sem nome)"}</strong> · {timeAgo(f.created_at)}{f.hidden?" · oculto":""}</span>
                    <span style={{marginLeft:"auto",display:"flex",gap:6}}>
                      <button onClick={()=>fbAction(f.hidden?"unhide":"hide",f.id)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:7,padding:"5px 11px",fontSize:12,fontWeight:600,color:"#e2e8f0",cursor:"pointer"}}>{f.hidden?"Mostrar":"Ocultar"}</button>
                      <button onClick={()=>{ if(confirm("Apagar este feedback?")) fbAction("delete",f.id); }} style={{background:"none",border:"1px solid rgba(239,68,68,0.25)",borderRadius:7,padding:"5px 11px",fontSize:12,fontWeight:600,color:"#f87171",cursor:"pointer"}}>Apagar</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
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

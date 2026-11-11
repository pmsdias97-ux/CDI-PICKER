// Módulo "shell" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { BUILD_VERSION } from "../version";
import { CALM_MOTION, K, NAV_ICONS, Portal, RANK_PERIOD_ACCENT, fmtCountdown, marketStatus, msUntilMarketOpen, sget, timeAgo } from "../lib/core";

// Faixa lateral esquerda (desktop): ao passar o cursor pela margem vazia à esquerda do
// conteúdo, surge um glow + seta ← para voltar. Ocupa exatamente a margem (nunca sobrepõe
// o cartão). Renderizada só quando useBackRail().active (aí o botão de topo desaparece).
export function LeftBackRail({gap,onBack,label="Voltar ao ranking"}){
  const [hover,setHover]=useState(false);
  return(
    <div onClick={onBack} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      role="button" aria-label={label}
      style={{position:"fixed",left:0,top:0,bottom:0,width:gap,cursor:"pointer",zIndex:40,
        display:"flex",alignItems:"center",justifyContent:"center",
        background:hover?"linear-gradient(90deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.14) 50%, transparent 100%)":"transparent",
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
export function BackToTop({maxWidth}){
  const [show,setShow]=useState(false);
  useEffect(()=>{
    const onScroll=()=>setShow(window.scrollY>600);
    onScroll();
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>window.removeEventListener("scroll",onScroll);
  },[]);
  const right="24px"; // canto inferior direito do viewport (antes: alinhado à goteira do conteúdo)
  return(
    <button onClick={()=>window.scrollTo({top:0,behavior:"smooth"})} aria-label="Voltar ao topo" title="Voltar ao topo"
      style={{position:"fixed",right,bottom:24,zIndex:45,width:46,height:46,borderRadius:"50%",cursor:"pointer",
        background:"rgba(30,41,59,0.94)",/* fundo SÓLIDO: backdrop-filter em position:fixed dá bug no Safari iOS (botão flutua p/ o centro) */
        border:"1px solid rgba(255,255,255,0.18)",boxShadow:"0 8px 24px rgba(0,0,0,0.35)",color:"#e2e8f0",
        display:"flex",alignItems:"center",justifyContent:"center",
        opacity:show?1:0,transform:show?"translateY(0)":"translateY(12px)",pointerEvents:show?"auto":"none",
        transition:"opacity .25s ease, transform .25s ease"}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  );
}

// Sino de notificações (topo-esquerdo, só com sessão). Faz POLL de /api/notifications/list (o app não
// tem sessão Supabase-auth p/ Realtime por-utilizador). Clicar num item navega via onLink (token: 'mine'
// | 'ranking' | 'ranking-week' | 'p:<portfolioId>'). Marca lidas ao abrir.
export function NotifBell({myName,onLink,showToast}){
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState([]);
  const [unread,setUnread]=useState(0);
  const ref=useRef(null);
  const creds=()=>({name:myName,pin:sget(K.MYPIN)});
  const load=useCallback(async()=>{
    const { name,pin }=creds(); if(!name||!pin) return;
    try{
      const res=await fetch("/api/notifications/list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,pin})});
      const j=await res.json().catch(()=>({}));
      if(res.ok){ setItems(j.notifications||[]); setUnread(j.unread||0); }
    }catch{}
  },[myName]);
  useEffect(()=>{ load(); const id=setInterval(()=>{ if(!document.hidden) load(); },25000); return()=>clearInterval(id); },[load]);
  // Marca lidas ao FECHAR o sino (não ao abrir) → o "NEW"/não-lida ficam visíveis enquanto lês.
  const markRead=async()=>{ if(unread===0) return; setUnread(0); setItems(x=>x.map(n=>({...n,read:true})));
    try{ const { name,pin }=creds(); await fetch("/api/notifications/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,pin})}); }catch{} };
  const closePanel=()=>{ markRead(); setOpen(false); };
  // Fecha ao clicar fora.
  useEffect(()=>{ if(!open) return; const onDoc=(e)=>{ if(ref.current&&!ref.current.contains(e.target)) closePanel(); };
    document.addEventListener("mousedown",onDoc); return()=>document.removeEventListener("mousedown",onDoc); },[open]);// eslint-disable-line
  const toggle=()=>{ if(open) closePanel(); else setOpen(true); };
  const clickItem=(n)=>{ closePanel(); onLink&&onLink(n.link); };
  return(
    <div className="cdiBell" ref={ref}>
      <button onClick={toggle} aria-label="Notificações" title="Notificações"
        style={{position:"relative",width:38,height:38,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
          background:"rgba(255,255,255,0.05)",backdropFilter:"blur(18px) saturate(170%)",WebkitBackdropFilter:"blur(18px) saturate(170%)",
          border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 6px 22px rgba(0,0,0,0.32)",color:"#cbd5e1"}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        {unread>0&&(
          <span style={{position:"absolute",top:-2,right:-2,minWidth:17,height:17,padding:"0 4px",borderRadius:999,background:"#ef4444",color:"#fff",fontSize:10.5,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #0a1120"}}>{unread>9?"9+":unread}</span>
        )}
      </button>
      {open&&(
        <div className="cdiBellMenu" style={{position:"fixed",top:64,left:"50%",right:"auto",transform:"translateX(-50%)",width:"min(370px,94vw)",maxHeight:"70vh",overflowY:"auto",zIndex:9995,
          background:"rgba(17,26,45,0.92)",backdropFilter:"blur(22px) saturate(160%)",WebkitBackdropFilter:"blur(22px) saturate(160%)",
          border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 18px 48px rgba(0,0,0,0.55)",borderRadius:14}}>
          <div style={{padding:"11px 14px",borderBottom:"1px solid rgba(255,255,255,0.10)",fontSize:13,fontWeight:800,color:"#e2e8f0"}}>Notificações</div>
          {items.length===0
            ? <div style={{padding:"22px 14px",textAlign:"center",color:"#64748b",fontSize:13}}>Sem notificações.</div>
            : items.map(n=>(
                <div key={n.id} onClick={()=>clickItem(n)} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 14px",cursor:n.link?"pointer":"default",
                  borderBottom:"1px solid rgba(255,255,255,0.06)",background:n.read?"transparent":"rgba(96,165,250,0.055)"}}>
                  {n.type==="admin"&&!n.read&&<span aria-label="New" style={{writingMode:"vertical-rl",transform:"rotate(180deg)",fontSize:9,fontWeight:800,letterSpacing:"1.5px",textTransform:"uppercase",color:"#93c5fd",flexShrink:0,lineHeight:1}}>New</span>}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:"#e2e8f0",lineHeight:1.3,minWidth:0,overflowWrap:"anywhere"}}>{n.title}</div>
                    {n.body&&<div style={{fontSize:11.5,color:"#94a3b8",lineHeight:1.35,marginTop:2,display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",overflow:"hidden",overflowWrap:"anywhere",whiteSpace:"pre-line"}}>{n.body}</div>}
                  </div>
                  <span style={{fontSize:10.5,color:"#64748b",flexShrink:0,whiteSpace:"nowrap"}}>{timeAgo(n.created_at)}</span>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}

// Fundo com CROSS-FADE entre temas (página/lugar). Gradientes não animam por CSS, por isso
// sobrepomos a nova cor por cima da anterior e fazemos fade da opacidade; quando termina,
// removem-se as camadas antigas. Camada fixa atrás do conteúdo.
export function BgLayer({bg,isNew,onDone}){
  const [op,setOp]=useState(isNew?0:1);
  useEffect(()=>{
    if(!isNew) return;
    const r=requestAnimationFrame(()=>requestAnimationFrame(()=>setOp(1)));
    return()=>cancelAnimationFrame(r);
  },[isNew]);
  return <div onTransitionEnd={isNew?onDone:undefined}
    style={{position:"absolute",inset:0,background:bg,opacity:op,transition:"opacity .6s ease"}}/>;
}

export function BackgroundFade({bg}){
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

// Aviso de NOVA VERSÃO: compara a versão carregada (BUILD_VERSION) com a do servidor quando o
// separador ganha foco / de 5 em 5 min. Só atua em produção (BUILD_VERSION != "dev"). Ajuda
// quem tem o site aberto há muito tempo a recarregar para a versão mais recente.
export function UpdateBanner(){
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

// Aurora de fundo: 2 manchas de luz MUITO subtis a derivar devagar atrás de toda a app.
// Fixa, por trás do conteúdo. Respeita prefers-reduced-motion.
export function Aurora({page}){
  const r1=useRef(null), r2=useRef(null);
  useEffect(()=>{
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    if(reduce||CALM_MOTION) return;
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

/* ---- Shell --------------------------------------------------------------- */
export function Shell({children,page,rankPeriod,detailRank,detailIsOwn,nav,navRank,submitted,toast,onMyPortfolio,myPortfolioActive,myName,adminPw,showToast,onNotifLink}){
  // Relógio do mercado: não precisa de estar sempre à vista → desvanece ao fazer scroll (volta no topo).
  const [clockHidden,setClockHidden]=useState(false);
  useEffect(()=>{
    const onScroll=()=>setClockHidden(window.scrollY>24);
    onScroll();
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>window.removeEventListener("scroll",onScroll);
  },[]);
  // Premium (ouro/prata/bronze) SÓ no detalhe do Top 3. Tudo o resto — ranking, 4º+,
  // o próprio portefólio (quando fora do pódio), homepage, etc. — fica AZUL original.
  // Mesma lógica de degradê (brilho radial no topo + fade vertical).
  const GOLD={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(250,204,21,0.32) 0%, rgba(245,158,11,0.13) 38%, transparent 72%), linear-gradient(180deg,#261c0a 0%,#1c150b 55%,#120d08 80%,#0c0905 100%)",color:"#0c0905",tint:"rgba(250,204,21,0.16)",hover:"#33260a"};
  const SILVER={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(226,232,240,0.16) 0%, rgba(203,213,225,0.06) 38%, transparent 72%), linear-gradient(180deg,#1e222a 0%,#171b22 55%,#0f1216 80%,#0a0c0f 100%)",color:"#0a0c0f",tint:"rgba(203,213,225,0.15)",hover:"#161a22"};
  const BRONZE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(217,119,6,0.26) 0%, rgba(180,83,9,0.10) 38%, transparent 72%), linear-gradient(180deg,#241608 0%,#1b1109 55%,#120c07 80%,#0c0805 100%)",color:"#0c0805",tint:"rgba(217,119,6,0.18)",hover:"#2e1a0a"};
  const BLUE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",color:"#070d1c",tint:"rgba(59,130,246,0.16)",hover:"#0a1120",panel:"rgba(26,41,74,0.9)"};
  // Tema ROXO da mini-época mensal (fundo muda em modo "Mensal") — escuro e sóbrio (deep indigo-purple).
  const PURPLE={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(88,60,160,0.24) 0%, rgba(67,42,130,0.10) 42%, transparent 72%), linear-gradient(180deg,#1e1640 0%,#181230 52%,#110c24 80%,#0c0819 100%)",color:"#0c0819",tint:"rgba(109,80,200,0.16)",hover:"#140e2a",panel:"rgba(44,36,82,0.9)"};
  // Tema TEAL da mini-época SEMANAL (fundo muda em modo "Semanal") — deep teal/esmeralda escuro e sóbrio.
  const TEAL={bg:"radial-gradient(1800px 1100px at 50% -8%, rgba(20,160,150,0.22) 0%, rgba(13,120,120,0.09) 42%, transparent 72%), linear-gradient(180deg,#0c2e2e 0%,#0a2626 52%,#071c1d 80%,#051315 100%)",color:"#051315",tint:"rgba(45,212,191,0.15)",hover:"#0a2422",panel:"rgba(24,56,56,0.9)"};
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
    <div style={{minHeight:"100vh",position:"relative","--row-hover":theme.hover||"#0a1120","--cdi-panel":theme.panel||"rgba(26,41,74,0.9)",
      backgroundColor:theme.color,transition:"background-color .6s ease",
      color:"#e2e8f0",fontFamily:"var(--font-app), system-ui, -apple-system, sans-serif",overflowX:"clip"}}>
      <BackgroundFade bg={theme.bg}/>
      <Aurora page={page}/>
      <style>{`
        @media(max-width:640px){.navWide{display:none}}
        .cdiNav{justify-content:center}
        .cdiClock{position:absolute;top:12px;right:14px;transition:opacity .35s ease, transform .35s ease}
        .cdiClockHidden{opacity:0;transform:translateY(-8px);pointer-events:none}
        /* Fade suave ao mudar de página (só opacity — um transform aqui partiria o position:sticky
           da toolbar/rails do Ranking). Re-dispara via key={page}. Combina com o cross-fade do fundo. */
        @keyframes cdiPageIn{from{opacity:0}to{opacity:1}}
        .cdiPageFade{animation:cdiPageIn .34s cubic-bezier(.22,.61,.36,1)}
        @media(prefers-reduced-motion:reduce){.cdiPageFade{animation:none}}
        /* Sino de notificações: AO LADO do menu (fora do pill), como item da linha do menu. O dropdown
           ancora à direita (o sino fica no lado direito do grupo) p/ não sair do ecrã. */
        .cdiBell{position:relative;z-index:3}
        .cdiBellMenu{right:0}
        .cdiUpdatesLink{position:absolute;top:12px;left:14px;display:inline-flex;align-items:center;gap:7px;
          padding:6px 14px;border-radius:999px;cursor:pointer;color:#cbd5e1;font-size:12px;font-weight:600;letterSpacing:0.2px;
          background:rgba(255,255,255,0.05);backdrop-filter:blur(18px) saturate(170%);-webkit-backdrop-filter:blur(18px) saturate(170%);
          border:1px solid rgba(255,255,255,0.10);box-shadow:0 6px 22px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.10);
          transition:color .15s, border-color .15s, opacity .35s ease, transform .35s ease}
        .cdiUpdatesLink:hover{color:#fff;border-color:rgba(255,255,255,0.22)}
        .cdiUpdatesLink svg{opacity:0.8}
        @media(max-width:640px){.cdiUpdatesLink{display:none}}
        @media(max-width:640px){
          /* MOBILE: abas numa pílula liquid-glass no TOPO (sticky), com blur forte —
             o conteúdo passa de desfocado a nítido ao deslizar por baixo. Relógio por baixo. */
          .cdiClock{position:static;display:flex;justify-content:center;margin-top:10px;overflow:hidden;max-height:64px;
            transition:opacity .3s ease, transform .3s ease, max-height .35s ease, margin-top .35s ease}
          .cdiClockHidden{max-height:0;margin-top:0}
          .cdiNav{
            position:relative;z-index:3; /* acima do relógio (cdiClock) → o submenu do Ranking fica por cima */
            width:max-content;max-width:calc(100% - 16px);margin:0;
            justify-content:center;align-items:center;gap:4px;padding:2px 6px;border-radius:22px;flex-wrap:nowrap;
            background-color:var(--nav-tint,rgba(255,255,255,0.06));
            transition:background-color .6s ease;
            backdrop-filter:blur(42px) saturate(180%);-webkit-backdrop-filter:blur(42px) saturate(180%);
            border:1px solid rgba(255,255,255,0.14);
            box-shadow:0 8px 28px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.16);
          }
          .cdiNav>button{padding:6px 13px!important;font-size:13px!important}
        }
      `}</style>
      <header style={{position:"sticky",top:0,zIndex:50,padding:"12px 14px 20px"}}>
        {/* Vidro fosco estilo Apple: desfoca o conteúdo que passa por trás das abas e dissolve-se
            no fundo (máscara), sem tom escuro. Camada dedicada → não afeta as abas. */}
        <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:-1,pointerEvents:"none",
          backdropFilter:"blur(18px) saturate(160%)",WebkitBackdropFilter:"blur(18px) saturate(160%)",
          WebkitMaskImage:"linear-gradient(180deg,#000 0%,#000 58%,transparent 100%)",maskImage:"linear-gradient(180deg,#000 0%,#000 58%,transparent 100%)"}}/>
        {/* SÓ no Ranking: 2ª camada de blur PURO (sem saturate) na zona inferior translúcida da
            nav, para desfocar as linhas de membros que espreitam por cima da toolbar fixa. Blur
            de gradiente vazio ≈ invisível (não cria "faixa de cor"); só frosta o que passa atrás.
            A máscara DESVANECE a 100% (não corta a direito) → sem a "linha" entre dois tons de azul. */}
        {page==="ranking" && (
          <div aria-hidden="true" style={{position:"absolute",inset:0,zIndex:-1,pointerEvents:"none",
            backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
            WebkitMaskImage:"linear-gradient(180deg,transparent 34%,#000 58%,#000 78%,transparent 100%)",maskImage:"linear-gradient(180deg,transparent 34%,#000 58%,#000 78%,transparent 100%)"}}/>
        )}
        {/* Menu CENTRADO na página; o sino fica ABSOLUTO à direita do pill (não desloca o centro do menu). */}
        <div className="cdiNavRow" style={{position:"relative",width:"max-content",maxWidth:"calc(100% - 16px)",margin:"0 auto",zIndex:3}}>
          <Nav page={page} nav={nav} navRank={navRank} rankPeriod={rankPeriod} submitted={submitted} onMyPortfolio={onMyPortfolio} myPortfolioActive={myPortfolioActive} tint={theme.tint} />
          {submitted&&(
            <div style={{position:"absolute",left:"100%",top:"50%",marginTop:-19,marginLeft:4}}>{/* sem transform → o dropdown fixed centra na VIEWPORT, não neste wrapper */}
              <NotifBell myName={myName} onLink={onNotifLink} showToast={showToast}/>
            </div>
          )}
        </div>
        {page==="home"&&submitted&&(
          <button className={"cdiUpdatesLink"+(clockHidden?" cdiClockHidden":"")} title="Ir para Updates"
            onClick={()=>{ const el=document.getElementById("updates-feedbacks"); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); }}>
            Updates
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
          </button>
        )}
        <div className={"cdiClock"+(clockHidden?" cdiClockHidden":"")}><MarketStatus/></div>
      </header>
      <main className="cdiMain" style={{position:"relative",zIndex:1}}><div key={page} className="cdiPageFade">{children}</div></main>
      {(()=>{ const mw=page==="ranking"?900:page==="detail"?1320:(page==="ath"||page==="home")?940:null;
        // Portal → fora do root (overflow-x:clip) p/ o position:fixed não "flutuar" ao centro no Safari iOS.
        return(
          <Portal>
            <BackToTop maxWidth={mw}/>
          </Portal>
        );
      })()}
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
export function MarketStatus(){
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
export function Nav({page,nav,navRank,rankPeriod,submitted,onMyPortfolio,myPortfolioActive,tint}){
  // Pílula ATIVA PARTILHADA que DESLIZA entre itens ao mudar de página (em vez de saltar). Mede o item
  // ativo (`.cdiNavSel`) e anima transform/tamanho até ele; sem item ativo (duelo, perfil de outro) desvanece.
  const navRef=useRef(null);
  const [pill,setPill]=useState(null); // {left,top,width,height,visible}
  const readyRef=useRef(false);         // 1º posicionamento sem animação de transform (não "voa" do canto)
  useLayoutEffect(()=>{
    const el=navRef.current; if(!el) return;
    const measure=()=>{
      const sel=el.querySelector(".cdiNavSel"); const cr=el.getBoundingClientRect();
      if(!sel){ setPill(p=>p?{...p,visible:false}:null); return; }
      const br=sel.getBoundingClientRect();
      // border-box → padding-box (a pílula absolute parte do padding-box, dentro da borda): subtrai a borda.
      setPill({left:br.left-cr.left-el.clientLeft,top:br.top-cr.top-el.clientTop,width:br.width,height:br.height,visible:true});
    };
    measure();
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    const raf=requestAnimationFrame(()=>{ readyRef.current=!reduce; }); // reduced-motion → salta (sem deslize)
    const ro=new ResizeObserver(measure); ro.observe(el);
    return()=>{ cancelAnimationFrame(raf); ro.disconnect(); };
  },[page,myPortfolioActive,submitted]);
  const ease="cubic-bezier(.34,1.1,.4,1)";
  return(
    <div ref={navRef} className="cdiNav" style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center",gap:4,flexWrap:"nowrap",
      width:"max-content",maxWidth:"calc(100% - 16px)",padding:"2px 6px",borderRadius:22,
      background:"var(--nav-tint, rgba(255,255,255,0.06))",transition:"background-color .6s ease",
      backdropFilter:"blur(42px) saturate(180%)",WebkitBackdropFilter:"blur(42px) saturate(180%)",
      border:"1px solid rgba(255,255,255,0.14)",boxShadow:"0 8px 28px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.16)","--nav-tint":tint}}>
      {pill&&(
        <div aria-hidden="true" style={{position:"absolute",left:0,top:0,width:pill.width,height:pill.height,
          transform:`translate(${pill.left}px,${pill.top}px)`,borderRadius:999,
          background:"rgba(255,255,255,0.10)",backdropFilter:"blur(16px) saturate(180%)",WebkitBackdropFilter:"blur(16px) saturate(180%)",
          border:"1px solid rgba(255,255,255,0.14)",boxShadow:"0 4px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.16)",opacity:pill.visible?1:0,
          transition:readyRef.current?`transform .42s ${ease}, width .42s ${ease}, height .42s ${ease}, opacity .25s ease`:"opacity .25s ease",
          zIndex:0,pointerEvents:"none"}}/>
      )}
      <NavLink label="Início" active={page==="home"} onClick={()=>nav("home")} icon={NAV_ICONS.home}/>
      <RankingNav active={page==="ranking"} rankPeriod={rankPeriod} navToRanking={()=>nav("ranking")} navRank={navRank}/>
      <NavLink label="ATH" active={page==="ath"} onClick={()=>nav("ath")} icon={NAV_ICONS.mountain}/>
      <NavLink label="Minhas 8" active={submitted?myPortfolioActive:page==="detail"} onClick={onMyPortfolio} locked={!submitted} icon={NAV_ICONS.person}/>
    </div>
  );
}

export function RankingNav({active,rankPeriod,navToRanking,navRank}){
  const [open,setOpen]=useState(false);
  const items=[["total","Geral"],["month","Mensal"],["week","Semanal"]];
  return(
    <div style={{position:"relative",zIndex:1}} onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
      {/* Vindo de outra aba → vai direto ao Ranking Geral (e fecha o submenu). Já no Ranking →
          mantém o separador atual. */}
      <NavLink label="Ranking" active={active} onClick={()=>{ setOpen(false); active?navToRanking():navRank("total"); }} caret icon={NAV_ICONS.trophy}/>
      {open&&(
        // paddingTop = ponte invisível entre o botão e o menu → o rato não "sai" no espaço vazio.
        <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",paddingTop:8,zIndex:80}}>
          {/* Mesmo liquid glass do botão "Ranking" (fundo translúcido + blur + realce interior),
              mas estreito e centrado sob a palavra — lê-se como um submenu. */}
          <div style={{display:"flex",flexDirection:"column",gap:3,padding:5,borderRadius:16,
            background:"rgba(20,30,54,0.96)",backdropFilter:"blur(24px) saturate(180%)",WebkitBackdropFilter:"blur(24px) saturate(180%)",
            border:"1px solid rgba(255,255,255,0.16)",boxShadow:"0 12px 30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.14)"}}>
            {items.map(([k,lbl])=>{
              const sel=active&&rankPeriod===k;
              const ac=RANK_PERIOD_ACCENT[k];
              return(
                <button key={k} onClick={()=>{ setOpen(false); navRank(k); }}
                  onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background="rgba(255,255,255,0.10)"; }}
                  onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background="transparent"; }}
                  style={{cursor:"pointer",textAlign:"center",fontSize:13.5,fontWeight:sel?700:600,whiteSpace:"nowrap",
                    padding:"7px 18px",borderRadius:11,border:"none",transition:"background .12s,color .12s,box-shadow .12s",
                    color:sel?"#0a0a0a":"#e2e8f0",
                    background:sel?`linear-gradient(180deg,${ac.l},${ac.d})`:"transparent",
                    boxShadow:sel?`0 2px 12px rgba(${ac.rgb},0.45)`:"none"}}>
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

// Link de navegação: ÍCONE (traço, herda a cor) em vez de texto; o nome fica em title/aria-label
// (tooltip no desktop + acessibilidade). Só a página atual recebe a pílula liquid-glass.
export function NavLink({label,active,onClick,locked,caret,icon}){
  return(
    <button onClick={onClick} className={active?"cdiNavSel":undefined} title={label} aria-label={label}
      onMouseEnter={e=>{ if(!active) e.currentTarget.style.color="#e2e8f0"; }}
      onMouseLeave={e=>{ if(!active) e.currentTarget.style.color="#9aa4b2"; }}
      style={{cursor:"pointer",fontSize:14,fontWeight:active?600:500,padding:"8px 16px",borderRadius:999,
        color:active?"#e2e8f0":"#9aa4b2",
        background:"transparent",border:"1px solid transparent",
        transition:"color 0.25s ease",position:"relative",zIndex:1,display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",flexShrink:0}}>
      {icon
        ? <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
        : label}
      {/* 🔒 ABSOLUTO → não ocupa largura, para os ícones ficarem todos com o mesmo espaçamento.
          (o caret ▾ foi removido; o submenu do Ranking mantém-se via hover no RankingNav) */}
      {locked&&<span style={{position:"absolute",right:8,top:5,fontSize:9,opacity:0.5,pointerEvents:"none"}}>🔒</span>}
    </button>
  );
}

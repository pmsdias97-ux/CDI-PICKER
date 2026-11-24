// Componentes de UI partilhados (extraído de app/page.js).

import { useState, useEffect, forwardRef, useRef, useId } from "react";
import { prepareSparklinePoints } from "../lib/ranking-sparkline.mjs";
import { createPortal } from "react-dom";
import { CALM_MOTION, LOGODEV_TOKEN } from "../lib/core";
import { TICKER_NOTES } from "../lib/tickerAlias";

// Odómetro estilo Robinhood: cada dígito rola na vertical até ao valor (na entrada
// e quando o valor muda). Carateres não-dígitos (sinais, ".", "%") ficam estáticos.
export function RollDigit({d,dur}){
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

export function Rolling({text,dur=700,style}){
  return(
    <span style={{display:"inline-block",whiteSpace:"pre",lineHeight:1,...style}}>
      {[...String(text)].map((ch,i)=> /[0-9]/.test(ch)
        ? <RollDigit key={i} d={+ch} dur={dur}/>
        : <span key={i}>{ch}</span>)}
    </span>
  );
}

export function Monogram({ticker,size}){
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
export const TiltCard=forwardRef(function TiltCard({children,style},ref){
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
    <div ref={ref} {...handlers} style={{...style,position:"relative",overflow:"hidden",transform:t||"none",transition:"transform .18s ease",willChange:"transform"}}>
      {enabled&&(
        <div style={{position:"absolute",inset:0,borderRadius:"inherit",pointerEvents:"none",
          background:`radial-gradient(240px circle at ${pos.x}% ${pos.y}%, rgba(255,255,255,0.05), transparent 60%)`,
          opacity:hovering?1:0,transition:"opacity .2s ease"}}/>
      )}
      {children}
    </div>
  );
});

// Confete dourado (sem biblioteca) — celebração do 1º lugar. Dispara 1× ao abrir o detalhe
// do campeão; mais intenso quando o #1 é o próprio. Mobile/tablet/desktop; respeita
// prefers-reduced-motion (quem reduz movimento não vê animação). pointer-events:none.
export function Confetti({intense}){
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

// Glow dourado que SEGUE o cursor (só desktop), recortado pela forma da própria imagem
// (máscara). Usado no logo da Home e no troféu do #1. Subtil/premium.
export function GoldGlow({src,alt="",maskSrc,wrapStyle,imgStyle,baseFilter="",glow=16,glowRGB="245,158,11",sparkRGB="253,224,71"}){
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
        filter:(hov&&on)?`${baseFilter} drop-shadow(0 0 ${glow}px rgba(${glowRGB},0.32))`:baseFilter}}/>
      {on&&(
        <span aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
          background:`radial-gradient(circle at ${pos.x}% ${pos.y}%, rgba(${sparkRGB},0.38), rgba(${glowRGB},0.10) 42%, transparent 72%)`,
          mixBlendMode:"screen",opacity:hov?1:0,transition:"opacity .35s ease",...mask}}/>
      )}
    </span>
  );
}

export function BreatheGlow({color="rgba(64,170,205,0.5)",mid="rgba(56,189,248,0.16)",inset="-14% -10%",blur=46,base=0.45,duration=22000}){
  const ref=useRef(null);
  useEffect(()=>{
    let reduce=false; try{ reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{}
    const el=ref.current; if(!el||reduce||CALM_MOTION||!el.animate) return;
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

export function GlowBehind({children,color,mid}){
  return(
    <div style={{position:"relative"}}>
      <BreatheGlow color={color} mid={mid}/>
      <div style={{position:"relative",zIndex:1}}>{children}</div>
    </div>
  );
}

// Só marca as posições SHORT — long é o normal, não precisa de badge.
// Círculo com seta diagonal para baixo (aposta na queda), junto ao ticker.
export function SideBadge({side,label}){
  if(side!=="short") return null;
  const circle=(
    <span title="Posição short (aposta na queda)" style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:"clamp(15px,4.2vw,18px)",height:"clamp(15px,4.2vw,18px)",borderRadius:"50%",flexShrink:0,
      background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.4)"}}>
      <svg style={{width:"clamp(8px,2.3vw,10px)",height:"clamp(8px,2.3vw,10px)"}} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7L17 17"/><path d="M17 10V17H10"/>
      </svg>
    </span>
  );
  if(!label) return circle;
  // Lista de ações do portefólio. DESKTOP: pill âmbar com "SHORT" + seta. MOBILE: só "SHORT" minúsculo
  // (sem seta/pill). Texto com largura fixa ~25px → não empurra a coluna do lado. Estilos em globals.css.
  return(
    <span className="sideShort" title="Posição short (aposta na queda)">
      <span className="sideShortTxt">Short</span>
      <svg className="sideShortArrow" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 7L17 17"/><path d="M17 10V17H10"/>
      </svg>
    </span>
  );
}

// Logótipo de uma empresa com EVENTO CORPORATIVO (mudou de nome/símbolo: ATLN → CIRC; ou foi adquirida: WBD): mostra o logótipo
// (o da empresa nova, no caso da mudança de nome) com um selinho no canto e, em tamanhos normais, um tooltip a explicar (hover no desktop; toque abre/fecha
// no telemóvel). Em tamanhos pequenos (<22px) não há tooltip próprio — a lista que o rodeia já mostra o nome (HoverName).
// Dados e texto em lib/tickerAlias.js.
function NoteBadge({from,info,size}){
  const [pos,setPos]=useState(null);
  const [imgErr,setImgErr]=useState(false);
  const ref=useRef(null);
  const tip=size>=22;
  const open=()=>{ if(!tip) return; const r=ref.current?.getBoundingClientRect(); if(!r) return;
    const vw=typeof window!=="undefined"?window.innerWidth:1200;
    const below=r.top<170;                                    // sem espaço em cima → abre para baixo
    setPos({x:Math.min(Math.max(r.left+r.width/2,150),vw-150),y:below?r.bottom+8:r.top-8,below}); };
  useEffect(()=>{
    if(!pos) return;
    const close=(e)=>{ if(ref.current&&!ref.current.contains(e.target)) setPos(null); };
    const esc=(e)=>{ if(e.key==="Escape") setPos(null); };
    const onScroll=()=>setPos(null);
    document.addEventListener("pointerdown",close); document.addEventListener("keydown",esc); window.addEventListener("scroll",onScroll,{passive:true});
    return()=>{ document.removeEventListener("pointerdown",close); document.removeEventListener("keydown",esc); window.removeEventListener("scroll",onScroll); };
  },[pos]);
  const rename=info.kind==="rename";
  const src=LOGODEV_TOKEN?`https://img.logo.dev/${info.logoDomain||`ticker/${encodeURIComponent(from)}`}?token=${LOGODEV_TOKEN}&size=${size*3}&format=png&retina=true&fallback=404`:null;
  const bd=Math.max(11,Math.round(size*0.44));
  const handlers=tip?{
    tabIndex:0,
    onPointerEnter:e=>{ if(e.pointerType==="mouse") open(); }, onPointerLeave:e=>{ if(e.pointerType==="mouse") setPos(null); },
    onFocus:open, onBlur:()=>setPos(null),
    onClick:e=>{ if(e.nativeEvent?.pointerType==="mouse") open(); else if(pos) setPos(null); else open(); },
  }:{};
  return(
    <span ref={ref} className="stkLogo" role="img" aria-label={rename?`${info.company} (antes ${from})`:`${from}: ${info.headline}`} {...handlers}
      style={{position:"relative",display:"inline-flex",flexShrink:0,cursor:tip?"help":undefined}}>
      {src&&!imgErr
        ?<img src={src} alt="" width={size} height={size} loading="lazy" onError={()=>setImgErr(true)}
            style={{width:size,height:size,borderRadius:6,objectFit:"cover",background:"#fff",display:"block",flexShrink:0}}/>
        :<Monogram ticker={rename?info.to:from} size={size}/>}
      {size>=24&&(
        <span aria-hidden="true" style={{position:"absolute",right:-4,bottom:-4,width:bd,height:bd,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
          background:rename?"linear-gradient(145deg,#3b82f6 0%,#7c3aed 100%)":"linear-gradient(145deg,#f59e0b 0%,#d97706 100%)",border:"1.5px solid #0b1224",boxShadow:"0 1px 4px rgba(0,0,0,0.5)"}}>
          <svg width={Math.round(bd*0.62)} height={Math.round(bd*0.62)} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            {rename
              ?<><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>
              :<><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></>}
          </svg>
        </span>
      )}
      {pos&&typeof document!=="undefined"&&createPortal(
        <div role="tooltip" style={{position:"fixed",left:pos.x,top:pos.y,transform:pos.below?"translate(-50%,0)":"translate(-50%,-100%)",zIndex:9999,pointerEvents:"none",
          width:"min(290px,calc(100vw - 24px))",boxSizing:"border-box",background:"rgba(8,15,32,0.97)",border:"1px solid rgba(167,139,250,0.45)",borderRadius:10,
          padding:"10px 12px",boxShadow:"0 10px 30px rgba(0,0,0,0.55)",textAlign:"left",whiteSpace:"normal"}}>
          <div style={{fontSize:12.5,fontWeight:800,color:"#e2e8f0",marginBottom:5,display:"flex",alignItems:"center",flexWrap:"wrap",gap:6}}>
            {rename
              ?<><span>{from}</span><span style={{color:"#a78bfa"}}>→</span><span style={{color:"#c4b5fd"}}>{info.to}</span><span style={{fontWeight:600,color:"#94a3b8",fontSize:11.5}}>· {info.company}</span></>
              :<><span>{from}</span><span style={{fontWeight:700,color:"#fbbf24",fontSize:12}}>· {info.headline}</span></>}
          </div>
          <div style={{fontSize:12,lineHeight:1.45,color:"#cbd5e1",fontWeight:500}}>{info.text}</div>
        </div>,document.body)}
    </span>
  );
}

export function StockLogo({ticker,size=28}){
  const [err,setErr]=useState(false);
  if(!ticker) return null;
  const note=TICKER_NOTES[String(ticker).toUpperCase()];
  if(note) return <NoteBadge from={String(ticker).toUpperCase()} info={note} size={size}/>;
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

export function Skeleton({w="100%",h=12,r=8,style}){
  return <span className="cdiSkeleton" style={{display:"inline-block",width:w,height:h,borderRadius:r,...style}}/>;
}

export function MiniSparkline({series,current,height=48,fill=true,flat=false}){
  const uid=useId();
  const today=new Date().toISOString().slice(0,10);
  const pts=prepareSparklinePoints(series,current,today);
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
export function CountUp({to=0}){
  return <span>{Number(to||0).toLocaleString("pt-PT")}</span>;
}

// Materialização ao entrar no ecrã (estilo Apple): a superfície "chega" — desfoque→nítido + ligeira
// subida e escala, com easing tipo-spring (sem overshoot). Corre 1× por elemento. Respeita
// prefers-reduced-motion (só cross-fade, sem transform/blur). Compositor-friendly (transform/opacity).
export function Reveal({children,delay=0,y=14,style,className}){
  const ref=useRef(null);
  const [shown,setShown]=useState(false);
  useEffect(()=>{
    if(typeof window==="undefined") return;
    const el=ref.current; if(!el) return;
    const reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(reduce){ setShown(true); return; }
    const io=new IntersectionObserver((ents)=>{
      for(const e of ents){ if(e.isIntersecting){ setShown(true); io.disconnect(); break; } }
    },{threshold:0.01,rootMargin:"0px 0px 22% 0px"}); // dispara bem ANTES de entrar → já nítido quando se vê
    io.observe(el);
    return()=>io.disconnect();
  },[]);
  const reduce=typeof window!=="undefined"&&window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // SEM filter:blur — animá-lo por cima do backdrop-filter (vidro) das boxes é pesadíssimo e o desfoque
  // "agarra-se" (fica em blur muito tempo). Só fade + subida + escala: leve, compositor-friendly, instantâneo.
  return(
    <div ref={ref} className={className} style={{
      ...style,
      opacity:shown?1:0,
      transform:(shown||reduce)?"none":`translateY(${y}px) scale(0.99)`,
      transition:reduce
        ?`opacity .35s ease ${delay}ms`
        :`opacity .42s cubic-bezier(.22,.61,.36,1) ${delay}ms, transform .42s cubic-bezier(.22,.61,.36,1) ${delay}ms`,
      willChange:shown?"auto":"opacity, transform",
    }}>{children}</div>
  );
}

/* ---- Ranking ------------------------------------------------------------- */
// ⓘ com tooltip — hover (desktop) e toque (mobile). O popover abre PARA BAIXO
// para não ser cortado pelo overflow:hidden do cartão.
// Tooltip INSTANTÂNEO (sem o atraso do title nativo). Via portal p/ o body → não é recortado
// pelos painéis (overflow:hidden + backdrop-filter). Estado por-ícone: só re-renderiza este nó.
export function HoverName({label,children,ring}){
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

export function InfoTip({text,children}){
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

// Seta que distingue a box "melhor" (▲) da "pior" (▼).
// Triângulo ▲/▼ com cantos arredondados (substitui os caracteres Unicode, que não dobram cantos).
export function Tri({up=true,size=12,color="currentColor",style}){
  return(
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke={color}
      strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"
      style={{display:"inline-block",verticalAlign:"middle",...style}}>
      {up?<path d="M12 6 L20.5 18.5 L3.5 18.5 Z"/>:<path d="M12 18 L3.5 5.5 L20.5 5.5 Z"/>}
    </svg>
  );
}

/* ---- Reusable button ----------------------------------------------------- */
// Ícones inline para os CTAs do herói (sem emojis).
export function Arrow(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>;
}

export function LockIcon(){
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0}}><rect x="4.5" y="11" width="15" height="9.5" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>;
}

export function Btn({children,onClick,primary,large}){
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

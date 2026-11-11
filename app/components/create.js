// Módulo "create" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useEffect } from "react";
import { searchTickers, fetchStockInfo } from "../lib/stocks";
import { MAX_SHORTS, PORTFOLIO_SIZE, TICKER_RE, submissionsClosed } from "../lib/core";
import { Btn, SideBadge, StockLogo } from "./ui";

/* ---- Create -------------------------------------------------------------- */
export function Create({settings,doSubmit,onDone,showToast}){
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

export function StepDot({n,active,done,label}){
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
export function AlreadySubmitted({nav,name}){
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
export function Confirm({nav,name}){
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
export function LockedGate({nav,recoverByName,showToast}){
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

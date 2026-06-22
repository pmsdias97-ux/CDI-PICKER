"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./supabase";
import { fetchStockPrice, fetchStockPrices, searchTickers } from "./lib/stocks";

/* ============================================================================
   CONVERSAS DE INVESTIDORES
   ============================================================================ */

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;
const PORTFOLIO_SIZE = 8;
const STARTING_VALUE = 10000;
const PER_STOCK = STARTING_VALUE / PORTFOLIO_SIZE;
const DEFAULT_ADMIN_PW = "CDI_2000!26";

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
  return s.initialPrice?c/s.initialPrice-1:0;
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
    stocks:(row.portfolio_stocks||[]).map(s=>({
      ticker:s.ticker,
      companyName:s.company_name,
      exchange:"",
      initialPrice:Number(s.initial_price),
      initialWeight:Number(s.initial_weight)/100,
      allocated:PER_STOCK,
    })),
  };
}
function pfStats(p,livePrices){
  const rets=p.stocks.map(s=>stockRet(s,livePrices));
  return{ total:rets.reduce((a,b)=>a+b,0)/rets.length, pos:rets.filter(r=>r>0).length, neg:rets.filter(r=>r<0).length };
}
function pct(x,dp=2){ const v=(x*100).toFixed(dp); return `${x>=0?"+":""}${v}%`; }
function money(x){ return new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",minimumFractionDigits:2}).format(x); }
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

/* ---- Shared game settings (Supabase) ------------------------------------- */
const DEFAULT_SETTINGS={submissionsOpen:true,gameStartDate:"",gameEndDate:""};
async function loadGameSettings(){
  try{
    const { data, error }=await supabase
      .from("game_settings")
      .select("submissions_open,game_start_date,game_end_date")
      .eq("id",1)
      .maybeSingle();
    if(error||!data) return null;
    return{
      submissionsOpen:data.submissions_open!==false,
      gameStartDate:data.game_start_date||"",
      gameEndDate:data.game_end_date||"",
    };
  }catch{ return null; }
}
async function saveGameSettings(s){
  try{
    const { error }=await supabase.from("game_settings").upsert({
      id:1,
      submissions_open:s.submissionsOpen,
      game_start_date:s.gameStartDate||null,
      game_end_date:s.gameEndDate||null,
    });
    return !error;
  }catch{ return false; }
}

/* ---- Keys ---------------------------------------------------------------- */
const K={MYNAME:"ci_myname"};

/* ============================================================================
   ROOT
   ============================================================================ */
export default function App(){
  const [page,setPage]=useState("home"); // home|create|confirm|ranking|detail|admin
  const [loading,setLoading]=useState(true);
  const [settings,setSettings]=useState(null);
  const [portfolios,setPortfolios]=useState([]);
  const [myName,setMyName]=useState(null);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [livePrices,setLivePrices]=useState({});
  const [pricesLoading,setPricesLoading]=useState(false);
  const [detailKey,setDetailKey]=useState(null);
  const [toast,setToast]=useState(null);

  const showToast=useCallback((msg,kind="ok")=>{ setToast({msg,kind}); setTimeout(()=>setToast(null),3500); },[]);

  const refreshLivePrices=useCallback(async(pfs)=>{
    const tickers=[...new Set((pfs||[]).flatMap(p=>p.stocks.map(s=>s.ticker)))];
    if(!tickers.length){ setLivePrices({}); return; }
    setPricesLoading(true);
    try{
      const prices=await fetchStockPrices(tickers);
      setLivePrices(prices);
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
        users (
          telegram_name,
          has_submitted_portfolio
        ),
        portfolio_stocks (
          ticker,
          company_name,
          initial_price,
          current_price,
          initial_weight
        )
      `);
    if(pfError){
      console.error(pfError);
      setPortfolios([]);
      setLivePrices({});
    }else{
      const pfs=(portfolioRows||[])
        .filter(row=>row.users?.has_submitted_portfolio)
        .map(mapPortfolioFromSupabase);
      setPortfolios(pfs);
      await refreshLivePrices(pfs);
    }

    let submitted=false;
    if(mn?.trim()){
      const { data: userRow, error: userError }=await supabase
        .from("users")
        .select("has_submitted_portfolio")
        .ilike("telegram_name", mn.trim())
        .maybeSingle();
      if(!userError&&userRow) submitted=userRow.has_submitted_portfolio===true;
    }
    setHasSubmitted(submitted);
    setLoading(false);
  },[refreshLivePrices]);

  useEffect(()=>{ load(); },[load]);

  // Entrada discreta para a área de admin: abrir a app com #admin no URL
  // (ex.: localhost:3000/#admin). Continua protegida pela palavra-passe.
  useEffect(()=>{
    const applyHash=()=>{ if(window.location.hash==="#admin") setPage("admin"); };
    applyHash();
    window.addEventListener("hashchange",applyHash);
    return()=>window.removeEventListener("hashchange",applyHash);
  },[]);

  const myPf=useMemo(()=>{
    if(!myName) return null;
    const n=norm(myName);
    return portfolios.find(p=>p.normName===n)||null;
  },[myName,portfolios]);

  const submitted=hasSubmitted;

  const ranking=useMemo(()=>
    portfolios.map(p=>({...p,...pfStats(p,livePrices)})).sort((a,b)=>b.total-a.total)
  ,[portfolios,livePrices]);

  async function doSubmit(name,stocks){
    // Any Telegram name is valid; submitting registers it in `users` automatically.
    const gs=await loadGameSettings();
    if(gs&&!gs.submissionsOpen) return{error:"As submissões estão fechadas de momento."};

    const trimmedName=name.trim();
    if(!trimmedName) return{error:"Escreve o teu nome."};
    const { data: existingUser, error: lookupError }=await supabase
      .from("users")
      .select("id, has_submitted_portfolio, telegram_name")
      .ilike("telegram_name", trimmedName)
      .maybeSingle();
    if(lookupError) return{error:"Não foi possível verificar o nome. Tenta novamente."};
    if(existingUser?.has_submitted_portfolio)
      return{error:"Já existe um portefólio com esse nome. Cada membro só pode participar uma vez."};

    const { data: userRow, error: userError }=await supabase
      .from("users")
      .insert({ telegram_name: trimmedName, has_submitted_portfolio: false })
      .select("id")
      .single();
    if(userError||!userRow) return{error:"Não foi possível registar o utilizador. Tenta novamente."};

    const { data: portfolioRow, error: portfolioError }=await supabase
      .from("portfolios")
      .insert({ user_id: userRow.id, locked: true, initial_value: STARTING_VALUE })
      .select("id")
      .single();
    if(portfolioError||!portfolioRow){
      return{error:"Não foi possível criar o portefólio. Tenta novamente."};
    }

    const tickers=stocks.map(s=>s.ticker);
    const prices=await fetchStockPrices(tickers);
    for(const s of stocks){
      if(typeof prices[s.ticker]!=="number"){
        return{error:`Não foi possível obter o preço de ${s.ticker}. Verifica o ticker ou tenta mais tarde.`};
      }
    }

    const stockRows=stocks.map(s=>{
      const price=prices[s.ticker];
      return{
        portfolio_id: portfolioRow.id,
        ticker: s.ticker,
        company_name: s.name,
        initial_price: price,
        current_price: price,
        initial_weight: 12.5,
      };
    });
    const { error: stocksError }=await supabase.from("portfolio_stocks").insert(stockRows);
    if(stocksError) return{error:"Não foi possível guardar as ações. Tenta novamente."};

    const { error: updateError }=await supabase
      .from("users")
      .update({ has_submitted_portfolio: true })
      .eq("id", userRow.id);
    if(updateError) return{error:"Portefólio guardado, mas falhou a confirmação. Contacta o administrador."};

    sset(K.MYNAME, trimmedName);
    setMyName(trimmedName);
    await load();
    setHasSubmitted(true);
    setPage("ranking");
    return{ok:true};
  }

  // Returning member with no local identity (closed window, cleared storage,
  // other device): re-identify by Telegram name against Supabase. No password —
  // the name already is the unique, validated identity.
  async function recoverByName(rawName){
    const name=(rawName||"").trim();
    if(!name) return{error:"Escreve o teu nome."};
    const { data, error }=await supabase
      .from("users")
      .select("telegram_name, has_submitted_portfolio")
      .ilike("telegram_name", name)
      .maybeSingle();
    if(error) return{error:"Não foi possível verificar o nome. Tenta novamente."};
    if(!data||data.has_submitted_portfolio!==true)
      return{error:"Não encontrámos um portefólio submetido com esse nome."};
    sset(K.MYNAME, data.telegram_name);
    setMyName(data.telegram_name);
    setHasSubmitted(true);
    setPage("ranking");
    return{ok:true};
  }

  const nav=(p)=>setPage(p);

  if(loading) return(
    <div style={{minHeight:"100vh",background:"#080d14",display:"flex",alignItems:"center",justifyContent:"center",color:"#4b5563",fontFamily:"system-ui,sans-serif"}}>
      A carregar…
    </div>
  );

  const sh=(children)=><Shell page={page} nav={nav} submitted={submitted} toast={toast}>{children}</Shell>;

  if(page==="home")   return sh(<Home nav={nav} submitted={submitted} count={portfolios.length} settings={settings}/>);
  if(page==="create") return sh(submitted?<AlreadySubmitted nav={nav} name={myName}/>:<Create settings={settings} doSubmit={doSubmit} onDone={()=>nav("ranking")} showToast={showToast}/>);
  if(page==="confirm")return sh(<Confirm nav={nav} name={myName}/>);
  if(page==="ranking")return sh(submitted?<Ranking ranking={ranking} myNorm={norm(myName)} pricesLoading={pricesLoading} onSelect={(k)=>{setDetailKey(k);nav("detail");}}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="detail") return sh(submitted?<Detail pf={portfolios.find(p=>p.key===detailKey)||myPf} livePrices={livePrices} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="admin")  return sh(<Admin settings={settings} setSettings={setSettings} portfolios={portfolios} ranking={ranking} livePrices={livePrices} reload={load} showToast={showToast}/>);
  return null;
}

/* ---- Shell --------------------------------------------------------------- */
function Shell({children,page,nav,submitted,toast}){
  return(
    <div style={{minHeight:"100vh",background:"#080d14",color:"#e2e8f0",fontFamily:"system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",overflowX:"hidden"}}>
      <Nav page={page} nav={nav} submitted={submitted} />
      <main>{children}</main>
      {toast&&(
        <div style={{position:"fixed",bottom:24,left:"50%",transform:"translateX(-50%)",zIndex:9999,
          background:toast.kind==="error"?"#1a0a0a":"#0a1a0f",border:`1px solid ${toast.kind==="error"?"#ef4444":"#22c55e"}`,
          borderRadius:12,padding:"12px 20px",fontSize:14,color:toast.kind==="error"?"#fca5a5":"#86efac",
          whiteSpace:"nowrap",boxShadow:"0 8px 32px rgba(0,0,0,0.6)"}}>
          {toast.kind==="error"?"⚠ ":""}{toast.msg}
        </div>
      )}
    </div>
  );
}

/* ---- Nav ----------------------------------------------------------------- */
function Nav({page,nav,submitted}){
  return(
    <nav style={{position:"sticky",top:0,zIndex:50,background:"rgba(8,13,20,0.92)",backdropFilter:"blur(12px)",
      borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"0 24px",display:"flex",alignItems:"center",height:56}}>
      <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>nav("home")}>
        <div style={{width:28,height:28,borderRadius:8,background:"linear-gradient(135deg,#22c55e,#16a34a)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>📈</div>
        <span style={{fontWeight:700,fontSize:15,letterSpacing:"-0.3px"}}>Conversas de Investidores</span>
      </div>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
        <NavLink label="Início" active={page==="home"} onClick={()=>nav("home")}/>
        <NavLink label="Ranking" active={page==="ranking"} onClick={()=>nav("ranking")} locked={!submitted}/>
        <button onClick={()=>nav("create")} style={{background:"#22c55e",color:"#000",border:"none",borderRadius:8,
          padding:"8px 16px",fontSize:14,fontWeight:700,cursor:"pointer",letterSpacing:"-0.2px"}}>
          Criar Portefólio
        </button>
      </div>
    </nav>
  );
}
function NavLink({label,active,onClick,locked}){
  return(
    <button onClick={onClick} style={{background:"none",border:"none",cursor:"pointer",
      color:active?"#e2e8f0":"#6b7280",fontSize:14,fontWeight:active?600:400,padding:"8px 12px",borderRadius:8,
      transition:"color 0.15s",display:"flex",alignItems:"center",gap:4}}>
      {label}{locked&&<span style={{fontSize:10,opacity:0.5}}>🔒</span>}
    </button>
  );
}

/* ---- Home ---------------------------------------------------------------- */
function Home({nav,submitted,count,settings}){
  return(
    <div>
      {/* Hero */}
      <section style={{textAlign:"center",padding:"100px 24px 80px",maxWidth:780,margin:"0 auto"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(34,197,94,0.1)",
          border:"1px solid rgba(34,197,94,0.25)",borderRadius:999,padding:"6px 16px",fontSize:13,
          color:"#4ade80",marginBottom:32}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#4ade80",display:"inline-block"}}/>
          Jogo ativo — Submissões {settings?.submissionsOpen?"abertas":"fechadas"}
        </div>
        <h1 style={{fontSize:"clamp(40px,6vw,72px)",fontWeight:800,lineHeight:1.1,letterSpacing:"-2px",margin:"0 0 20px"}}>
          Conversas de{" "}
          <span style={{color:"#22c55e"}}>Investidores</span>
        </h1>
        <p style={{fontSize:18,color:"#6b7280",lineHeight:1.6,maxWidth:560,margin:"0 auto 40px"}}>
          O jogo de portefólios da nossa comunidade. Escolhe as tuas 8 ações,
          submete o teu portefólio e compete com os outros membros pelo melhor retorno.
        </p>
        <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap"}}>
          {submitted?(
            <>
              <Btn onClick={()=>nav("ranking")} primary>Ver Ranking</Btn>
              <Btn onClick={()=>nav("create")}>O meu portefólio</Btn>
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

      {/* Como funciona */}
      <section style={{maxWidth:980,margin:"0 auto",padding:"0 24px 80px"}}>
        <h2 style={{textAlign:"center",fontSize:28,fontWeight:700,letterSpacing:"-0.5px",marginBottom:40}}>Como funciona</h2>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16}}>
          {[
            {n:"01",icon:"✏️",t:"Insere o teu nome",d:"Usa exatamente o mesmo nome que tens no grupo de Telegram da comunidade."},
            {n:"02",icon:"🔍",t:"Escolhe 8 ações",d:"Pesquisa por ticker ou nome da empresa. Tens de selecionar exatamente 8 ações."},
            {n:"03",icon:"🚀",t:"Submete o portefólio",d:"Depois da submissão, tens acesso ao ranking completo e aos portefólios dos outros."},
          ].map(c=>(
            <div key={c.n} style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24,position:"relative",overflow:"hidden"}}>
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
        <div style={{background:"#0d1520",border:"1px solid #1f2937",borderRadius:16,padding:40}}>
          <h2 style={{fontSize:22,fontWeight:700,marginBottom:28,letterSpacing:"-0.3px"}}>📋 Regras do Jogo</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:"12px 40px"}}>
            {[
              "Cada participante cria exatamente 1 portefólio com 8 ações",
              "Cada ação representa 12,5% do portefólio (peso igual)",
              "O portefólio começa com um valor fictício de 10.000€",
              "O preço de cada ação é registado no momento da submissão",
              "Não podes ver os outros portefólios antes de submeter o teu",
              "Depois de submetido, o portefólio fica bloqueado",
              "O ranking é atualizado automaticamente com os preços atuais",
              "A rentabilidade é calculada como a média das 8 ações",
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
            <Btn onClick={()=>nav("create")} primary large>Criar Portefólio Agora</Btn>
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
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [picked,setPicked]=useState([]);
  const [submitting,setSubmitting]=useState(false);

  useEffect(()=>{
    const q=query.trim();
    if(q.length<1){ setResults([]); return; }
    let cancelled=false;
    const timer=setTimeout(async()=>{
      setSearching(true);
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
  const add=s=>{ if(picked.length>=PORTFOLIO_SIZE||has(s.ticker)) return; setPicked(p=>[...p,s]); setQuery(""); };
  const addManual=()=>{
    const ticker=query.trim().toUpperCase();
    if(!TICKER_RE.test(ticker)){
      showToast("Ticker inválido. Usa letras, números, ponto ou hífen (ex: AAPL, MC.PA).","error");
      return;
    }
    if(has(ticker)) return;
    add({ ticker, name: ticker, exchange: "", currency: "USD" });
  };
  const rem=t=>setPicked(p=>p.filter(s=>s.ticker!==t));
  const progress=picked.length/PORTFOLIO_SIZE;
  const submClosed=settings&&!settings.submissionsOpen;

  async function submit(){
    if(picked.length!==PORTFOLIO_SIZE||!name.trim()||submitting) return;
    setSubmitting(true);
    const r=await doSubmit(name,picked);
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
        <StepDot n={1} active={step===1} done={step>1} label="O teu nome"/>
        <div style={{flex:1,maxWidth:80,height:1,background:step>1?"#22c55e":"#1f2937"}}/>
        <StepDot n={2} active={step===2} done={false} label="Escolher ações"/>
      </div>

      {submClosed&&(
        <div style={{background:"#1a1200",border:"1px solid rgba(251,191,36,0.3)",borderRadius:12,padding:"12px 16px",
          fontSize:14,color:"#fbbf24",marginBottom:20}}>
          🔒 As submissões estão fechadas de momento.
        </div>
      )}

      {/* Step 1 — nome */}
      {step===1&&(
        <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:32}}>
          <h2 style={{fontSize:18,fontWeight:700,marginBottom:6}}>O teu nome no Telegram</h2>
          <p style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Escreve exatamente o mesmo nome que aparece no grupo de Telegram da comunidade.</p>
          <input value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter"&&name.trim().length>=2) setStep(2); }}
            placeholder="Ex: João Silva"
            style={{width:"100%",background:"#0d1520",border:`1px solid ${name.trim().length>=2?"#22c55e":"#1f2937"}`,
              borderRadius:10,padding:"14px 16px",fontSize:16,color:"#e2e8f0",outline:"none",
              boxSizing:"border-box",transition:"border-color 0.2s"}}/>
          <button onClick={()=>{ if(name.trim().length>=2) setStep(2); }}
            disabled={name.trim().length<2||submClosed}
            style={{width:"100%",marginTop:16,background:name.trim().length>=2&&!submClosed?"#22c55e":"#1f2937",
              color:name.trim().length>=2&&!submClosed?"#000":"#4b5563",border:"none",borderRadius:10,
              padding:"14px",fontSize:16,fontWeight:700,cursor:name.trim().length>=2?"pointer":"not-allowed",
              transition:"background 0.2s"}}>
            Continuar →
          </button>
        </div>
      )}

      {/* Step 2 — ações */}
      {step===2&&(
        <>
          {/* Progresso */}
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24,marginBottom:16}}>
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

          {/* Pesquisa */}
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24,marginBottom:16}}>
            <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>Pesquisar ação</h3>
            <div style={{display:"flex",gap:8}}>
              <input value={query} onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") addManual(); }}
                placeholder="Pesquisa por ticker (ex: AAPL) ou nome da empresa"
                disabled={picked.length>=PORTFOLIO_SIZE}
                style={{flex:1,background:"#0d1520",border:`1px solid ${query.length>=1?"#22c55e":"#1f2937"}`,
                  borderRadius:10,padding:"12px 16px",fontSize:14,color:"#e2e8f0",outline:"none",
                  boxSizing:"border-box",transition:"border-color 0.2s",
                  opacity:picked.length>=PORTFOLIO_SIZE?0.5:1}}/>
              <button onClick={addManual} disabled={picked.length>=PORTFOLIO_SIZE||!query.trim()}
                style={{background:"#1a2a1a",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,
                  padding:"0 16px",fontSize:13,color:"#4ade80",cursor:"pointer",fontWeight:600,
                  opacity:picked.length>=PORTFOLIO_SIZE||!query.trim()?0.5:1}}>
                Adicionar
              </button>
            </div>
            <p style={{marginTop:8,fontSize:12,color:"#4b5563"}}>
              Pesquisa sugerida via Yahoo Finance ou adiciona manualmente qualquer ticker válido.
            </p>

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
                        background:already?"#0d1a0d":"#0d1520",
                        border:`1px solid ${already?"#166534":"#1f2937"}`,
                        borderRadius:10,padding:"10px 14px",cursor:already?"default":"pointer",
                        transition:"border-color 0.15s",opacity:already?0.7:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
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

          {/* Portfolio */}
          {picked.length>0&&(
            <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24,marginBottom:16}}>
              <h3 style={{fontSize:15,fontWeight:600,marginBottom:14}}>O teu portefólio</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {picked.map(s=>(
                  <div key={s.ticker} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    background:"#0d1520",border:"1px solid #1f2937",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontWeight:800,fontSize:13,minWidth:56,color:"#e2e8f0"}}>{s.ticker}</span>
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

          {/* Submit */}
          <button onClick={submit}
            disabled={picked.length!==PORTFOLIO_SIZE||submitting||submClosed}
            style={{width:"100%",background:picked.length===PORTFOLIO_SIZE&&!submClosed?"#22c55e":"#1f2937",
              color:picked.length===PORTFOLIO_SIZE&&!submClosed?"#000":"#4b5563",
              border:"none",borderRadius:12,padding:"16px",fontSize:16,fontWeight:700,
              cursor:picked.length===PORTFOLIO_SIZE&&!submClosed?"pointer":"not-allowed",transition:"background 0.2s"}}>
            {submitting?"A submeter…":picked.length===PORTFOLIO_SIZE?"Submeter Portefólio":`Seleciona ${PORTFOLIO_SIZE-picked.length} mais ${PORTFOLIO_SIZE-picked.length===1?"ação":"açoões"}`}
          </button>
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
      <span style={{fontSize:14,fontWeight:active||done?600:400,color:active||done?"#e2e8f0":"#4b5563"}}>{label}</span>
    </div>
  );
}

/* ---- AlreadySubmitted ---------------------------------------------------- */
function AlreadySubmitted({nav,name}){
  return(
    <div style={{maxWidth:500,margin:"80px auto",padding:"0 20px",textAlign:"center"}}>
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Já tens um portefólio submetido</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:28}}>
          Submeteste como <strong style={{color:"#e2e8f0"}}>{name}</strong>. O portefólio fica bloqueado após a submissão — só um administrador o pode alterar.
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
  const [busy,setBusy]=useState(false);
  async function recover(){
    if(busy) return;
    setBusy(true);
    const r=await recoverByName(name);
    setBusy(false);
    if(r?.error) showToast(r.error,"error");
  }
  return(
    <div style={{maxWidth:480,margin:"80px auto",padding:"0 20px",textAlign:"center"}}>
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:20,padding:48}}>
        <div style={{fontSize:40,marginBottom:16}}>🔒</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Área bloqueada</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:28}}>
          Só podes ver o ranking e os portefólios dos outros membros depois de submeteres o teu próprio portefólio de 8 ações.
        </p>
        <Btn onClick={()=>nav("create")} primary>Criar o meu portefólio</Btn>

        <div style={{marginTop:32,paddingTop:24,borderTop:"1px solid #1f2937"}}>
          <p style={{fontSize:13,color:"#6b7280",marginBottom:12}}>
            Já submeteste o teu portefólio? Escreve o teu nome do Telegram para voltares a aceder.
          </p>
          <div style={{display:"flex",gap:8}}>
            <input value={name} onChange={e=>setName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") recover(); }}
              placeholder="O teu nome no Telegram"
              style={{flex:1,background:"#0d1520",border:"1px solid #1f2937",borderRadius:10,
                padding:"11px 14px",fontSize:14,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
            <button onClick={recover} disabled={busy||!name.trim()}
              style={{background:"#1a2a1a",border:"1px solid rgba(34,197,94,0.3)",borderRadius:10,
                padding:"11px 18px",fontSize:14,color:"#4ade80",fontWeight:700,
                cursor:busy||!name.trim()?"default":"pointer",opacity:busy||!name.trim()?0.5:1,whiteSpace:"nowrap"}}>
              {busy?"A verificar…":"Ver ranking"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Ranking ------------------------------------------------------------- */
function Ranking({ranking,myNorm,pricesLoading,onSelect}){
  const medals=["🥇","🥈","🥉"];
  return(
    <div style={{maxWidth:900,margin:"0 auto",padding:"40px 20px 80px"}}>
      <h1 style={{fontSize:28,fontWeight:800,letterSpacing:"-0.5px",marginBottom:4}}>Ranking Geral</h1>
      <p style={{color:"#4b5563",fontSize:14,marginBottom:28}}>
        Ordenado pela rentabilidade total em tempo real (preço atual vs. preço inicial). {ranking.length} {ranking.length===1?"participante":"participantes"}.
        {pricesLoading?" · A atualizar preços de mercado…":""}
      </p>

      {ranking.length===0?(
        <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
          Ainda não há portefólios submetidos.
        </div>
      ):(
        <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,overflow:"hidden"}}>
          {/* Header */}
          <div style={{display:"grid",gridTemplateColumns:"48px 1fr 110px 80px 80px 110px",
            padding:"10px 20px",borderBottom:"1px solid #1f2937",
            fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
            <span>#</span><span>Membro</span>
            <span style={{textAlign:"right"}}>Rentab.</span>
            <span style={{textAlign:"center"}}>Pos.</span>
            <span style={{textAlign:"center"}}>Neg.</span>
            <span style={{textAlign:"right"}}>Submissão</span>
          </div>
          {ranking.map((p,i)=>{
            const me=p.normName===myNorm;
            return(
              <div key={p.key} onClick={()=>onSelect(p.key)}
                style={{display:"grid",gridTemplateColumns:"48px 1fr 110px 80px 80px 110px",
                  padding:"14px 20px",borderBottom:"1px solid #0f172a",cursor:"pointer",
                  background:me?"rgba(34,197,94,0.04)":"transparent",
                  transition:"background 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background=me?"rgba(34,197,94,0.08)":"#0d1520"}
                onMouseLeave={e=>e.currentTarget.style.background=me?"rgba(34,197,94,0.04)":"transparent"}>
                <span style={{fontSize:16}}>{medals[i]||<span style={{fontSize:13,color:"#374151",fontWeight:700}}>{i+1}</span>}</span>
                <span style={{fontWeight:600,fontSize:15,display:"flex",alignItems:"center",gap:8}}>
                  {p.name}
                  {me&&<span style={{fontSize:10,background:"rgba(34,197,94,0.15)",color:"#4ade80",
                    borderRadius:999,padding:"2px 8px",fontWeight:700}}>Tu</span>}
                </span>
                <span style={{textAlign:"right",fontWeight:800,fontFamily:"monospace",fontSize:15,
                  color:p.total>=0?"#4ade80":"#f87171"}}>{pct(p.total)}</span>
                <span style={{textAlign:"center",color:"#4ade80",fontWeight:600,fontSize:14}}>{p.pos}</span>
                <span style={{textAlign:"center",color:"#f87171",fontWeight:600,fontSize:14}}>{p.neg}</span>
                <span style={{textAlign:"right",fontSize:12,color:"#4b5563"}}>{dt(p.submittedAt)}</span>
              </div>
            );
          })}
        </div>
      )}
      <p style={{marginTop:12,fontSize:12,color:"#1f2937",textAlign:"right"}}>Clica numa linha para ver as 8 ações.</p>
    </div>
  );
}

/* ---- Detail -------------------------------------------------------------- */
function Detail({pf,livePrices,nav}){
  if(!pf) return(
    <div style={{textAlign:"center",padding:80,color:"#4b5563"}}>
      Portefólio não encontrado. <button onClick={()=>nav("ranking")} style={{color:"#22c55e",background:"none",border:"none",cursor:"pointer"}}>Voltar</button>
    </div>
  );
  const st=pfStats(pf,livePrices);
  const rows=pf.stocks.map(s=>{
    const cur=curPrice(s.ticker,s.initialPrice,livePrices);
    return{...s,cur,ret:stockRet(s,livePrices)};
  });
  return(
    <div style={{maxWidth:820,margin:"0 auto",padding:"40px 20px 80px"}}>
      <button onClick={()=>nav("ranking")}
        style={{background:"none",border:"none",cursor:"pointer",color:"#6b7280",fontSize:14,marginBottom:24,
          display:"flex",alignItems:"center",gap:6,padding:0}}>
        ← Voltar ao ranking
      </button>

      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:28,marginBottom:16}}>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"flex-end",gap:16}}>
          <div>
            <h1 style={{fontSize:24,fontWeight:800,letterSpacing:"-0.5px",marginBottom:4}}>{pf.name}</h1>
            <p style={{fontSize:13,color:"#4b5563",margin:0}}>Submetido a {dt(pf.submittedAt)}</p>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:"#4b5563",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rentabilidade total</div>
            <div style={{fontSize:36,fontWeight:800,fontFamily:"monospace",
              color:st.total>=0?"#4ade80":"#f87171"}}>{pct(st.total)}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,marginTop:16,fontSize:13,color:"#6b7280"}}>
          <span>Valor inicial: <strong style={{color:"#e2e8f0"}}>{money(pf.initialValue||STARTING_VALUE)}</strong></span>
          <span style={{color:"#4ade80"}}>▲ {st.pos} positivas</span>
          <span style={{color:"#f87171"}}>▼ {st.neg} negativas</span>
        </div>
      </div>

      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",
          padding:"10px 20px",borderBottom:"1px solid #1f2937",
          fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
          <span>Ação</span>
          <span style={{textAlign:"right"}}>Preço inicial</span>
          <span style={{textAlign:"right"}}>Preço atual</span>
          <span style={{textAlign:"right"}}>Rentab.</span>
        </div>
        {rows.map(s=>(
          <div key={s.ticker} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",
            padding:"14px 20px",borderBottom:"1px solid #0f172a"}}>
            <div>
              <span style={{fontWeight:800,fontSize:14,color:"#e2e8f0",marginRight:8}}>{s.ticker}</span>
              <span style={{fontSize:13,color:"#6b7280"}}>{s.companyName}</span>
              <div style={{fontSize:11,color:"#374151",marginTop:2}}>{s.exchange} · 12,5%</div>
            </div>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:13,color:"#6b7280",alignSelf:"center"}}>{money(s.initialPrice)}</span>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:13,color:"#e2e8f0",alignSelf:"center"}}>{money(s.cur)}</span>
            <span style={{textAlign:"right",fontFamily:"monospace",fontSize:15,fontWeight:700,alignSelf:"center",
              color:s.ret>=0?"#4ade80":"#f87171"}}>
              {s.ret>=0?"▲":"▼"} {pct(Math.abs(s.ret)).replace(/[+-]/,"")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Admin --------------------------------------------------------------- */
function Admin({settings,setSettings,portfolios,ranking,livePrices,reload,showToast}){
  const [authed,setAuthed]=useState(false);
  const [pw,setPw]=useState("");
  const tryAuth=()=>pw===DEFAULT_ADMIN_PW?setAuthed(true):showToast("Palavra-passe incorreta.","error");

  if(!authed) return(
    <div style={{maxWidth:400,margin:"80px auto",padding:"0 20px"}}>
      <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:20,padding:40}}>
        <div style={{fontSize:32,marginBottom:16}}>🛡</div>
        <h1 style={{fontSize:22,fontWeight:700,marginBottom:8}}>Área de Administração</h1>
        <p style={{fontSize:14,color:"#6b7280",marginBottom:20}}>Introduz a palavra-passe de administrador.</p>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") tryAuth(); }}
          placeholder="Palavra-passe"
          style={{width:"100%",background:"#0d1520",border:"1px solid #1f2937",borderRadius:10,
            padding:"12px 16px",fontSize:15,color:"#e2e8f0",outline:"none",boxSizing:"border-box",marginBottom:12}}/>
        <button onClick={tryAuth}
          style={{width:"100%",background:"#22c55e",color:"#000",border:"none",borderRadius:10,
            padding:"13px",fontSize:15,fontWeight:700,cursor:"pointer"}}>Entrar</button>
      </div>
    </div>
  );
  return <AdminPanel {...{settings,setSettings,portfolios,ranking,livePrices,reload,showToast}}/>;
}

function AdminPanel({settings,setSettings,portfolios,ranking,livePrices,reload,showToast}){
  const [tab,setTab]=useState("portfolios");

  async function saveSt(next){
    setSettings(next);
    const ok=await saveGameSettings(next);
    showToast(ok?"Definições guardadas.":"Falha ao guardar — falta criar a tabela game_settings na Supabase.",ok?"ok":"error");
  }
  async function delPf(p){
    if(!confirm(`Eliminar o portefólio de "${p.name}"?`)) return;
    const { error:e1 }=await supabase.from("portfolio_stocks").delete().eq("portfolio_id",p.id);
    const { error:e2 }=await supabase.from("portfolios").delete().eq("id",p.id);
    if(e1||e2){ showToast("Não foi possível eliminar o portefólio.","error"); return; }
    if(p.userId) await supabase.from("users").update({has_submitted_portfolio:false}).eq("id",p.userId);
    await reload();
    showToast("Portefólio eliminado.");
  }

  function expSummary(){
    const rows=[["Posição","Nome","Rentabilidade %","Positivas","Negativas","Data submissão"]];
    ranking.forEach((p,i)=>rows.push([i+1,p.name,(p.total*100).toFixed(2),p.pos,p.neg,dt(p.submittedAt)]));
    dlCSV("ranking.csv",rows);
  }
  function expDetail(){
    const rows=[["Membro","Data","Ticker","Empresa","Preço inicial","Preço atual","Rentab. %"]];
    portfolios.forEach(p=>p.stocks.forEach(s=>{
      const cur=curPrice(s.ticker,s.initialPrice,livePrices);
      rows.push([p.name,dt(p.submittedAt),s.ticker,s.companyName,s.initialPrice,cur,((cur/s.initialPrice-1)*100).toFixed(2)]);
    }));
    dlCSV("detalhe.csv",rows);
  }

  const TABS=[["portfolios","👥 Portefólios"],["game","⚙️ Jogo"],["export","⬇️ Exportar"]];

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"40px 20px 80px"}}>
      <h1 style={{fontSize:26,fontWeight:800,marginBottom:24,letterSpacing:"-0.5px"}}>🛡 Administração</h1>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,background:"#0d1520",border:"1px solid #1f2937",borderRadius:12,padding:4,marginBottom:24,flexWrap:"wrap"}}>
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
        <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,overflow:"hidden"}}>
          {portfolios.length===0?(
            <p style={{padding:40,textAlign:"center",color:"#4b5563"}}>Sem portefólios ainda.</p>
          ):(
            <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 100px 120px 44px",
                padding:"10px 20px",borderBottom:"1px solid #1f2937",
                fontSize:11,color:"#4b5563",textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600}}>
                <span>Membro</span><span>Ações</span><span style={{textAlign:"right"}}>Rentab.</span>
                <span style={{textAlign:"right"}}>Data</span><span/>
              </div>
              {ranking.map(p=>(
                <div key={p.key} style={{display:"grid",gridTemplateColumns:"1fr 2fr 100px 120px 44px",
                  padding:"12px 20px",borderBottom:"1px solid #0f172a",alignItems:"center"}}>
                  <span style={{fontWeight:600,fontSize:14}}>{p.name}</span>
                  <span style={{fontSize:11,color:"#374151",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.stocks.map(s=>s.ticker).join(" · ")}
                  </span>
                  <span style={{textAlign:"right",fontFamily:"monospace",fontWeight:700,color:p.total>=0?"#4ade80":"#f87171"}}>
                    {pct(p.total)}
                  </span>
                  <span style={{textAlign:"right",fontSize:11,color:"#374151"}}>{dt(p.submittedAt)}</span>
                  <button onClick={()=>delPf(p)}
                    style={{background:"none",border:"none",cursor:"pointer",color:"#374151",padding:8,
                      borderRadius:6,fontSize:16}}
                    title="Eliminar"
                    onMouseEnter={e=>e.currentTarget.style.color="#ef4444"}
                    onMouseLeave={e=>e.currentTarget.style.color="#374151"}>
                    🗑
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
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
            <h3 style={{fontWeight:700,marginBottom:16}}>Submissões</h3>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0d1520",
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
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24}}>
            <h3 style={{fontWeight:700,marginBottom:16}}>Datas do jogo</h3>
            <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:4}}>Início</label>
            <input type="datetime-local" defaultValue={settings.gameStartDate}
              onBlur={e=>saveSt({...settings,gameStartDate:e.target.value})}
              style={{width:"100%",background:"#0d1520",border:"1px solid #1f2937",borderRadius:8,
                padding:"8px 12px",fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box",marginBottom:12}}/>
            <label style={{fontSize:12,color:"#4b5563",display:"block",marginBottom:4}}>Fim</label>
            <input type="datetime-local" defaultValue={settings.gameEndDate}
              onBlur={e=>saveSt({...settings,gameEndDate:e.target.value})}
              style={{width:"100%",background:"#0d1520",border:"1px solid #1f2937",borderRadius:8,
                padding:"8px 12px",fontSize:13,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:24,gridColumn:"1/-1"}}>
            <button onClick={reload}
              style={{background:"#0d1520",border:"1px solid #1f2937",borderRadius:10,padding:"10px 18px",
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
              style={{background:"#111827",border:"1px solid #1f2937",borderRadius:16,padding:28,
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
        transition:"all 0.15s"}}
      onMouseEnter={e=>{ if(primary) e.currentTarget.style.background="#16a34a"; else e.currentTarget.style.borderColor="#6b7280"; }}
      onMouseLeave={e=>{ if(primary) e.currentTarget.style.background="#22c55e"; else e.currentTarget.style.borderColor="#374151"; }}>
      {children}
    </button>
  );
}

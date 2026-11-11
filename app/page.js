"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { fetchStockPrices, fetchStockHistory } from "./lib/stocks";
import { supabase } from "./supabase";
import { DEFAULT_SETTINGS, K, PER_STOCK, WEEK_SEED_CHAMPS, compWeekKey, fetchAllBaselines, findBySlug, isPreLaunch, keyToId, loadGameSettings, mapPortfolioFromSupabase, monthCloseBase, monthTradingDone, norm, parseRoute, periodLabel, pfMonthRet, pfPeriodRet, pfStats, pfWeekRet, routeToPath, sget, slugify, sset, tkNorm, weekLabel, weekTradingDone } from "./lib/core";
import { Ranking, RankingSkeleton } from "./components/ranking";
import { Shell } from "./components/shell";
import { Home } from "./components/home";
import { AlreadySubmitted, Confirm, Create, LockedGate } from "./components/create";
import { ATH } from "./components/ath";
import { Duel } from "./components/duel";
import { Detail } from "./components/detail";
import { Admin } from "./components/admin";

export default function App(){
  const [page,setPage]=useState("home"); // home|create|confirm|ranking|detail|admin
  const [loading,setLoading]=useState(true);
  const [settings,setSettings]=useState(null);
  const [portfolios,setPortfolios]=useState([]);
  const [spyHist,setSpyHist]=useState(null);
  const [monthBase,setMonthBase]=useState({}); // {ticker:preço} baseline do mês atual (mini-época mensal)
  const [pastBaselines,setPastBaselines]=useState({}); // {period:{ticker:preço}} p/ campeões de meses fechados
  const [monthCloses,setMonthCloses]=useState({});     // {period:{ticker:fecho}} meses já fechados (close_price)
  const [rankPeriod,setRankPeriod]=useState("total"); // toggle Geral|Mensal|Semanal — elevado p/ o Shell trocar o fundo
  const [weekOpens,setWeekOpens]=useState({}); // {weekKey:{ticker:abertura}} todas as semanas
  // Semana em jogo (muda sozinha às 00:00 UTC de 2ª→… e à abertura do 1.º pregão): verifica a cada 20 s.
  const [compWk,setCompWk]=useState(()=>compWeekKey(new Date()));
  useEffect(()=>{ const id=setInterval(()=>setCompWk(k=>{ const n=compWeekKey(new Date()); return n===k?k:n; }),20000); return()=>clearInterval(id); },[]);
  const weekBase=useMemo(()=>weekOpens[compWk]||{},[weekOpens,compWk]); // {ticker:abertura} da semana em jogo (rentabilidade ao vivo)
  const [weekCloses,setWeekCloses]=useState({}); // {weekKey:{ticker:fecho}} semanas já fechadas (6ª ao fecho)
  const [myName,setMyName]=useState(null);
  const [hasSubmitted,setHasSubmitted]=useState(false);
  const [recentComments,setRecentComments]=useState([]); // últimos comentários em perfis de outros (cartão do rail)
  const detailFocusRef=useRef(null); // {commentId} — intenção de aterrar num comentário ao abrir um perfil
  const [livePrices,setLivePrices]=useState({});
  const [dayChange,setDayChange]=useState({}); // variação do dia por ticker
  const [priceStale,setPriceStale]=useState({}); // {ticker: ISO} tickers sem cotação há >4 dias (delistados) → aviso no portefólio
  const [pricesAsOf,setPricesAsOf]=useState(null); // quando foi gerada a cotação que está no ecrã (vem da própria resposta)
  const [marketClosed,setMarketClosed]=useState(false); // mercado US fechado → coluna/widgets mostram "Último dia" (último pregão)
  const [pricesLoading,setPricesLoading]=useState(false);
  const [detailSlug,setDetailSlug]=useState(null);
  const [duelSlugs,setDuelSlugs]=useState(null); // [slugA, slugB] para o duelo 1v1
  const [toast,setToast]=useState(null);
  const [rankHighlight,setRankHighlight]=useState(null); // key da linha a destacar ao VOLTAR de um detalhe
  const [adminPw,setAdminPw]=useState(""); // password de admin verificada (memória de sessão) → moderar comentários inline
  const rankHighlightRef=useRef(null); rankHighlightRef.current=rankHighlight;

  const showToast=useCallback((msg,kind="ok")=>{ setToast({msg,kind}); setTimeout(()=>setToast(null),3500); },[]);

  // Routing por caminho (URLs limpos, sem #); navegar empurra o caminho (back/forward funciona).
  const applyRoute=useCallback(()=>{
    const r=parseRoute();
    setPage(r.page);
    setDetailSlug(r.detailSlug??null);
    setDuelSlugs(r.duelSlugs??null);
  },[]);
  const goRoute=useCallback((r)=>{
    if(typeof window!=="undefined") window.history.pushState(null,"",routeToPath(r));
    applyRoute();
  },[applyRoute]);
  const slugForKey=useCallback((key)=>{ const pf=portfolios.find(p=>p.key===key); return pf?(slugify(pf.name)||keyToId(key)):keyToId(key); },[portfolios]);
  const nav=useCallback((p)=>{ setRankHighlight(null); goRoute({page:p}); },[goRoute]);
  // Ir DIRETO a um separador do Ranking (Geral/Mensal/Semanal) a partir do menu de topo.
  const navRank=useCallback((per)=>{ setRankHighlight(null); setRankPeriod(per); goRoute({page:"ranking"}); },[goRoute]);
  const openDetail=useCallback((k)=>{ setRankHighlight(null); goRoute({page:"detail",detailSlug:slugForKey(k)}); },[goRoute,slugForKey]);
  // Abrir o portefólio de um membro pelo seu user_id (ex.: clicar no autor de um comentário).
  const openMember=useCallback((userId)=>{ if(!userId) return; const pf=portfolios.find(p=>p.userId===userId); if(pf) openDetail(pf.key); },[portfolios,openDetail]);
  // Abrir o perfil-alvo de um comentário e aterrar na área de comentários (destacando-o).
  const openComments=useCallback((portfolioId,commentId)=>{ const pf=portfolios.find(p=>p.id===portfolioId); if(!pf) return; detailFocusRef.current={commentId}; openDetail(pf.key); },[portfolios,openDetail]);
  const openDuel=useCallback((a,b)=>goRoute({page:"duel",duelSlugs:[slugForKey(a),slugForKey(b)]}),[goRoute,slugForKey]);

  const refreshLivePrices=useCallback(async(pfs,opts)=>{
    const silent=!!(opts&&opts.silent);   // refetch de fundo (poll/voltar à aba): não pisca o loading
    // Inclui "SPY" para o benchmark (preço ao vivo do S&P 500 agora).
    const tickers=[...new Set([...(pfs||[]).flatMap(p=>p.stocks.map(s=>s.ticker)),"SPY"])];
    if(!tickers.length){ setLivePrices({}); setDayChange({}); return; }
    if(!silent) setPricesLoading(true);
    try{
      const { prices, changes, marketClosed:mc, asOf, stale }=await fetchStockPrices(tickers);
      if(asOf) setPricesAsOf(asOf);
      setPriceStale(stale||{});
      setLivePrices(prices);
      setDayChange(changes||{});
      setMarketClosed(!!mc);
    }catch(err){
      console.error(err);
    }finally{
      if(!silent) setPricesLoading(false);
    }
  },[]);

  const load=useCallback(async()=>{
    const mn=sget(K.MYNAME);
    setMyName(mn||null);

    // Definições do jogo, portefólios (com joins) e "já submeteu?" são 3 pedidos INDEPENDENTES —
    // antes corriam em série (cada um à espera do anterior), somando 3 round-trips à demora do
    // "A carregar…" antes de a tabela aparecer. Em paralelo, a demora passa a ser a do mais lento, não a soma.
    const submittedQ=mn?.trim()
      ? supabase.from("users").select("has_submitted_portfolio").eq("telegram_name_lower", mn.trim().toLowerCase()).maybeSingle()
      : Promise.resolve({ data:null, error:null });
    const [gs, { data: portfolioRows, error: pfError }, { data: userRow, error: userError }]=await Promise.all([
      loadGameSettings(),
      supabase
        .from("portfolios")
        .select(`
          id,
          user_id,
          created_at,
          locked,
          initial_value,
          spy_initial_price,
          official,
          users!portfolios_user_id_fkey (
            telegram_name,
            has_submitted_portfolio
          ),
          portfolio_stocks (
            ticker,
            company_name,
            initial_price,
            current_price,
            initial_weight,
            side,
            currency
          )
        `),
      submittedQ,
    ]);
    setSettings(gs||DEFAULT_SETTINGS);
    setHasSubmitted(!userError&&userRow?userRow.has_submitted_portfolio===true:false);
    if(pfError){
      console.error(pfError);
      setPortfolios([]);
      setLivePrices({});
      setDayChange({});
    }else{
      const pfs=(portfolioRows||[])
        .filter(row=>row.users?.has_submitted_portfolio)
        .map(mapPortfolioFromSupabase);
      // Pré-lançamento: as ações dos oficiais estão ocultas ao anon (privacidade).
      // Buscar as TUAS próprias (nome + código) para o teu detalhe funcionar.
      if(isPreLaunch(gs)&&mn?.trim()){
        const myPin=sget(K.MYPIN);
        if(myPin){
          try{
            const r=await fetch("/api/portfolio/mine",{method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({name:mn.trim(),pin:String(myPin)})});
            const d=await r.json();
            if(d?.ok&&Array.isArray(d.stocks)&&d.stocks.length){
              const mine=d.stocks.map(s=>({ticker:s.ticker,companyName:s.company_name,exchange:"",
                side:s.side==="short"?"short":"long",initialPrice:Number(s.initial_price),
                initialWeight:Number(s.initial_weight)/100,currency:s.currency||"USD",allocated:PER_STOCK}));
              const i=pfs.findIndex(p=>p.normName===norm(mn.trim()));
              if(i>=0) pfs[i]={...pfs[i],stocks:mine};
            }
          }catch{}
        }
      }
      setPortfolios(pfs);
      await refreshLivePrices(pfs);
    }

    // S&P 500 benchmark history (cached server-side). Non-blocking failure: if
    // unavailable, the benchmark simply doesn't render.
    fetchStockHistory("SPY").then(h=>setSpyHist(h&&h.length?h:null)).catch(()=>{});

    // Baselines mensais (mini-época "Campeão do mês"): abertura (price) + fecho (close_price). Falha em silêncio.
    fetchAllBaselines("monthly_baselines").then((data)=>{
      const period=new Date().toISOString().slice(0,7); // 'YYYY-MM' (UTC)
      const cur={}, past={}, closes={};
      (data||[]).forEach(r=>{ const price=Number(r.price); const c=r.close_price==null?null:Number(r.close_price);
        if(price>0){ (past[r.period]=past[r.period]||{})[r.ticker]=price; if(r.period===period) cur[r.ticker]=price; }
        if(c>0){ (closes[r.period]=closes[r.period]||{})[r.ticker]=c; } });
      setMonthBase(cur); setPastBaselines(past); setMonthCloses(closes);
    }).catch(()=>{});

    // Baselines semanais (mini-época "Vencedor da Semana"): abertura (2ª) + fecho (6ª). Falha em silêncio.
    fetchAllBaselines("weekly_baselines").then((data)=>{
      const cur={}, opens={}, closes={};
      (data||[]).forEach(r=>{ const o=Number(r.price); const c=r.close_price==null?null:Number(r.close_price);
        if(o>0){ (opens[r.period]=opens[r.period]||{})[r.ticker]=o; }
        if(c>0){ (closes[r.period]=closes[r.period]||{})[r.ticker]=c; } });
      setWeekOpens(opens); setWeekCloses(closes);
    }).catch(()=>{});

    setLoading(false);
  },[refreshLivePrices]);

  useEffect(()=>{ load(); },[load]);
  // Frescura contínua sem sobrecarregar: enquanto a página está VISÍVEL re-busca as cotações a cada 5 min
  // (silencioso, sem piscar o loading); e ao VOLTAR ao separador re-busca logo → mata as abas paradas com
  // dados de ontem. O backend atualiza as posições dos membros ~10/10 min, por isso um poll de 5 min apanha-as
  // depressa. Só lê o endpoint (serve do sp500_ath, DB) → praticamente sem carga na API de cotações (Yahoo).
  const portfoliosRef=useRef(portfolios); portfoliosRef.current=portfolios;
  useEffect(()=>{
    const refetch=()=>{ if(typeof document!=="undefined"&&document.visibilityState==="visible"&&portfoliosRef.current.length) refreshLivePrices(portfoliosRef.current,{silent:true}); };
    const iv=setInterval(refetch,marketClosed?5*60*1000:2*60*1000); // sessão aberta: 2 min (alinhado com o backend, que escreve de ~2 em 2 min); fechada: 5 min
    document.addEventListener("visibilitychange",refetch);
    return ()=>{ clearInterval(iv); document.removeEventListener("visibilitychange",refetch); };
  },[refreshLivePrices,marketClosed]);
  // Últimos comentários (cartão do rail do Ranking) — 1× no load (política "refresca no load").
  useEffect(()=>{ (async()=>{ try{ const r=await fetch("/api/comments/recent"); const j=await r.json(); if(Array.isArray(j?.comments)) setRecentComments(j.comments); }catch{} })(); },[]);
  // Ao mudar de ecrã (ou de portefólio aberto), começa no topo do scroll.
  // Scroll para o topo ao mudar de página — EXCETO ao voltar ao ranking com uma linha a destacar
  // (nesse caso o Ranking faz scroll para essa linha).
  useEffect(()=>{ if(typeof window!=="undefined" && !(page==="ranking"&&rankHighlightRef.current)) window.scrollTo(0,0); },[page,detailSlug,duelSlugs]);

  // Routing por caminho: aplica a rota no arranque e em back/forward.
  // Inclui a entrada de admin (/admin) e os links partilháveis (/p/<slug>, /duel/<a>~<b>).
  useEffect(()=>{
    // Migra links antigos com hash (/#p/...) para caminho limpo, sem recarregar.
    if(typeof window!=="undefined" && window.location.hash){
      window.history.replaceState(null,"",routeToPath(parseRoute()));
    }
    applyRoute();
    window.addEventListener("popstate",applyRoute);
    return()=>{ window.removeEventListener("popstate",applyRoute); };
  },[applyRoute]);

  const myPf=useMemo(()=>{
    if(!myName) return null;
    const n=norm(myName);
    return portfolios.find(p=>p.normName===n)||null;
  },[myName,portfolios]);
  const openMyPortfolio=useCallback(()=>{ if(myPf?.key) openDetail(myPf.key); else nav("detail"); },[myPf,openDetail,nav]);
  // Navegação a partir de uma notificação (token guardado em notifications.link).
  const handleNotifLink=useCallback((link)=>{
    if(!link) return;
    if(link==="mine") openMyPortfolio();
    else if(link==="ranking") navRank("total");
    else if(link==="ranking-week") navRank("week");
    else if(link==="ranking-month") navRank("month");
    else if(link==="ath") nav("ath");
    else if(link==="updates"){ nav("home"); setTimeout(()=>{ const el=document.getElementById("updates-feedbacks"); if(el) el.scrollIntoView({behavior:"smooth",block:"start"}); },400); }
    else if(link.startsWith("p:")){ const id=link.slice(2); const pf=portfolios.find(p=>p.id===id); if(pf) openDetail(pf.key); }
  },[openMyPortfolio,navRank,nav,openDetail,portfolios]);

  const submitted=hasSubmitted;

  const ranking=useMemo(()=>
    portfolios.map(p=>({...p,...pfStats(p,livePrices)}))
      .sort((a,b)=>(Number.isFinite(b.total)?b.total:-Infinity)-(Number.isFinite(a.total)?a.total:-Infinity))
  ,[portfolios,livePrices]);
  // Vencedores das mini-épocas JÁ FECHADAS (mês/semana) → badge na página de portefólio do vencedor.
  const winners=useMemo(()=>{
    const map={}; const add=(key,kind,label)=>{ (map[key]=map[key]||{monthly:[],weekly:[]})[kind].push(label); };
    const offs=ranking.filter(p=>p.official);
    // Mensal: medalha quando o mês tem fecho FROZEN (monthCloseBase != null) — abertura do mês seguinte OU,
    // se o mês acabou à 6ª/fim de semana, o fecho semanal dessa semana. Inclui o mês ATUAL assim que o seu
    // pregão termina (simétrico ao semanal, que premeia a semana atual quando fecha). Vencedor = melhor open→close.
    const curM=new Date().toISOString().slice(0,7);
    const monthDone=monthTradingDone(new Date());
    for(const per of Object.keys(pastBaselines).sort()){ if(per>curM) continue; // meses futuros nunca
      if(per===curM && !monthDone) continue; // mês ATUAL só é apurado depois do fecho US do último dia útil
      const from=pastBaselines[per], to=monthCloseBase(per,pastBaselines,weekCloses,monthCloses); if(!from||!to) continue;
      let best=null; for(const p of offs){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best) add(best.p.key,"monthly",periodLabel(per)); }
    // Mês ATUAL, LOGO AO FECHO do último dia útil: entre o fecho US (16:00 ET) e a gravação do close_price
    // pelo monthly-close (22:00 UTC), o campeão já está apurado mas ainda não há fecho gravado. Apura-o
    // pelas cotações de fecho AO VIVO (== fecho oficial nesse momento) → o troféu surge imediatamente.
    if(monthDone && monthBase && Object.keys(monthBase).length && !monthCloseBase(curM,pastBaselines,weekCloses,monthCloses)){
      let best=null; for(const p of offs){ const r=pfMonthRet(p,monthBase,livePrices); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best) add(best.p.key,"monthly",periodLabel(curM)); }
    // Semanal: medalha logo que a semana FECHA (não só na 2ª feira seguinte). Semana fechada = tem
    // fecho de 6ª (weekCloses, gravado pela weekly-close das 22:00 UTC). A semana ATUAL conta assim que
    // o pregão terminou (weekTradingDone: 6ª pós-fecho ou fim de semana) E o fecho está gravado ('to').
    const now=new Date(); const curW=compWeekKey(now); const weekDone=weekTradingDone(now); const seen=new Set();
    for(const per of Object.keys(weekCloses).sort()){
      if(per>curW) continue;                    // semanas futuras: nunca
      if(per===curW && !weekDone) continue;      // semana atual: só depois de fechada
      const from=weekOpens[per], to=weekCloses[per]; if(!from||!to) continue; // 'to'=fecho: só existe após weekly-close
      let best=null; for(const p of offs){ const r=pfPeriodRet(p,from,to); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best){ add(best.p.key,"weekly",weekLabel(per)); seen.add(per); } }
    // Semana ATUAL, LOGO AO FECHO de 6ª: entre o fecho US (16:00 ET) e a gravação do close_price pela
    // weekly-close (22:00 UTC), o vencedor já está apurado mas ainda não há 'weekCloses[curW]'. Apura-o
    // pelas cotações de fecho AO VIVO (== fecho oficial nesse momento) → o troféu surge imediatamente.
    if(weekDone && !seen.has(curW) && !weekCloses[curW]){
      let best=null; for(const p of offs){ const r=pfWeekRet(p,weekBase,livePrices); if(r!=null&&(!best||r>best.r)) best={p,r}; }
      if(best){ add(best.p.key,"weekly",weekLabel(curW)); seen.add(curW); } }
    for(const seed of WEEK_SEED_CHAMPS){ if(seen.has(seed.period)) continue;
      const p=offs.find(x=>x.normName===norm(seed.name)); if(p) add(p.key,"weekly",weekLabel(seed.period)); }
    return map;
  },[ranking,pastBaselines,weekOpens,weekCloses,monthCloses,weekBase,monthBase,livePrices]);
  // Popularidade por ação na competição (liga a aba ATH ao jogo): quantos oficiais têm cada ticker.
  const compStats=useMemo(()=>{
    const off=ranking.filter(p=>p.official); const counts={};
    for(const p of off) for(const s of (p.stocks||[])){ const k=tkNorm(s.ticker); if(k) counts[k]=(counts[k]||0)+1; }
    return { counts, members:off.length, tickers:Object.keys(counts) };
  },[ranking]);

  // S&P 500 benchmark — alinhado no tempo: "se tivesses metido no SPY em vez das
  // 8 ações, no mesmo período". Usa o preço do SPY AGORA (ao vivo) vs o preço do
  // SPY NO MOMENTO da submissão (guardado em spy_initial_price). Para portefólios
  // antigos sem esse valor, recorre ao histórico (fecho na data de submissão).
  const spy=useMemo(()=>{
    const now=(livePrices&&typeof livePrices.SPY==="number")?livePrices.SPY:null;
    if(now==null) return null;
    const closeOnOrBefore=iso=>{
      if(!spyHist||!spyHist.length) return null;
      const d=(iso||"").slice(0,10);
      let v=null;
      for(const p of spyHist){ if(p.date<=d) v=p.close; else break; }
      return v??spyHist[0].close;
    };
    // Fecho ESTRITAMENTE ANTES da data — a âncora dos baselines semanal/mensal dos membros
    // (fecho de 6ª anterior / fecho do mês anterior). O priceAt (<=) incluiria o fecho do
    // PRÓPRIO dia de arranque, descolando o S&P da âncora usada nas ações.
    const closeBefore=iso=>{
      if(!spyHist||!spyHist.length) return null;
      const d=(iso||"").slice(0,10);
      let v=null;
      for(const p of spyHist){ if(p.date<d) v=p.close; else break; }
      return v;
    };
    const returnFor=pf=>{
      const base=(pf&&typeof pf.spyInitialPrice==="number"&&pf.spyInitialPrice>0)
        ? pf.spyInitialPrice
        : closeOnOrBefore(pf?.submittedAt);
      if(base==null||!base) return null;
      return now/base-1;
    };
    return { now, returnFor, priceAt: closeOnOrBefore, closeBefore };
  },[livePrices,spyHist]);

  async function doSubmit(name,stocks,pin){
    // All validation + the authoritative price snapshot happen server-side
    // (/api/portfolio/submit) using the service_role key — the browser never
    // writes to the database directly, so initial_price can't be forged.
    const trimmedName=name.trim();
    if(!trimmedName) return{error:"Escreve o teu nome."};
    if(!/^\d{3}$/.test(String(pin||""))) return{error:"Escolhe um código de 3 dígitos (só números)."};
    let res,data;
    try{
      res=await fetch("/api/portfolio/submit",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name:trimmedName, pin:String(pin), stocks:stocks.map(s=>({ticker:s.ticker,name:s.name,side:s.side==="short"?"short":"long"})) }),
      });
      data=await res.json();
    }catch{
      return{error:"Falha de ligação. Tenta novamente."};
    }
    if(!res.ok||!data?.ok) return{error:data?.error||"Não foi possível submeter o portefólio."};

    sset(K.MYNAME, trimmedName);
    sset(K.MYPIN, String(pin)); // teu próprio código, no teu dispositivo (para veres o teu portefólio no pré-lançamento)
    setMyName(trimmedName);
    await load();
    setHasSubmitted(true);
    nav("ranking");
    return{ok:true};
  }

  // Returning member (closed window / outro dispositivo): re-identifica por nome
  // + código de 3 dígitos (anti-impersonação), validado no servidor.
  async function recoverByName(rawName,pin){
    const name=(rawName||"").trim();
    if(!name) return{error:"Escreve o teu nome."};
    if(!/^\d{3}$/.test(String(pin||""))) return{error:"Escreve o teu código de 3 dígitos."};
    let res,data;
    try{
      res=await fetch("/api/portfolio/recover",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ name, pin:String(pin) }),
      });
      data=await res.json();
    }catch{ return{error:"Falha de ligação. Tenta novamente."}; }
    if(!res.ok||!data?.ok) return{error:data?.error||"Não foi possível verificar o nome/código."};
    sset(K.MYNAME, data.name||name);
    sset(K.MYPIN, String(pin));
    setMyName(data.name||name);
    await load(); // recarrega já com o código guardado → junta as tuas ações (sem 2º pedido)
    setHasSubmitted(true);
    nav("ranking");
    return{ok:true};
  }

  // detailPf + "Nos 3 jogos" ANTES do guard de loading (o useMemo é um HOOK → tem de correr sempre,
  // na mesma ordem; se ficasse depois do return, era saltado quando loading=true → Rules of Hooks).
  const detailPf=findBySlug(portfolios,detailSlug)||myPf;
  const detailStandings=useMemo(()=>{
    if(!detailPf||!detailPf.official) return null;
    const offs=ranking.filter(p=>p.official);
    const rankBy=(metric)=>{ const s=offs.map(p=>({p,m:metric(p)})).filter(x=>Number.isFinite(x.m)).sort((a,b)=>b.m-a.m);
      const i=s.findIndex(x=>x.p.key===detailPf.key); return i>=0?{rank:i+1,n:s.length,ret:s[i].m}:null; };
    const hasMonth=!!(monthBase&&Object.keys(monthBase).length);
    const hasWeek=!!(weekBase&&Object.keys(weekBase).length);
    // Semana fechada → posição semanal pelo resultado OFICIAL congelado (open→close), como a lista/vencedor.
    const curWk=compWeekKey(new Date());
    const wkFrozen=(weekTradingDone(new Date())&&weekOpens&&weekOpens[curWk]&&weekCloses&&weekCloses[curWk])?{from:weekOpens[curWk],to:weekCloses[curWk]}:null;
    const monthLabel=(()=>{ const n=new Date().toLocaleDateString("pt-PT",{month:"long"}); return n.charAt(0).toUpperCase()+n.slice(1); })();
    return {
      geral: rankBy(p=>p.total),
      mensal: hasMonth?rankBy(p=>pfMonthRet(p,monthBase,livePrices)):null,
      semanal: wkFrozen?rankBy(p=>pfPeriodRet(p,wkFrozen.from,wkFrozen.to)):(hasWeek?rankBy(p=>pfWeekRet(p,weekBase,livePrices)):null),
      monthLabel, weeklyWins:(winners?.[detailPf.key]?.weekly)||[],
    };
  },[detailPf,ranking,monthBase,weekBase,livePrices,winners,weekOpens,weekCloses]);

  if(loading&&page==="ranking") return <RankingSkeleton/>;
  if(loading) return(
    <div style={{minHeight:"100vh",
      background:"radial-gradient(1800px 1100px at 50% -8%, rgba(37,99,235,0.28) 0%, rgba(37,99,235,0.10) 38%, transparent 72%), linear-gradient(180deg,#0c1a36 0%,#0a1428 55%,#080f20 80%,#070d1c 100%)",
      backgroundAttachment:"fixed",
      display:"flex",alignItems:"center",justifyContent:"center",color:"#4b5563",fontFamily:"var(--font-app), system-ui, sans-serif"}}>
      <style>{`@keyframes cdiPulse{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style>
      <img src="/logo.png" alt="A carregar…"
        style={{width:"clamp(96px,16vw,140px)",height:"auto",animation:"cdiPulse 1.4s ease-in-out infinite"}}/>
    </div>
  );

  // Lugar (rank) do portefólio em detalhe — ao vivo, dentro do grupo (demo/oficial).
  // 0 = sem classificação ("em espera"). Usado para o tema da página e pelo <Detail>.
  const detailRank=(()=>{
    if(!detailPf) return 0;
    if(detailPf.official&&isPreLaunch(settings)) return 0;
    const group=ranking.filter(r=>r.official===detailPf.official);
    const i=group.findIndex(r=>r.key===detailPf.key);
    return i>=0?i+1:0;
  })();
  const detailIsOwn=detailPf?detailPf.normName===norm(myName):false;
  // Cor do hover das linhas de ação, a condizer com o tema da página (JS = ganha sempre).
  const rowHover=detailRank===1?"#1d1407":detailRank===2?"#12151c":detailRank===3?"#1a0f06":"#0a1120";

  const sh=(children)=><Shell page={page} rankPeriod={rankPeriod} detailRank={detailRank} detailIsOwn={detailIsOwn} nav={nav} navRank={navRank} submitted={submitted} toast={toast}
    myName={myName} adminPw={adminPw} showToast={showToast}
    onNotifLink={handleNotifLink}
    onMyPortfolio={openMyPortfolio}
    myPortfolioActive={page==="detail" && !!detailPf && !!myPf && detailPf.key===myPf.key}>{children}</Shell>;

  if(page==="home")   return sh(<Home nav={nav} navRank={navRank} submitted={submitted} settings={settings} ranking={ranking} livePrices={livePrices} onMyPortfolio={openMyPortfolio} myName={myName}/>);
  if(page==="create") return sh(submitted?<AlreadySubmitted nav={nav} name={myName}/>:<Create settings={settings} doSubmit={doSubmit} onDone={()=>nav("ranking")} showToast={showToast}/>);
  if(page==="confirm")return sh(<Confirm nav={nav} name={myName}/>);
  if(page==="ath")    return sh(<ATH myTickers={submitted&&myPf?(myPf.stocks||[]).map(s=>s.ticker):null} auth={submitted&&myName?{name:myName,pin:sget(K.MYPIN)}:null} pickCounts={compStats.counts} compTickers={compStats.tickers} showToast={showToast}/>);
  if(page==="ranking")return sh(<Ranking ranking={ranking} myNorm={norm(myName)} pricesLoading={pricesLoading} pricesAsOf={pricesAsOf} spy={spy} dayChange={dayChange} marketClosed={marketClosed} livePrices={livePrices} preLaunch={isPreLaunch(settings)} settings={settings} monthBase={monthBase} pastBaselines={pastBaselines} monthCloses={monthCloses} weekBase={weekBase} weekOpens={weekOpens} weekCloses={weekCloses} period={rankPeriod} setPeriod={setRankPeriod} onSelect={openDetail} onCompare={openDuel} highlightKey={rankHighlight} clearHighlight={()=>setRankHighlight(null)} winners={winners} showToast={showToast} recentComments={recentComments.filter(c=>portfolios.some(p=>p.id===c.portfolioId))} openComments={openComments}/>);
  if(page==="duel")   return sh(submitted?<Duel a={findBySlug(ranking,duelSlugs?.[0])} b={findBySlug(ranking,duelSlugs?.[1])} livePrices={livePrices} spy={spy} dayChange={dayChange} nav={nav}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="detail") return sh(submitted?<Detail pf={detailPf} rank={detailRank} rowHover={rowHover} livePrices={livePrices} priceStale={priceStale} dayChange={dayChange} marketClosed={marketClosed} spy={spy} nav={nav} onBack={()=>{ setRankHighlight(detailPf?.key||null); goRoute({page:"ranking"}); }} myNorm={norm(myName)} myUserId={myPf?.userId||null} adminPw={adminPw} preLaunch={isPreLaunch(settings)} competitionStarted={settings?.competitionStarted===true} gameStartDate={settings?.gameStartDate||""} winners={winners} standings={detailStandings} monthBase={monthBase} weekBase={weekBase} reload={load} showToast={showToast} onOpenMember={openMember} focusRef={detailFocusRef}/>:<LockedGate nav={nav} recoverByName={recoverByName} showToast={showToast}/>);
  if(page==="admin")  return sh(<Admin settings={settings} setSettings={setSettings} portfolios={portfolios} ranking={ranking} livePrices={livePrices} reload={load} showToast={showToast} adminPw={adminPw} setAdminPw={setAdminPw}/>);
  return null;
}

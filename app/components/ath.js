// Módulo "ath" (extraído de app/page.js — sem alterações de comportamento).

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import { isCrypto, cryptoNameFor, searchCryptos } from "../lib/crypto";
import { fetchStockInfo, searchTickers } from "../lib/stocks";
import { searchPopular } from "../lib/popular";
import { curForTicker, curSym, fmtCap, fmtMoneyC, norm, sget, sinceLabel, sinceLabelShort, sset, tkNorm } from "../lib/core";
import { Skeleton, StockLogo } from "./ui";

// matching de tickers (BRK.B↔BRK-B)
export function ATH({myTickers,auth,showToast,pickCounts,compTickers}){
  const authed=!!(auth&&auth.name&&auth.pin);
  const [rows,setRows]=useState(null);
  const [activeFilter,setActiveFilter]=useState(null); // null | "mine" | listId (watchlist)
  const wlKey=auth?.name?("ci_wl:"+String(auth.name).toLowerCase()):null; // cache local das watchlists
  const [lists,setLists]=useState(()=>{ try{ const c=wlKey?sget(wlKey):null; return Array.isArray(c)?c:[]; }catch{ return []; } }); // watchlists do user: [{id,name,tickers[]}] — arranca do cache p/ aparecer logo
  const [addFor,setAddFor]=useState(null);              // ticker a adicionar a listas (abre modal)
  const [addSel,setAddSel]=useState(()=>new Set());     // listas selecionadas no modal "Adicionar"
  const [menuFor,setMenuFor]=useState(null);            // lista com menu renomear/apagar aberto (hover/long-press)
  const [draftName,setDraftName]=useState(null);        // criação inline: input no lugar da pill (null = sem rascunho)
  const [globalRes,setGlobalRes]=useState([]);          // resultados globais (fora do S&P) p/ adicionar
  const [gLoading,setGLoading]=useState(false);
  const lpTimer=useRef(null), lpFired=useRef(false), canHover=useRef(false), draftCancel=useRef(false);
  const [nameModal,setNameModal]=useState(null);        // criar/renomear: {mode,id?,ticker?,value}
  const [liteQuotes,setLiteQuotes]=useState({});        // tickers fora do S&P: {tkNorm:{name,price}}
  const [q,setQ]=useState("");
  const [sortKey,setSortKey]=useState("marketcap"); // marketcap | down | since
  const [sortDir,setSortDir]=useState("desc"); // asc | desc — clicar na coluna alterna
  const onSort=(k)=>{ if(k===sortKey) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir(k==="down"?"asc":"desc"); } };
  const [updatedAt,setUpdatedAt]=useState(null);
  const [limit,setLimit]=useState(100); // render só N de cada vez (perf); a procura vê as 500
  const [refreshing,setRefreshing]=useState(false);
  const mountedRef=useRef(true);
  useEffect(()=>{ mountedRef.current=true; return ()=>{ mountedRef.current=false; }; },[]);
  // Re-lê a tabela sp500_ath (o que o cron já escreveu). É uma leitura barata ao Supabase —
  // NÃO mexe na API de cotações dos portefólios. Mantém os dados visíveis e só roda o ícone.
  const load=useCallback(async()=>{
    setRefreshing(true);
    try{
      const { data }=await supabase.from("sp500_ath")
        .select("symbol,name,price,marketcap,ath,ath_ts,updated_at,in_sp500");
      if(!mountedRef.current) return;
      const list=(data||[]).map(r=>{
        const price=Number(r.price), ath=Number(r.ath);
        return { symbol:r.symbol, name:r.name||r.symbol, price, ath, marketcap:Number(r.marketcap),
          ath_ts:r.ath_ts, in_sp500:r.in_sp500!==false,
          down:(Number.isFinite(price)&&Number.isFinite(ath)&&ath>0)?(price/ath-1):null };
      });
      setRows(list);
      setUpdatedAt((data||[]).reduce((m,r)=>{ const t=new Date(r.updated_at||0).getTime(); return t>m?t:m; },0)||null);
    } finally { if(mountedRef.current) setRefreshing(false); }
  },[]);
  useEffect(()=>{ load(); },[load]);
  // ---- Watchlists (sincronizadas na conta) ----
  useEffect(()=>{
    if(!authed){ setLists([]); return; }
    try{ const c=wlKey?sget(wlKey):null; if(Array.isArray(c)&&c.length) setLists(c); }catch{} // mostra o cache já, sem esperar pelo servidor
    let cancel=false;
    (async()=>{
      try{
        const r=await fetch("/api/watchlists/list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin})});
        const d=await r.json(); if(cancel) return;
        if(!d?.ok) return;
        if((d.lists||[]).length===0){
          // Garante uma lista por defeito "Watch list" (vazia) para o user.
          try{
            const cr=await fetch("/api/watchlists/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,listName:"Watch list",tickers:[]})});
            const cd=await cr.json(); if(!cancel) setLists(cr.ok&&cd?.ok&&cd.list?[cd.list]:[]);
          }catch{ if(!cancel) setLists([]); }
        } else setLists(d.lists);
      }catch{}
    })();
    return()=>{ cancel=true; };
  },[authed,auth?.name,auth?.pin]);
  useEffect(()=>{ if(wlKey) sset(wlKey,lists); },[lists,wlKey]); // cache local sempre atualizado
  const apiSave=useCallback(async(payload)=>{
    const r=await fetch("/api/watchlists/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,...payload})});
    const d=await r.json(); if(!r.ok||!d?.ok) throw new Error(d?.error||"Não foi possível guardar."); return d.list;
  },[auth]);
  const createList=useCallback(async(nm,ticker)=>{
    try{ const saved=await apiSave({listName:nm,tickers:ticker?[String(ticker).toUpperCase()]:[]}); setLists(ls=>[...ls,saved]); showToast&&showToast("Lista criada"); return saved; }
    catch(e){ showToast&&showToast(e.message,"error"); return null; }
  },[apiSave,showToast]);
  const renameList=useCallback(async(id,nm)=>{
    const l=lists.find(x=>x.id===id); if(!l) return; const prev=l.name;
    setLists(ls=>ls.map(x=>x.id===id?{...x,name:nm}:x));
    try{ await apiSave({id,listName:nm,tickers:l.tickers}); }
    catch(e){ setLists(ls=>ls.map(x=>x.id===id?{...x,name:prev}:x)); showToast&&showToast(e.message,"error"); }
  },[lists,apiSave,showToast]);
  const deleteList=useCallback(async(id)=>{
    const prev=lists; setLists(ls=>ls.filter(x=>x.id!==id)); setActiveFilter(f=>f===id?null:f);
    try{ const r=await fetch("/api/watchlists/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:auth.name,pin:auth.pin,id})}); const d=await r.json(); if(!r.ok||!d?.ok) throw new Error(d?.error||"Erro"); }
    catch(e){ setLists(prev); showToast&&showToast(e.message,"error"); }
  },[lists,auth,showToast]);
  const toggleTicker=useCallback(async(id,ticker)=>{
    const l=lists.find(x=>x.id===id); if(!l) return;
    const t=tkNorm(ticker), has=l.tickers.some(x=>tkNorm(x)===t);
    const next=has?l.tickers.filter(x=>tkNorm(x)!==t):[...l.tickers,String(ticker).toUpperCase()];
    setLists(ls=>ls.map(x=>x.id===id?{...x,tickers:next}:x));
    showToast&&showToast(`${String(ticker).toUpperCase()} ${has?"removida de":"adicionada a"} ${l.name}`);
    try{ await apiSave({id,listName:l.name,tickers:next}); }
    catch(e){ setLists(ls=>ls.map(x=>x.id===id?{...x,tickers:l.tickers}:x)); showToast&&showToast(e.message,"error"); }
  },[lists,apiSave,showToast]);
  const confirmName=useCallback(async()=>{
    const m=nameModal; if(!m) return; const nm=(m.value||"").trim(); if(!nm) return;
    if(m.mode==="rename"){ await renameList(m.id,nm); }
    else { await createList(nm, m.mode==="create-add"?m.ticker:null); }
    setNameModal(null);
  },[nameModal,renameList,createList]);
  const openAdd=useCallback((ticker)=>{
    const t=tkNorm(ticker);
    setAddSel(new Set(lists.filter(l=>l.tickers.some(x=>tkNorm(x)===t)).map(l=>l.id)));
    setAddFor(ticker);
  },[lists]);
  const applyAdd=useCallback(async()=>{
    const t=addFor; if(!t) return;
    const tasks=[];
    lists.forEach(l=>{ const has=l.tickers.some(x=>tkNorm(x)===tkNorm(t)); const sel=addSel.has(l.id); if(sel!==has) tasks.push(toggleTicker(l.id,t)); });
    const firstSel=[...addSel][0];
    setAddFor(null); setQ(""); setGlobalRes([]); // limpa a pesquisa depois de guardar
    if(firstSel) setActiveFilter(firstSel); // passa para a playlist onde guardou (fica selecionada)
    await Promise.all(tasks);
  },[addFor,addSel,lists,toggleTicker]);
  const activeList=useMemo(()=>activeFilter&&activeFilter!=="mine"?lists.find(l=>l.id===activeFilter)||null:null,[activeFilter,lists]);
  const filterTickers=useMemo(()=>{
    if(activeFilter==="mine") return myTickers||[];
    if(activeFilter==="comp") return compTickers||[];   // só as ações da competição
    if(activeList) return (activeList.tickers||[]).filter(t=>!String(t).includes("=")); // esconde futuros/commodities (ex. CC=F)
    return null; // null => mostrar a tabela toda (S&P 500)
  },[activeFilter,myTickers,activeList,compTickers]);
  // Preço/nome ao vivo dos tickers da lista ativa que NÃO estão no S&P 500 (ex. ASML).
  useEffect(()=>{
    if(!filterTickers||!rows) return;
    const have=new Set(rows.map(r=>tkNorm(r.symbol)));
    // tickers ORIGINAIS (preserva o ponto, ex. RMS.PA) que ainda não têm preço; indexa por tkNorm.
    const seen=new Set(); const missing=[];
    for(const tk of filterTickers){ const k=tkNorm(tk); if(!k||have.has(k)||seen.has(k)) continue; if((k in liteQuotes)&&liteQuotes[k].fetched) continue; seen.add(k); missing.push(tk); }
    if(!missing.length) return;
    let cancel=false;
    (async()=>{
      const cryptos=missing.filter(isCrypto), stocks=missing.filter(t=>!isCrypto(t));
      const out=[];
      if(cryptos.length){
        let cd={};
        try{ const r=await fetch(`/api/crypto/price?tickers=${encodeURIComponent(cryptos.join(","))}`); const d=await r.json(); cd=d.data||{}; }catch{}
        for(const t of cryptos){ const c=cd[String(t).toUpperCase()]; out.push([tkNorm(t),{name:cryptoNameFor(t)||t, price:c?c.price:null, marketcap:c?c.marketcap:null, ath:c?c.ath:null, down:c?c.down:null, ath_ts:c?c.ath_ts:null, fetched:true}]); }
      }
      const se=await Promise.all(stocks.slice(0,40).map(async t=>{
        try{ const info=await fetchStockInfo(t); return [tkNorm(t), {name:(info&&info.name)||t, price:(info&&typeof info.price==="number")?info.price:null, fetched:true}]; }
        catch{ return [tkNorm(t),{name:t,price:null,fetched:true}]; }
      }));
      out.push(...se);
      if(cancel) return;
      setLiteQuotes(prev=>{ const n={...prev}; out.forEach(([k,v])=>{ n[k]=v; }); return n; });
    })();
    return()=>{ cancel=true; };
  },[filterTickers,rows,liteQuotes]);
  useEffect(()=>{ try{ canHover.current=window.matchMedia("(hover:hover)").matches; }catch{} },[]);
  // Procura GLOBAL (debounce) para adicionar tickers fora do S&P (ASML, BTC-USD, etc.) pela barra.
  useEffect(()=>{
    if(!authed){ setGlobalRes([]); return; }
    const term=q.trim();
    if(term.length<2){ setGlobalRes([]); setGLoading(false); return; }
    setGLoading(true);
    let cancel=false;
    const id=setTimeout(async()=>{
      // Os que JÁ aparecem na tabela (com dados) não se repetem no dropdown — o dropdown é só p/ adicionar o que a tabela não mostra.
      const have=rows?new Set(rows.map(r=>tkNorm(r.symbol))):new Set();
      const pop=searchPopular(term);        // populares europeias/internacionais (local)
      const cg=searchCryptos(term);         // cripto (local, fiável)
      let stocks=[];
      try{ const r=await searchTickers(term); stocks=(r||[]).filter(x=>x.ticker); }catch{} // estrangeiras (SEC)
      if(cancel) return;
      const seen=new Set(); const merged=[];
      for(const x of [...pop,...cg,...stocks]){ const k=tkNorm(x.ticker); if(k&&!have.has(k)&&!seen.has(k)){ seen.add(k); merged.push(x); } }
      setGlobalRes(merged.slice(0,8));
      setGLoading(false);
    },350);
    return()=>{ cancel=true; clearTimeout(id); };
  },[q,authed,rows]);
  // Fecha o menu (renomear/apagar) ao tocar/clicar fora de uma pill.
  useEffect(()=>{
    if(!menuFor) return;
    const onDown=(e)=>{ if(!e.target.closest||!e.target.closest(".athPillWrap")) setMenuFor(null); };
    document.addEventListener("pointerdown",onDown);
    return()=>document.removeEventListener("pointerdown",onDown);
  },[menuFor]);
  const view=useMemo(()=>{
    if(!rows) return [];
    let base;
    if(filterTickers){
      const bySym=new Map(rows.map(r=>[tkNorm(r.symbol),r]));
      base=filterTickers.map(tk=>{
        const r=bySym.get(tkNorm(tk)); if(r) return r;
        const lq=liteQuotes[tkNorm(tk)];
        return { symbol:String(tk).toUpperCase(), name:(lq&&lq.name)||String(tk).toUpperCase(),
          price:(lq&&lq.price!=null)?lq.price:null, marketcap:(lq&&lq.marketcap!=null)?lq.marketcap:null,
          ath:(lq&&lq.ath!=null)?lq.ath:null, ath_ts:(lq&&lq.ath_ts)||null, down:(lq&&lq.down!=null)?lq.down:null, lite:true };
      });
    } else base=norm(q)?rows:rows.filter(r=>r.in_sp500!==false); // sem pesquisa = só S&P; a pesquisar = tudo (inclui extras)
    const needle=norm(q);
    let list=needle?base.filter(r=>norm(r.symbol).includes(needle)||norm(r.name).includes(needle)):base;
    const val={
      marketcap:r=>r.marketcap??-Infinity,
      down:r=>r.down??-Infinity,
      since:r=>new Date(r.ath_ts||0).getTime(),
    }[sortKey]||(()=>0);
    const sign=sortDir==="asc"?1:-1;
    return [...list].sort((a,b)=>sign*(val(a)-val(b)));
  },[rows,q,sortKey,sortDir,filterTickers,liteQuotes]);
  const GLASS={background:"rgba(255,255,255,0.05)",backdropFilter:"blur(16px) saturate(160%)",WebkitBackdropFilter:"blur(16px) saturate(160%)",border:"1px solid rgba(255,255,255,0.10)",boxShadow:"0 8px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)"};
  const GREEN="#4ade80"; // verde partilhado: bolinha de seleção + botão Guardar
  const pillStyle=(on)=>({cursor:"pointer",borderRadius:999,padding:"7px 14px",fontSize:13,fontWeight:on?700:600,transition:"all .15s",whiteSpace:"nowrap",
    border:`1px solid ${on?"rgba(74,222,128,0.55)":"rgba(255,255,255,0.14)"}`,background:on?"rgba(34,197,94,0.20)":"rgba(255,255,255,0.05)",color:on?"#bbf7d0":"#cbd5e1"});
  const miniBtn={cursor:"pointer",borderRadius:999,padding:"5px 12px",fontSize:12,fontWeight:600,border:"1px solid rgba(255,255,255,0.14)",background:"rgba(255,255,255,0.05)",color:"#cbd5e1"};
  const menuItem={cursor:"pointer",textAlign:"left",borderRadius:8,padding:"8px 12px",fontSize:13,fontWeight:600,border:"none",background:"transparent",color:"#e2e8f0",whiteSpace:"nowrap"};
  const Hd=({k,children,align="center",cls})=>{
    const active=sortKey===k;
    const ai=align==="right"?"flex-end":align==="left"?"flex-start":"center";
    return(
      <span onClick={()=>onSort(k)} className={"athSortHd"+(active?" on":"")+(cls?" "+cls:"")}
        style={{display:"flex",flexDirection:"column",alignItems:ai,gap:1,cursor:"pointer",userSelect:"none"}}>
        <i className={"athArr"+(active&&sortDir==="asc"?" on":"")} aria-hidden="true">▲</i>
        {children}
        <i className={"athArr"+(active&&sortDir==="desc"?" on":"")} aria-hidden="true">▼</i>
      </span>
    );
  };
  return(
    <div style={{maxWidth:940,margin:"0 auto",padding:"40px 20px 120px"}}>
      <style>{`
        .athRow{display:grid;grid-template-columns:44px 1fr 116px 96px 84px 110px 110px 92px;gap:10px;align-items:center}
        .athPickMini{display:none}
        .athPx{display:contents}            /* desktop: Preço e ATH ocupam 2 pistas reais */
        .athSinceShort{display:none}
        @keyframes athSpin{to{transform:rotate(360deg)}}
        .athSpin{animation:athSpin .8s linear infinite}
        @media(hover:hover){ .athClickable:hover{background:rgba(255,255,255,0.04)} .athPill:hover{filter:brightness(1.18);transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,0.25)} }
        .athSearchBox{max-width:560px}
        @media(min-width:768px){ .athSearchBox{max-width:280px} }
        .athExtGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        @media(max-width:640px){ .athExtGrid{grid-template-columns:1fr} }

        /* Colunas ordenáveis: par de setas (cinza = clicável; ativa acende a direção) */
        .athSortHd{cursor:pointer;user-select:none;color:#94a3b8;transition:color .15s}
        .athSortHd.on{color:#e2e8f0}
        .athArr{font-style:normal;font-size:8px;line-height:1;color:#64748b;transition:color .15s}
        .athArr.on{color:#e2e8f0}
        @media(hover:hover){
          .athSortHd:hover{color:#e2e8f0}
          .athSortHd:hover .athArr{color:#94a3b8}
          .athSortHd:hover .athArr.on{color:#e2e8f0}
        }

        /* TABLET (<=760): mantém as 7 colunas, só aperta */
        @media(max-width:760px){
          .athRow{grid-template-columns:30px 1fr 90px 84px 70px 84px 80px 64px;gap:8px;
            padding-left:14px!important;padding-right:14px!important}
        }

        /* TELEMÓVEL (<=480): 6 pistas — # | Empresa | Marketcap | %abaixo | Preço/ATH | Desde */
        @media(max-width:480px){
          .athRow{grid-template-columns:16px minmax(0,1fr) 56px 60px 52px 38px;gap:6px;
            padding-left:8px!important;padding-right:8px!important}
          .athPick{display:none!important}   /* coluna Membros: cabe só desktop/tablet */
          .athPickMini{display:inline!important}   /* no telemóvel, % ao lado do ticker */
          .athNum{text-align:left!important;padding-left:0!important;font-size:12px!important}
          .athRow .stkLogo>*{width:22px!important;height:22px!important}
          .athRow .stkLogo img{width:22px!important;height:22px!important}
          .athName{display:none!important}
          .athSym{font-size:13px!important}
          .athEmp{gap:6px!important}
          .athPx{display:flex!important;flex-direction:column;align-items:center;line-height:1.12;min-width:0}
          .athPxPrice{font-size:12px!important}
          .athPxAth{font-size:10.5px!important}
          .athHeadAth{display:none!important}
          .athCap{font-size:12px!important}
          .athBadge{font-size:11px!important;padding:3px 5px!important;border-radius:7px!important}
          .athSinceLong{display:none!important}
          .athSinceShort{display:inline!important;font-size:11px!important}
          .athHead{font-size:9px!important;letter-spacing:0!important}
          .athArr{font-size:7px}
        }

        /* 320px: degrada com graça (sem scroll) — cai o logo */
        @media(max-width:359px){
          .athRow{gap:5px;padding-left:6px!important;padding-right:6px!important}
          .athRow .stkLogo{display:none!important}
        }
      `}</style>
      <h1 style={{textAlign:"center",fontSize:28,fontWeight:800,letterSpacing:"-0.5px",margin:"0 0 4px"}}>Máximo histórico</h1>
      <p style={{textAlign:"center",color:"#94a3b8",fontSize:14,margin:"0 0 24px"}}>Preço atual vs. ATH</p>

      {(authed||(compTickers&&compTickers.length>0))&&(
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"center",alignItems:"center",gap:8,marginBottom:12}}>
          {compTickers&&compTickers.length>0&&(
            <button className="athPill" onClick={()=>setActiveFilter(f=>f==="comp"?null:"comp")} title="Só as ações que os membros escolheram"
              style={pillStyle(activeFilter==="comp")}>{activeFilter==="comp"?"✓ ":""}Competição · {compTickers.length}</button>
          )}
          {myTickers&&myTickers.length>0&&(
            <button className="athPill" onClick={()=>setActiveFilter(f=>f==="mine"?null:"mine")} title="Mostrar só as minhas ações"
              style={pillStyle(activeFilter==="mine")}>{activeFilter==="mine"?"✓ ":""}Minhas {myTickers.length}</button>
          )}
          {lists.map(l=>(
            <span key={l.id} className="athPillWrap" style={{position:"relative",display:"inline-flex"}}
              onMouseEnter={()=>{ if(canHover.current&&activeFilter===l.id) setMenuFor(l.id); }}
              onMouseLeave={()=>{ if(canHover.current) setMenuFor(f=>f===l.id?null:f); }}
              onTouchStart={()=>{ lpFired.current=false; clearTimeout(lpTimer.current); lpTimer.current=setTimeout(()=>{ if(activeFilter!==l.id) return; lpFired.current=true; setMenuFor(l.id); },480); }}
              onTouchEnd={()=>clearTimeout(lpTimer.current)} onTouchMove={()=>clearTimeout(lpTimer.current)}>
              <button className="athPill" onClick={()=>{ if(lpFired.current){ lpFired.current=false; return; } setActiveFilter(f=>f===l.id?null:l.id); }} title={`Ver "${l.name}"`}
                style={pillStyle(activeFilter===l.id)}>{activeFilter===l.id?"✓ ":""}{l.name}{l.tickers.length?` · ${l.tickers.length}`:""}</button>
              {menuFor===l.id&&activeFilter===l.id&&(
                <div style={{position:"absolute",top:"100%",left:"50%",transform:"translateX(-50%)",zIndex:40,paddingTop:6}}>
                  {/* paddingTop é a "ponte" invisível: o cursor passa da pill para o menu sem atravessar vão */}
                  <div style={{background:"rgba(20,26,42,0.98)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:12,padding:6,
                    display:"flex",flexDirection:"column",gap:2,minWidth:150,boxShadow:"0 10px 30px rgba(0,0,0,0.5)"}}>
                    <button onClick={()=>{ setMenuFor(null); setNameModal({mode:"rename",id:l.id,value:l.name}); }} style={menuItem}>✎ Renomear</button>
                    <button onClick={()=>{ setMenuFor(null); if(typeof window==="undefined"||window.confirm(`Apagar a lista "${l.name}"?`)) deleteList(l.id); }} style={menuItem}>🗑 Apagar</button>
                  </div>
                </div>
              )}
            </span>
          ))}
          {authed&&(draftName!==null?(
            <input autoFocus value={draftName} onChange={e=>setDraftName(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } else if(e.key==="Escape"){ draftCancel.current=true; e.currentTarget.blur(); } }}
              onBlur={()=>{ if(draftCancel.current){ draftCancel.current=false; setDraftName(null); return; } const nm=(draftName||"").trim(); if(nm) createList(nm); setDraftName(null); }}
              placeholder="Nome da lista…"
              style={{borderRadius:999,padding:"6px 14px",fontSize:13,fontWeight:600,width:130,
                border:"1px solid rgba(96,165,250,0.55)",background:"rgba(0,0,0,0.25)",color:"#e2e8f0",outline:"none"}}/>
          ):(
            <button onClick={()=>setDraftName("")} title="Criar nova watchlist"
              style={{cursor:"pointer",background:"none",border:"none",color:"#94a3b8",fontSize:22,lineHeight:1,padding:"2px 8px",fontWeight:400}}>+</button>
          ))}
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginBottom:14}}>
        <div className="athSearchBox" style={{position:"relative",width:"100%"}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}>
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input value={q} onChange={e=>{ const v=e.target.value; setQ(v); if(v.trim()) setActiveFilter(null); }} placeholder="Procurar ticker ou empresa…"
            style={{width:"100%",background:"rgba(0,0,0,0.18)",border:"1px solid rgba(255,255,255,0.12)",boxSizing:"border-box",
              borderRadius:16,padding:"12px 36px",fontSize:14,color:"#e2e8f0",outline:"none",textAlign:"center"}}/>
          {q&&(
            <button onClick={()=>{ setQ(""); setGlobalRes([]); }} title="Limpar" aria-label="Limpar pesquisa"
              style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",display:"flex",alignItems:"center",justifyContent:"center",
                width:24,height:24,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"none",color:"#cbd5e1",cursor:"pointer",padding:0}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
        <div style={{width:"100%",maxWidth:560,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12.5,color:"#94a3b8",whiteSpace:"nowrap"}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"#34d399",flexShrink:0,boxShadow:"0 0 8px rgba(52,211,153,0.6)"}}/>
            {rows?(updatedAt?`Atualizado ${new Date(updatedAt).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"short"})}`:""):"A carregar…"}
          </span>
          <button onClick={load} disabled={refreshing} title="Atualizar dados" aria-label="Atualizar dados"
            style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:38,height:38,borderRadius:14,flexShrink:0,
              background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",color:"#cbd5e1",padding:0,
              cursor:refreshing?"default":"pointer",opacity:refreshing?0.6:1}}>
            <svg className={refreshing?"athSpin":""} width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>
            </svg>
          </button>
        </div>
      </div>

      <div style={{...GLASS,borderRadius:16,overflow:"hidden"}}>
        <div className="athRow" style={{padding:"10px 18px",borderBottom:"1px solid rgba(255,255,255,0.10)",
          fontSize:11,textTransform:"uppercase",letterSpacing:"0.5px",fontWeight:600,color:"#94a3b8"}}>
          <span aria-hidden="true"/><span className="athHead">Empresa</span>
          <Hd k="marketcap" align="center"><span className="athHead">Marketcap</span></Hd>
          <Hd k="down" align="center"><span className="athHead">% abaixo</span></Hd>
          <span className="athPick athHead" style={{textAlign:"center"}}>Membros</span>
          <span className="athPx athHead" style={{textAlign:"center"}}>
            <span style={{textAlign:"center"}}>Preço</span>
            <span className="athHeadAth" style={{textAlign:"center"}}>ATH</span>
          </span>
          <Hd k="since" align="center"><span className="athHead">Desde</span></Hd>
        </div>
        {rows===null?(
          Array.from({length:12},(_,i)=>(
            <div key={i} className="athRow" style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
              <span className="athNum" style={{textAlign:"center"}}><Skeleton w={16} h={12}/></span>
              <span className="athEmp" style={{display:"flex",alignItems:"center",gap:10}}>
                <Skeleton w={30} h={30} r={6}/>
                <span style={{display:"flex",flexDirection:"column",gap:6}}>
                  <Skeleton w={54} h={11}/><span className="athName"><Skeleton w={108} h={9}/></span>
                </span>
              </span>
              <span style={{textAlign:"center"}}><Skeleton w={70} h={13}/></span>
              <span style={{textAlign:"center"}}><Skeleton w={58} h={20}/></span>
              <span className="athPx">
                <span style={{textAlign:"center"}}><Skeleton w={56} h={12}/></span>
                <span style={{textAlign:"center"}}><Skeleton w={48} h={11}/></span>
              </span>
              <span style={{textAlign:"center"}}><Skeleton w={34} h={11}/></span>
            </div>
          ))
        ):view.length===0?(
          <div style={{padding:50,textAlign:"center",color:"#64748b",fontSize:14}}>
            {rows.length===0?"Ainda sem dados — a tabela vai ser preenchida em breve.":q.trim()?"Nenhuma ação do S&P 500 corresponde.":"Sem resultados."}
          </div>
        ):(<>{view.slice(0,limit).map((r,i)=>{
          const up=r.down!=null&&r.down>=0;
          const col=r.down==null?"#94a3b8":up?"#4ade80":"#f87171";
          const bg=r.down==null?"transparent":up?"rgba(34,197,94,0.10)":"rgba(248,113,113,0.10)";
          const bd=r.down==null?"rgba(255,255,255,0.12)":up?"rgba(34,197,94,0.35)":"rgba(248,113,113,0.35)";
          const picks=pickCounts?.[tkNorm(r.symbol)]||0;
          const mine=!!(myTickers&&myTickers.some(t=>tkNorm(t)===tkNorm(r.symbol)));
          return(
            <div key={r.symbol} className={"athRow"+(authed?" athClickable":"")} onClick={authed?()=>openAdd(r.symbol):undefined} title={authed?"Adicionar a uma watchlist":undefined} style={{padding:"12px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)",cursor:authed?"pointer":"default",boxShadow:mine?"inset 3px 0 0 rgba(34,197,94,0.6)":"none"}}>
              <span className="athNum" style={{textAlign:"center",fontSize:13,color:"#64748b",fontWeight:700}}>{i+1}</span>
              <span className="athEmp" style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
                <StockLogo ticker={r.symbol} size={30}/>
                <span style={{minWidth:0,display:"flex",flexDirection:"column",lineHeight:1.15}}>
                  <span className="athSym" style={{fontWeight:700,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{r.symbol}</span>
                    {picks>0&&<span className="athPickMini" style={{fontSize:10.5,color:"#94a3b8",fontWeight:700,flexShrink:0}}>{picks}</span>}
                  </span>
                  <span className="athName" style={{fontSize:12,color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</span>
                </span>
              </span>
              <span className="athCap" style={{textAlign:"center",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{fmtCap(r.marketcap,curSym(curForTicker(r.symbol)))}</span>
              <span style={{textAlign:"center"}}>
                <span className="athBadge" style={{display:"inline-block",fontFamily:"monospace",fontSize:13,fontWeight:800,color:col,
                  background:bg,border:`1px solid ${bd}`,borderRadius:8,padding:"4px 8px"}}>
                  {r.down==null?"—":`${up?"+":""}${(r.down*100).toFixed(1)}%`}
                </span>
              </span>
              <span className="athPick" style={{textAlign:"center",fontFamily:"monospace",fontSize:13,fontWeight:700,color:picks>0?"#94a3b8":"#475569"}} title={picks>0?`${picks} membro(s) têm esta ação`:"Ninguém na competição tem esta ação"}>
                {picks>0?picks:"—"}
              </span>
              <span className="athPx">
                <span className="athPxPrice" style={{textAlign:"center",fontFamily:"monospace",fontSize:14,fontWeight:700}}>{fmtMoneyC(r.price,curSym(curForTicker(r.symbol)))}</span>
                <span className="athPxAth" style={{textAlign:"center",fontFamily:"monospace",fontSize:13,color:"#94a3b8"}}>{fmtMoneyC(r.ath,curSym(curForTicker(r.symbol)))}</span>
              </span>
              <span style={{textAlign:"center",fontSize:12.5,color:"#94a3b8"}}>
                <span className="athSinceLong">{sinceLabel(r.ath_ts)}</span>
                <span className="athSinceShort">{sinceLabelShort(r.ath_ts)}</span>
              </span>
            </div>
          );
        })}
        {view.length>limit&&(
          <div style={{padding:"14px",textAlign:"center"}}>
            <button onClick={()=>setLimit(l=>l+150)}
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:999,
                padding:"9px 18px",fontSize:13,fontWeight:600,color:"#cbd5e1",cursor:"pointer"}}>
              Mostrar mais ({view.length-limit})
            </button>
          </div>
        )}
        </>)}
      </div>

      {authed&&q.trim().length>=2&&(globalRes.length>0||gLoading)&&(
        <div style={{marginTop:14}}>
          <div style={{fontSize:11,color:"#64748b",textAlign:"center",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.5px"}}>
            Fora do S&P 500 · adiciona à watchlist para ver valores
          </div>
          <div className="athExtGrid">
            {globalRes.map((res,i)=>(
              <button key={`${res.ticker}-${i}`}
                onClick={()=>{ const tk=String(res.ticker||"").toUpperCase(); setLiteQuotes(qq=>({...qq,[tkNorm(tk)]:{...(qq[tkNorm(tk)]||{}),name:res.name||tk}})); openAdd(tk); }}
                style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",textAlign:"left",borderRadius:10,padding:"8px 12px",
                  border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)",color:"#cbd5e1"}}>
                <StockLogo ticker={res.ticker} size={22}/>
                <span style={{minWidth:0,flex:1,display:"flex",flexDirection:"column",lineHeight:1.2}}>
                  <span style={{fontWeight:700,fontSize:12.5}}>{res.ticker}</span>
                  <span style={{fontSize:11,color:"#8792a3",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{res.name}{res.exchange?` · ${res.exchange}`:""}</span>
                </span>
                <span style={{color:"#4ade80",fontWeight:800,fontSize:15,flexShrink:0}}>+</span>
              </button>
            ))}
            {gLoading&&!globalRes.length&&<span style={{fontSize:11,color:"#64748b",textAlign:"center",gridColumn:"1/-1"}}>A procurar…</span>}
          </div>
        </div>
      )}

      {addFor&&(
        <div onClick={()=>setAddFor(null)} style={{position:"fixed",inset:0,zIndex:9000,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS,borderRadius:18,padding:18,width:"100%",maxWidth:340,maxHeight:"80vh",overflow:"auto"}}>
            <h3 style={{margin:"0 0 12px",fontSize:16,fontWeight:800}}>Adicionar {addFor}</h3>
            {lists.length===0&&<p style={{fontSize:13,color:"#94a3b8",margin:"0 0 10px"}}>Ainda não tens listas. Cria uma com "+".</p>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {lists.map(l=>{
                const inList=l.tickers.some(x=>tkNorm(x)===tkNorm(addFor)); // pertence já à lista?
                return(
                  <button key={l.id} onClick={()=>toggleTicker(l.id,addFor)}
                    style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",textAlign:"left",
                      borderRadius:10,padding:"10px 12px",fontSize:14,fontWeight:600,transition:"all .15s",
                      border:`1px solid ${inList?"rgba(74,222,128,0.5)":"rgba(255,255,255,0.12)"}`,
                      background:inList?"rgba(34,197,94,0.14)":"rgba(255,255,255,0.04)",color:"#e2e8f0"}}>
                    <span aria-hidden="true" style={{flexShrink:0,width:20,height:20,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
                      border:`2px solid ${inList?GREEN:"rgba(255,255,255,0.28)"}`,background:inList?GREEN:"transparent",transition:"all .15s"}}>
                      {inList&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06281a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>}
                    </span>
                    <span style={{flex:1,minWidth:0}}>{l.name}</span>
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",gap:10,marginTop:14}}>
              <button onClick={()=>setNameModal({mode:"create-add",ticker:addFor,value:"Watch list"})}
                style={{flex:1,padding:"12px",borderRadius:14,fontSize:14,fontWeight:700,cursor:"pointer",
                  background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.14)",color:"#cbd5e1"}}>+ Nova lista</button>
              <button onClick={()=>{ setAddFor(null); setQ(""); setGlobalRes([]); }}
                style={{flex:1,padding:"12px",borderRadius:14,fontSize:14,fontWeight:800,cursor:"pointer",
                  background:GREEN,border:`1px solid ${GREEN}`,color:"#06281a"}}>Concluído</button>
            </div>
          </div>
        </div>
      )}
      {nameModal&&(
        <div onClick={()=>setNameModal(null)} style={{position:"fixed",inset:0,zIndex:9001,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{...GLASS,borderRadius:18,padding:18,width:"100%",maxWidth:320}}>
            <h3 style={{margin:"0 0 12px",fontSize:16,fontWeight:800}}>{nameModal.mode==="rename"?"Renomear lista":"Nova lista"}</h3>
            <input autoFocus value={nameModal.value} onChange={e=>setNameModal(m=>({...m,value:e.target.value}))}
              onKeyDown={e=>{ if(e.key==="Enter") confirmName(); }}
              style={{width:"100%",background:"rgba(0,0,0,0.25)",border:"1px solid rgba(255,255,255,0.14)",borderRadius:10,padding:"10px 12px",fontSize:14,color:"#e2e8f0",outline:"none",boxSizing:"border-box"}}/>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
              <button onClick={()=>setNameModal(null)} style={miniBtn}>Cancelar</button>
              <button onClick={confirmName} style={{...miniBtn,background:"rgba(34,197,94,0.18)",border:"1px solid rgba(34,197,94,0.4)",color:"#86efac"}}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

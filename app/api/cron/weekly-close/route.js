import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { usMarketOpen } from "../../../lib/marketHours";
import { fetchQuote } from "../../../lib/marketData";

export const maxDuration = 30;

// FECHO DA SEMANA ("Vencedor da Semana N"). À 6ª feira, depois do fecho do mercado US, grava o
// preço de FECHO de cada ticker (close_price) nas linhas da semana atual. A partir daí a semana
// fica CONGELADA: o vencedor = média de (close/open − 1) por ação, espelhado p/ shorts — exato e
// imutável, mesmo semanas passadas. Corre 6ª ~22:00 UTC (após o último update horário do sp500_ath).
//
// Fonte dos preços: sp500_ath (já com o fecho de 6ª). Idempotente: só grava se ainda não houver
// close_price nesta semana. Protegido por CRON_SECRET. ?force=1 ignora os guards.
const norm = (s) => String(s || "").toUpperCase().replace(/\./g, "-").trim();
function weekKey(d){
  const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
  const dow=t.getUTCDay(); t.setUTCDate(t.getUTCDate()+(dow===0?-6:1-dow));
  return t.toISOString().slice(0,10);
}
function nextWeek(key){ const t=new Date(key+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+7); return t.toISOString().slice(0,10); }

export async function GET(request){
  const secret=process.env.CRON_SECRET;
  const auth=request.headers.get("authorization");
  if(!secret||auth!==`Bearer ${secret}`) return Response.json({error:"Não autorizado."},{status:401});

  const url=new URL(request.url);
  const force=url.searchParams.get("force")==="1";
  const now=new Date();
  const period=url.searchParams.get("period")||weekKey(now); // 2ª feira UTC da semana a fechar

  // Só à 6ª feira. getUTCDay: 5 = 6ª feira.
  if(!force&&now.getUTCDay()!==5) return Response.json({ok:true,period,captured:0,skipped:"só à 6ª feira"});
  // Só DEPOIS do fecho do mercado US (senão gravaria preços intradiários como "fecho"). Como o
  // agendamento tem dois horários (verão/inverno), este guard garante que só o de após o fecho grava.
  if(!force&&usMarketOpen(now)) return Response.json({ok:true,period,captured:0,skipped:"mercado ainda aberto"});

  let supabase; try{ supabase=getSupabaseAdmin(); } catch(e){ return Response.json({error:e.message},{status:500}); }

  const {data:gs}=await supabase.from("game_settings").select("competition_started").eq("id",1).maybeSingle();
  if(gs?.competition_started!==true) return Response.json({ok:true,period,captured:0,skipped:"competição não começou"});

  // Linhas de abertura desta semana (têm de existir; foram criadas 2ª feira).
  const {data:rows,error}=await supabase
    .from("weekly_baselines").select("ticker, price, close_price").eq("period",period);
  if(error) return Response.json({error:"Falha a ler weekly_baselines."},{status:500});
  if(!rows||!rows.length) return Response.json({ok:true,period,captured:0,skipped:"semana sem baseline de abertura"});
  // Idempotência: já fechada?
  if(rows.some(r=>r.close_price!=null)) return Response.json({ok:true,period,captured:0,skipped:"semana já fechada"});

  // Preços de FECHO do sp500_ath.
  const {data:ath,error:athErr}=await supabase.from("sp500_ath").select("symbol, price");
  if(athErr) return Response.json({error:"Falha a ler sp500_ath."},{status:500});
  const priceMap=new Map();
  for(const r of ath||[]){ const p=Number(r.price); if(Number.isFinite(p)&&p>0) priceMap.set(norm(r.symbol),p); }

  const capturedAt=now.toISOString();
  const upserts=[]; const skippedTickers=[];
  for(const r of rows){
    let close=priceMap.get(norm(r.ticker));
    if(!(Number.isFinite(close)&&close>0)){
      // Fora do sp500_ath (ex.: BTC ETF) → cotação ao vivo (a MESMA fonte do livePrices do cliente),
      // para o fecho ficar completo (senão o cliente cairia no preço de arranque e mostraria o total).
      try{ const q=await fetchQuote(r.ticker); if(Number.isFinite(q)&&q>0) close=q; }catch{}
    }
    if(Number.isFinite(close)&&close>0) upserts.push({period,ticker:r.ticker,price:r.price,close_price:close,captured_at:capturedAt});
    else skippedTickers.push(r.ticker);
  }
  if(!upserts.length) return Response.json({ok:true,period,captured:0,skipped:"sem preços de fecho"});

  const {error:upErr}=await supabase
    .from("weekly_baselines").upsert(upserts,{onConflict:"period,ticker"});
  if(upErr) return Response.json({error:upErr.message},{status:500});

  // Adianta o BASELINE da próxima semana = este fecho (o "fecho anterior" a 2ª feira). Assim o jogo
  // semanal fica ao vivo logo à abertura de 2ª feira, sem esperar pelo cron de 2ª. Idempotente.
  const next=nextWeek(period);
  const nextBaselines=upserts.map(u=>({period:next,ticker:u.ticker,price:u.close_price,captured_at:capturedAt}));
  const {error:nErr}=await supabase
    .from("weekly_baselines").upsert(nextBaselines,{onConflict:"period,ticker",ignoreDuplicates:true});

  // Notifica o VENCEDOR da semana (best-effort). Vencedor = melhor média (close/open-1), espelhado p/ shorts.
  // Vencedor + DIGEST semanal (1 notificação por membro): rentab. da semana (open→close, espelhado p/
  // shorts) + posição + melhor/pior ação. O 1º recebe "Ganhaste a semana"; os restantes o resumo.
  // Best-effort (nunca rebenta o fecho) + bulk insert (1 escrita para todos). Idempotente com o guard do fecho.
  try{
    const oc=new Map(); for(const u of upserts) oc.set(norm(u.ticker),{o:Number(u.price),c:Number(u.close_price)});
    const {data:pfs}=await supabase.from("portfolios").select("user_id, portfolio_stocks(ticker, side)").eq("official",true);
    const pctS=(x)=>`${x>=0?"+":""}${(x*100).toFixed(2)}%`;
    const results=[];
    for(const p of pfs||[]){ const st=p.portfolio_stocks||[]; if(!st.length||!p.user_id) continue;
      let sum=0,n=0; const per=[];
      for(const s of st){ const x=oc.get(norm(s.ticker)); if(!x||!(x.o>0)||!(x.c>0)) continue; const raw=x.c/x.o-1; const r=s.side==="short"?-raw:raw; sum+=r; n++; per.push({ticker:s.ticker,r}); }
      if(n===0) continue; per.sort((a,b)=>b.r-a.r);
      results.push({ userId:p.user_id, ret:sum/n, best:per[0], worst:per[per.length-1] });
    }
    results.sort((a,b)=>b.ret-a.ret);
    // Número da semana (Semana 1 = 29-jun) para o título do digest.
    const weekN=Math.max(1,Math.round((Date.parse(period+"T00:00:00Z")-Date.parse("2026-06-29T00:00:00Z"))/(7*86400000))+1);
    const total=results.length; const rows=[];
    for(let i=0;i<total;i++){ const rr=results[i]; const rank=i+1;
      if(rank===1){ rows.push({ user_id:rr.userId, type:"weekly_win", title:`Ganhaste a semana ${weekN}! 🏆`, body:`${pctS(rr.ret)} esta semana`, link:"ranking-week" }); continue; }
      const sk=[];
      if(rr.best) sk.push(`▲ melhor ${rr.best.ticker} ${pctS(rr.best.r)}`);
      if(rr.worst&&rr.worst.ticker!==rr.best?.ticker) sk.push(`▼ pior ${rr.worst.ticker} ${pctS(rr.worst.r)}`);
      const body=sk.length?`${rank}º/${total} da semana\n${sk.join(" ")}`:`${rank}º/${total} da semana`;
      rows.push({ user_id:rr.userId, type:"weekly_digest", title:`Teu resumo da semana ${weekN}: ${pctS(rr.ret)}`, body, link:"ranking-week" });
    }
    for(let i=0;i<rows.length;i+=500){ await supabase.from("notifications").insert(rows.slice(i,i+500)); }
  }catch{}

  return Response.json({ok:true,period,captured:upserts.length,nextSeeded:nErr?0:nextBaselines.length,skippedTickers});
}

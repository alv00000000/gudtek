// GUDTEK — robot que recorre DexScreener y guarda la lista compartida de tokens de Solana.
// Lo ejecuta GitHub Actions cada ~10 min. Nunca borra tokens: solo añade nuevos y actualiza los que ya hay.
import fs from 'node:fs/promises';

const DS = process.env.DS_URL || 'https://api.dexscreener.com';
const JUP = process.env.JUP_URL || 'https://lite-api.jup.ag';
const OUT = process.env.OUT || 'site/tokens.json';
const RUN_MS = +(process.env.RUN_MS || 240000);          // tiempo de recorrido por ejecución (4 min)
const PREV_URL = process.env.PREV_URL || '';               // lista publicada en la ejecución anterior
const PREV_FILE = process.env.PREV_FILE || '';             // o la que dejó la vuelta anterior dentro de la misma ejecución
const T0 = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const timeLeft = () => RUN_MS - (Date.now() - T0);

/* ---------- lista anterior ---------- */
const rows = new Map();      // mint -> fila compacta
const pairsOf = new Map();   // mint -> Map(pairAddress -> par) (solo durante esta ejecución)
let termIdx = 0, sweepIdx = 0;
const archive = new Map();   // tokens sin actividad en 24 h: nunca se borran, se guardan aparte (archive.json)
const pending = new Map();   // tokens recién creados (PumpPortal) que DexScreener aún no lista: mint -> primera vez visto
// lee la lista de la vuelta anterior (archivo local) o la publicada (URL). Si existe pero no se puede leer, se para.
async function loadPrev(file, url){
  if (file){ try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {} }
  if (!url) return null;
  let r;
  for (let i = 0; i < 4; i++){
    try { r = await fetch(url + '?t=' + Date.now(), { headers:{ 'cache-control':'no-cache' } }); if (r.ok || r.status === 404) break; } catch {}
    await sleep(5000);
  }
  if (r?.status === 404) return null;
  if (!r?.ok) { console.error('No se pudo leer ' + url + '; no se publica nada en esta ejecución.'); process.exit(1); }
  return r.json();
}
const ARCH_FILE = PREV_FILE ? PREV_FILE.replace(/tokens\.json$/, 'archive.json') : '';
const ARCH_URL = PREV_URL ? PREV_URL.replace(/tokens\.json$/, 'archive.json') : '';
const prevActive = await loadPrev(PREV_FILE, PREV_URL);
const prevArchive = await loadPrev(ARCH_FILE, ARCH_URL);
for (const o of prevActive?.rows || []) if (o.mint) rows.set(o.mint, o);
for (const o of prevArchive?.rows || []) if (o.mint && !rows.has(o.mint)) archive.set(o.mint, o);
for (const [m, t] of prevActive?.pending || []) if (!rows.has(m)) pending.set(m, t);
termIdx = prevActive?.termIdx || 0; sweepIdx = prevActive?.sweepIdx || 0;
let archIdx = prevActive?.archIdx || 0;
console.log(`Lista anterior: ${rows.size} activos, ${archive.size} en el histórico, ${pending.size} pendientes`);

/* ---------- ritmo de llamadas ---------- */
// pares, búsquedas y tokens: 300/min en DexScreener → se usan ~240/min
let next = 0;
async function ds(path){
  const now = Date.now(), wait = Math.max(0, next - now); next = Math.max(now, next) + 250; if (wait) await sleep(wait);
  for (let i = 0; i < 3; i++){
    const r = await fetch(DS + path, { headers:{ accept:'application/json' } });
    if (r.status === 429){ await sleep(4000 * (i + 1)); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
    return r.json();
  }
  throw new Error('429 ' + path);
}
// perfiles, boosts, takeovers, anuncios y metas: 60/min cada uno
async function dsList(path){ const r = await fetch(DS + path, { headers:{ accept:'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

/* ---------- misma lógica que la página ---------- */
const isCurve = p => { const d = (p.dexId||'').toLowerCase(), l = (p.labels||[]).map(x => String(x).toLowerCase());
  return d === 'pumpfun' || d === 'moonshot' || d === 'launchlab' || d === 'meteoradbc' || d.includes('boop') || l.includes('dbc') || l.includes('launchlab'); };
function launchpadOf(mint, pairs){
  if (mint.endsWith('pump')) return 'Pump.fun';
  if (mint.endsWith('bonk')) return 'LetsBonk';
  if (mint.endsWith('BAGS')) return 'Bags';
  if (mint.endsWith('boop')) return 'Boop';
  for (const p of pairs){
    const d = (p.dexId||'').toLowerCase(), l = (p.labels||[]).map(x => String(x).toLowerCase());
    if (d === 'pumpfun' || d === 'pumpswap') return 'Pump.fun';
    if (d === 'launchlab' || l.includes('launchlab')) return 'LaunchLab';
    if (d === 'moonshot') return 'Moonshot';
    if (d.includes('boop')) return 'Boop';
    if (d === 'bags') return 'Bags';
    if (d === 'meteoradbc' || l.includes('dbc')) return 'Meteora DBC';
  }
  return 'Other / DEX';
}

const dexLabel = id => ({ pumpfun:'Pump.fun', pumpswap:'PumpSwap', raydium:'Raydium', meteora:'Meteora', orca:'Orca', launchlab:'LaunchLab', moonshot:'Moonshot', fluxbeam:'FluxBeam', lifinity:'Lifinity' }[id] || (id ? id[0].toUpperCase() + id.slice(1) : '?'));
const JUP_LP = { 'pump.fun':'Pump.fun', 'letsbonk.fun':'LetsBonk', 'bonk':'LetsBonk', 'bags.fun':'Bags', 'bags':'Bags', 'boop':'Boop', 'boop.fun':'Boop',
  'raydium-launchlab':'LaunchLab', 'launchlab':'LaunchLab', 'met-dbc':'Meteora DBC', 'meteora-dbc':'Meteora DBC', 'moonshot':'Moonshot', 'believe':'Believe',
  'jup-studio':'Jup Studio', 'stonkfun':'Stonk.fun', 'stonk.fun':'Stonk.fun', 'heaven':'Heaven', 'time.fun':'Time.fun', 'daos.fun':'Daos.fun', 'otc':'OTC' };

function jupLaunchpad(v){ if (!v || typeof v !== 'string') return null; const k = v.toLowerCase(); return JUP_LP[k] || v.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function ingest(pairs){
  for (const p of pairs || []){
    if (!p || p.chainId !== 'solana' || !p.baseToken?.address) continue;
    const m = p.baseToken.address;
    if (!pairsOf.has(m)) pairsOf.set(m, new Map());
    pairsOf.get(m).set(p.pairAddress, p);
  }
}
function derive(mint){
  const ps = [...pairsOf.get(mint).values()].sort((a,b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const top = ps[0], prev = rows.get(mint) || {};
  const sum = f => { let s = 0, any = false; for (const p of ps){ const v = num(f(p)); if (v != null){ s += v; any = true; } } return any ? Math.round(s * 100) / 100 : null; };
  const created = ps.map(p => p.pairCreatedAt).filter(Boolean);
  const info = ps.find(p => p.info)?.info || {};
  const lp = prev.jupLp || launchpadOf(mint, ps);
  const row = {
    ...prev, mint,
    pool: top.pairAddress, url: top.url, name: top.baseToken.name || '', symbol: top.baseToken.symbol || '?',
    img: /^https:\/\//.test(info.imageUrl || '') ? info.imageUrl : (prev.img || ''),
    dexId: top.dexId || '', dexName: dexLabel(top.dexId), nPairs: ps.length,
    quoteSym: top.quoteToken?.symbol || '', quoteAddr: top.quoteToken?.address || '',
    lp, stage: ps.every(isCurve) ? 'curve' : lp === 'Other / DEX' ? 'dex' : 'grad',
    price: num(top.priceUsd), mcap: num(top.marketCap) ?? num(top.fdv),
    liq: sum(p => p.liquidity?.usd),
    vol: { h1: sum(p => p.volume?.h1), h6: sum(p => p.volume?.h6), h24: sum(p => p.volume?.h24) },
    chg: { m5: num(top.priceChange?.m5), h1: num(top.priceChange?.h1), h6: num(top.priceChange?.h6), h24: num(top.priceChange?.h24) },
    tx: { h1: sum(p => (p.txns?.h1?.buys ?? 0) + (p.txns?.h1?.sells ?? 0)), h6: sum(p => (p.txns?.h6?.buys ?? 0) + (p.txns?.h6?.sells ?? 0)), h24: sum(p => (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0)) },
    created: created.length ? Math.min(...created) : (prev.created ?? null),
    site: info.websites?.[0]?.url || prev.site || '', sites: (info.websites || []).map(w => w.url).filter(Boolean),
    x: (info.socials || []).find(s => s.type === 'twitter')?.url || prev.x || '',
    xAll: [...new Set(ps.flatMap(p => (p.info?.socials || []).filter(s => s.type === 'twitter' || s.type === 'x').map(s => s.url)).filter(Boolean))],
    paid: prev.paid || paidSeen.has(mint) || !!ps.find(p => p.info),
    seen: Date.now(),
  };
  rows.set(mint, row);
}

/* ---------- PumpPortal: avisa de cada token nuevo de Pump.fun y de cada migración ---------- */
let pumpSeen = 0;
function startPumpPortal(){
  if (typeof WebSocket === 'undefined') { console.log('WebSocket no disponible (usa Node 22)'); return null; }
  try {
    const ws = new WebSocket('wss://pumpportal.fun/api/data');
    ws.onopen = () => { ws.send(JSON.stringify({ method:'subscribeNewToken' })); ws.send(JSON.stringify({ method:'subscribeMigration' })); };
    ws.onmessage = ev => { try { const m = JSON.parse(ev.data); if (m?.mint && typeof m.mint === 'string') { pumpSeen++; if (!rows.has(m.mint)) { if (!pending.has(m.mint)) pending.set(m.mint, Date.now()); if (archive.has(m.mint)) enqueue(m.mint); } } } catch {} };
    ws.onerror = () => {};
    return ws;
  } catch { return null; }
}

/* ---------- recorrido ---------- */
const queue = [], queued = new Set();
const pendingTry = new Map();
const enqueue = m => { if (!queued.has(m)) { queued.add(m); queue.push(m); } };
let calls = 0, newTokens = 0;
const pumpWs = startPumpPortal();
const before = new Set([...rows.keys(), ...archive.keys()]);
const startMints = new Set(rows.keys());

// 1) listas: perfiles (DEX pagado), actualizados, boosts, takeovers, anuncios.
//    DexScreener solo devuelve los 30 últimos de cada lista, así que se consultan sin parar durante toda la pasada
//    (cada una a su ritmo, por debajo de su límite de 60/min) para no perder ningún DEX pagado.
const LISTS = { '/token-profiles/latest/v1':1500, '/token-profiles/recent-updates/v1':3000, '/token-boosts/latest/v1':3000, '/token-boosts/top/v1':15000, '/community-takeovers/latest/v1':6000, '/ads/latest/v1':6000 };
const paidSeen = new Set();
async function readList(path){
  try {
    for (const it of await dsList(path)){
      if (it.chainId !== 'solana' || !it.tokenAddress) continue;
      const m = it.tokenAddress;
      if (path.includes('profiles')) { paidSeen.add(m); if (rows.has(m)) rows.get(m).paid = true; }
      if (!rows.has(m)) { if (!queued.has(m)) { queued.add(m); queue.unshift(m); } }   // los nuevos, los primeros de la cola
    }
  } catch (e) { console.log(path, e.message); }
}
const listLoops = Object.entries(LISTS).map(async ([path, every]) => {
  while (timeLeft() > 16000){ const t = Date.now(); await readList(path); await sleep(Math.max(0, every - (Date.now() - t))); }
});
// 2) metas en tendencia, con sus pares
try {
  for (const m of await dsList('/metas/trending/v1')){
    try { const j = await dsList('/metas/meta/v1/' + encodeURIComponent(m.slug)); ingest(j.pairs); } catch {}
    await sleep(1100);
  }
} catch (e) { console.log(e.message); }

// 3) búsquedas rotando + 4) actualización de todos los tokens, intercalados
const TERMS = [...'abcdefghijklmnopqrstuvwxyz', ...('sol pump bonk meme ai agent dog cat pepe frog trump elon musk moon inu coin baby king queen cto based chill grok wif punk gork doge shib floki ' +
  'bear bull ape monkey chad wojak giga sigma rizz brain rot skibidi gyat ohio fart cum butt titty milady remilia cult church god jesus satan devil angel ' +
  'pixel retro anime waifu chan kun san nippon china chinese japan korea usa america maga biden obama kanye drake taylor tate andrew ' +
  'gold silver diamond money cash rich poor degen gamble casino lucky jackpot dragon tiger lion wolf fox owl hawk eagle shark whale fish duck goose ' +
  'penguin panda koala hamster rat mouse snake turtle goat cow pig horse unicorn alien ufo robot cyber neural quant data defi stake yield vault ' +
  'meta x402 tiktok viral troll lol lmao bro dude guy man boy girl mom dad grandpa uncle wife husband friend hero villain ninja samurai pirate ' +
  'space mars rocket star sun earth planet galaxy cosmic magic wizard witch potion fire ice water storm thunder light dark shadow ghost zombie ' +
  'pizza burger taco sushi coffee beer wine banana apple cherry cookie cake candy sugar milk honey bread cheese bacon egg chicken ' +
  'game play win lose fun happy sad angry crazy weird strange funny cute baby tiny giant mega ultra super hyper turbo max pro based official ' +
  'token labs dao fi swap bot app net world city land club team army gang nation tribe family').split(' ')].filter(Boolean);

// combinaciones de dos letras (aa…zz) y números: cada búsqueda descubre tokens distintos
for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') TERMS.push(a + b);
for (let i = 0; i <= 99; i++) TERMS.push(String(i));
// y combinaciones de tres letras (aaa…zzz): llegan a los tokens menos conocidos
for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') for (const d of 'abcdefghijklmnopqrstuvwxyz') TERMS.push(a + b + d);
for (let i = TERMS.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [TERMS[i], TERMS[j]] = [TERMS[j], TERMS[i]]; }   // orden aleatorio

let flip = 0;
while (timeLeft() > 15000){
  flip++;
  try {
    if (flip % 2 === 0){                         // 1 de cada 2 llamadas: búsqueda (descubre tokens nuevos)
      const q = TERMS[termIdx++ % TERMS.length];
      const j = await ds('/latest/dex/search?q=' + encodeURIComponent(q)); ingest(j.pairs);
    } else {                                     // la otra: datos de 30 tokens (primero los nuevos, luego los más antiguos)
      let batch = queue.splice(0, 30); batch.forEach(m => queued.delete(m));
      // tokens de PumpPortal: se reintentan hasta que DexScreener los lista (cada 20 s al principio, luego más espaciado; máx. 1 h)
      const now = Date.now();
      for (const [m, t] of pending){ if (batch.length >= 30) break; const gap = Math.min(180000, 20000 * (1 + Math.floor((now - t) / 300000))); if (now - (pendingTry.get(m) || 0) > gap && !batch.includes(m)) { batch.push(m); pendingTry.set(m, now); } }
      if (batch.length < 30 && flip % 12 === 1 && archive.size){   // de vez en cuando, un lote del histórico por si revive
        const arch = [...archive.keys()];
        while (batch.length < 30 && batch.length < arch.length){ const m = arch[archIdx++ % arch.length]; if (!batch.includes(m)) batch.push(m); }
      }
      if (batch.length < 30){
        const all = [...rows.keys()];
        while (batch.length < 30 && all.length && batch.length < all.length){ const m = all[sweepIdx++ % all.length]; if (!batch.includes(m)) batch.push(m); }
      }
      if (batch.length) ingest(await ds('/tokens/v1/solana/' + batch.join(',')));
    }
    calls++;
  } catch (e) { console.log(e.message); }
  for (const m of pairsOf.keys()) { if (archive.has(m)) { rows.set(m, { ...archive.get(m) }); archive.delete(m); } derive(m); pending.delete(m); if (!before.has(m)) { before.add(m); newTokens++; } }
  pairsOf.clear();
}

await Promise.all(listLoops);
try { pumpWs?.close(); } catch {}
console.log('PumpPortal: tokens/migraciones recibidos en esta vuelta:', pumpSeen);
console.log('DEX pagados vistos en esta pasada:', paidSeen.size);

// 5) holders y launchpad desde Jupiter para los tokens con más volumen (100 por llamada)
async function jupStep(){ try {
  const top = [...rows.values()].sort((a,b) => (b.vol?.h24 || 0) - (a.vol?.h24 || 0)).slice(0, 1000).map(r => r.mint);
  for (let i = 0; i < top.length && timeLeft() > 2000; i += 100){
    const r = await fetch(JUP + '/tokens/v2/search?query=' + top.slice(i, i + 100).join(','));
    if (r.status === 429){ await sleep(3000); i -= 100; continue; }
    if (!r.ok) break;
    for (const t of await r.json()){
      const row = rows.get(t.id); if (!row) continue;
      const sc = k => t['stats' + k] || {};
      const pick = f => ({ h1: num(sc('1h')[f]), h6: num(sc('6h')[f]), h24: num(sc('24h')[f]) });
      row.jup = { hchg: pick('holderChange'), vchg: pick('volumeChange'), at: Date.now() };
      if (Number.isFinite(t.holderCount)) row.holders = t.holderCount;
      if (t.twitter) row.jupX = t.twitter; if (t.website) row.jupWeb = t.website;
      const jl = jupLaunchpad(t.launchpad); if (jl){ row.jupLp = jl; row.lp = jl; if (row.stage === 'dex') row.stage = 'grad'; }
    }
    await sleep(1200);
  }
} catch (e) { console.log('Jupiter:', e.message); } }
// 6) global fees (SOL pagados en comisiones por todos los traders) desde el servicio de datos de Jupiter:
//    los 1.000 con más volumen y otros 1.000 en rotación, así con el tiempo los tienen todos
const DATAPI = process.env.DATAPI_URL || 'https://datapi.jup.ag';
let feeIdx = prevActive?.feeIdx || 0, feesGot = 0;
async function feeStep(){
  try {
    const byVol = [...rows.values()].sort((a,b) => (b.vol?.h24 || 0) - (a.vol?.h24 || 0)).map(r => r.mint);
    const top = byVol.slice(0, 1000), rest = byVol.slice(1000), list = [...top];
    for (let k = 0; k < 1000 && k < rest.length; k++) list.push(rest[(feeIdx++) % rest.length]);
    for (let i = 0; i < list.length && timeLeft() > 0; i += 100){
      const r = await fetch(DATAPI + '/v1/assets/search?query=' + list.slice(i, i + 100).join(','));
      if (r.status === 429){ await sleep(3000); i -= 100; continue; }
      if (!r.ok) { console.log('Fees: HTTP', r.status); break; }
      for (const t of await r.json()){ const row = rows.get(t.id); if (row && Number.isFinite(t.fees)){ row.fees = Math.round(t.fees * 1000) / 1000; feesGot++; } }
      await sleep(250);
    }
  } catch (e) { console.log('Fees:', e.message); }
}
await Promise.all([jupStep(), feeStep()]);
console.log('Global fees actualizados:', feesGot);

await fs.mkdir(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const at = Date.now();
// activos = como DexScreener: con volumen en las últimas 24 h, o creados en las últimas 24 h
const isActive = r => (r.vol?.h24 || 0) > 0 || (r.created && at - r.created < 86400000);
for (const r of [...rows.values()]) if (!isActive(r)) {
  archive.set(r.mint, { mint:r.mint, symbol:r.symbol, name:r.name, img:r.img, pool:r.pool, dexId:r.dexId, lp:r.lp, created:r.created, mcap:r.mcap, holders:r.holders, fees:r.fees, x:r.x, site:r.site, paid:r.paid, seen:r.seen });
  rows.delete(r.mint);
}
for (const [m, t] of pending) if (at - t > 3600000) pending.delete(m);
await fs.writeFile(OUT, JSON.stringify({ at, termIdx, sweepIdx, archIdx, feeIdx, pending: [...pending], rows: [...rows.values()] }));
await fs.writeFile(OUT.replace(/tokens\.json$/, 'archive.json'), JSON.stringify({ at, rows: [...archive.values()] }));
console.log(`Activos: ${rows.size} · Histórico: ${archive.size} · Pendientes de PumpPortal: ${pending.size}`);
// new.json: solo lo nuevo y los DEX pagados de esta vuelta (pocos KB). La web lo consulta cada 30 s.
const fresh = [...rows.values()].filter(r => !startMints.has(r.mint) || paidSeen.has(r.mint));
await fs.writeFile(OUT.replace(/tokens\.json$/, 'new.json'), JSON.stringify({ at, rows: fresh }));
console.log(`Listo: ${rows.size} tokens (${newTokens} nuevos), ${calls} llamadas en ${Math.round((Date.now() - T0) / 1000)} s`);

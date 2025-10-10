// backend/src/modules/marketFeed.js
import fetch from 'node-fetch';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

/*
 Market feed order (free sources first):
 1) Yahoo Finance chart (no key) — robust if shaped correctly
 2) NSE India public endpoints (no key, may block)
 3) Twelve Data (optional, if TWELVEDATA_KEY set)
 4) Mock fallback
*/

// ---------- Tunables / Defaults ----------
const FEED_CONCURRENCY = Math.max(1, parseInt(process.env.FEED_CONCURRENCY || '8', 10));
const REQ_TIMEOUT_MS   = Math.max(3000, parseInt(process.env.FEED_TIMEOUT_MS || '10000', 10));
const Y_RANGE_INTRADAY = '1d';   // for interval=1m
const Y_INTERVAL       = '1m';
const PREV_RANGE       = '5d';   // for previous session calc
const PREV_INTERVAL    = '1d';
const UNIVERSE_CAP     = Math.max(1, parseInt(process.env.SYMBOL_UNIVERSE_SIZE || '500', 10));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------- Shared Headers ----------
const H_JSON = {
  'user-agent': UA,
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
};
const H_HTML = {
  'user-agent': UA,
  'accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

// ---------- Small Helpers ----------
function abortableTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(t),
  };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = REQ_TIMEOUT_MS) {
  const { signal, clear } = abortableTimeout(timeoutMs);
  try {
    return await fetch(url, { ...opts, signal });
  } finally {
    clear();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function backoff(attempt) {
  // base 400ms, capped, with jitter
  const base = 400;
  const max = 4000;
  const d = Math.min(max, base * Math.pow(2, attempt));
  return d + Math.floor(Math.random() * 200);
}

/** Run tasks over an array with bounded concurrency */
async function pool(items, limit, task) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await task(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

// ---------- Universe ----------
let SYMBOLS_CACHE = null;

async function fetchNifty500Symbols() {
  // Step 1: bootstrap cookie (NSE expects it)
  let cookie = '';
  try {
    const resp = await fetchWithTimeout('https://www.nseindia.com/', { headers: H_HTML, redirect: 'manual' });
    const setCookie = resp.headers.get('set-cookie') || '';
    cookie = setCookie
      .split(',')
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  } catch {
    // If this fails, try without cookie—the endpoint sometimes works.
  }

  const url = 'https://www.nseindia.com/api/index-constituents?index=NIFTY%20500';
  const res = await fetchWithTimeout(url, {
    headers: { ...H_JSON, cookie },
  });
  if (!res.ok) throw new Error(`NSE constituents HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const symbols = rows
    .map((r) => String(r?.symbol || '').trim().toUpperCase())
    .filter(Boolean);
  const unique = Array.from(new Set(symbols));
  return unique.slice(0, UNIVERSE_CAP);
}

async function getUniverseSymbols() {
  if (SYMBOLS_CACHE) return SYMBOLS_CACHE;
  // 1) Live NIFTY 500
  try {
    const live = await fetchNifty500Symbols();
    if (live.length) {
      SYMBOLS_CACHE = live;
      return SYMBOLS_CACHE;
    }
  } catch {}
  // 2) Local file fallback
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(here, '../data/nse_universe.json');
    const raw = await readFile(filePath, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) {
      SYMBOLS_CACHE = arr.map((s) => String(s).toUpperCase()).slice(0, UNIVERSE_CAP);
      return SYMBOLS_CACHE;
    }
  } catch {}
  // 3) Small default list
  SYMBOLS_CACHE = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'SBIN', 'BHARTIARTL',
    'ITC', 'LTIM', 'MARUTI', 'ASIANPAINT', 'AXISBANK', 'KOTAKBANK', 'ULTRACEMCO',
  ].slice(0, UNIVERSE_CAP);
  return SYMBOLS_CACHE;
}

// ---------- Random Mock ----------
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}
function genRow(symbol) {
  const open = Math.round(randomBetween(40, 2500) * 100) / 100;
  const pct = Math.round(randomBetween(-2, 4) * 100) / 100; // demo bias
  const ltp = Math.round(open * (1 + pct / 100) * 100) / 100;
  const volume = Math.floor(randomBetween(50_000, 2_000_000));
  return { symbol, open, ltp, volume, pct_change: pct };
}

// ---------- NSE Quote (fallback) ----------
async function fetchFromNSE(symbols) {
  // Bootstrap session cookie
  let cookie = '';
  try {
    const resp = await fetchWithTimeout('https://www.nseindia.com/', {
      headers: H_HTML, redirect: 'manual',
    });
    const setCookie = resp.headers.get('set-cookie') || '';
    cookie = setCookie
      .split(',')
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  } catch {}

  const results = [];
  await pool(symbols, FEED_CONCURRENCY, async (s) => {
    // retry per symbol a couple of times
    let attempt = 0;
    while (attempt < 2) {
      try {
        const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(s)}`;
        const res = await fetchWithTimeout(url, {
          headers: { ...H_JSON, referer: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(s)}`, cookie },
        });
        if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
        const data = await res.json();
        const p = data?.priceInfo || {};
        const open = Number(p?.open);
        const ltp = Number(p?.lastPrice ?? p?.close);
        const volume = Number(data?.securityInfo?.totalTradedVolume || data?.preOpenMarket?.totalTradedVolume || 0);
        const pct_change = Number(p?.pChange);
        if ([open, ltp, pct_change].every(Number.isFinite)) {
          results.push({
            symbol: s,
            open,
            ltp,
            volume: Number.isFinite(volume) ? volume : 0,
            pct_change,
          });
        }
        break; // success
      } catch {
        attempt += 1;
        if (attempt >= 2) break;
        await sleep(backoff(attempt - 1));
      }
    }
  });
  return results;
}

// ---------- Twelve Data (optional) ----------
async function fetchFromTwelveData(symbols) {
  const apiKey = process.env.TWELVEDATA_KEY;
  if (!apiKey) return null;

  async function tryFetch(formatFn) {
    const list = formatFn(symbols);
    const url = new URL('https://api.twelvedata.com/quote');
    url.searchParams.set('symbol', list);
    url.searchParams.set('apikey', apiKey);

    const res = await fetchWithTimeout(url.toString(), { headers: H_JSON });
    if (!res.ok) throw new Error(`TwelveData HTTP ${res.status}`);
    const data = await res.json();

    const entries = Array.isArray(data) ? data : data?.data ? data.data : data;
    const out = [];
    if (Array.isArray(entries)) {
      for (const item of entries) {
        if (!item || item.code || (!item.symbol && !item.name)) continue;
        const symbolRaw = String(item.symbol || item.name);
        const symbol = symbolRaw.replace(':NS', '').replace('NSE:', '').toUpperCase();
        const open = Number(item.open);
        const ltp = Number(item.price ?? item.close);
        const volume = Number(item.volume);
        const pct_change = Number(item.percent_change);
        if ([open, ltp, volume, pct_change].every(Number.isFinite)) {
          out.push({ symbol, open, ltp, volume, pct_change });
        }
      }
    } else if (entries && typeof entries === 'object') {
      for (const key of Object.keys(entries)) {
        const item = entries[key];
        if (!item || item.code) continue;
        const symbol = String(key).replace(':NS', '').replace('NSE:', '').toUpperCase();
        const open = Number(item.open);
        const ltp = Number(item.price ?? item.close);
        const volume = Number(item.volume);
        const pct_change = Number(item.percent_change);
        if ([open, ltp, volume, pct_change].every(Number.isFinite)) {
          out.push({ symbol, open, ltp, volume, pct_change });
        }
      }
    }
    return out;
  }

  // Attempt 1: NSE:SYMBOL
  let out = await tryFetch((arr) => arr.map((s) => `NSE:${s}`).join(','));
  if (!out || out.length === 0) {
    // Attempt 2: SYMBOL:NS
    out = await tryFetch((arr) => arr.map((s) => `${s}:NS`).join(','));
  }
  return out;
}

// ---------- Yahoo helpers ----------
function parseYahooIntraday(result) {
  // result.meta + result.indicators.quote[0]
  const meta = result?.meta || {};
  const quotes = result?.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quotes.open) ? quotes.open : [];
  const volumes = Array.isArray(quotes.volume) ? quotes.volume : [];

  // first valid open
  let firstOpen = NaN;
  for (let k = 0; k < opens.length; k++) {
    const o = Number(opens[k]);
    if (Number.isFinite(o)) { firstOpen = o; break; }
  }

  // LTP preference: regularMarketPrice -> previousClose
  const lastPrice = Number(meta.regularMarketPrice ?? meta.previousClose);

  // cumulative volume (or meta.regularMarketVolume if present)
  let cumVol = 0;
  for (let v of volumes) {
    const n = Number(v);
    if (Number.isFinite(n)) cumVol += n;
  }
  const metaVol = Number(meta.regularMarketVolume);
  const totalVolume = Number.isFinite(metaVol) && metaVol > 0 ? metaVol : cumVol;

  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const pct_change =
    Number.isFinite(lastPrice) && Number.isFinite(prevClose) && prevClose !== 0
      ? ((lastPrice - prevClose) / prevClose) * 100
      : NaN;

  return {
    open: firstOpen,
    ltp: lastPrice,
    volume: Number.isFinite(totalVolume) ? totalVolume : 0,
    pct_change,
  };
}

function parseYahooDaily(result) {
  // previous session calc from last two valid closes
  const q = result?.indicators?.quote?.[0] || {};
  const opens = Array.isArray(q.open) ? q.open : [];
  const closes = Array.isArray(q.close) ? q.close : [];
  const volumes = Array.isArray(q.volume) ? q.volume : [];

  const validIdx = [];
  for (let j = closes.length - 1; j >= 0 && validIdx.length < 2; j--) {
    const c = Number(closes[j]);
    const o = Number(opens[j]);
    if (Number.isFinite(c) && Number.isFinite(o)) validIdx.push(j);
  }
  if (validIdx.length < 2) return null;

  const idxPrev = validIdx[0];
  const idxPrevPrev = validIdx[1];

  const prevOpen = Number(opens[idxPrev]);
  const prevClose = Number(closes[idxPrev]);
  const prevVol = Number(volumes[idxPrev]);
  const priorClose = Number(closes[idxPrevPrev]);
  if (![prevOpen, prevClose, priorClose].every(Number.isFinite) || priorClose === 0) return null;

  const pct_change = ((prevClose - priorClose) / priorClose) * 100;
  return {
    open: prevOpen,
    ltp: prevClose,
    volume: Number.isFinite(prevVol) ? prevVol : 0,
    pct_change,
  };
}

// ---------- Yahoo fetchers ----------
async function fetchFromYahoo(symbols) {
  const out = [];
  await pool(symbols, FEED_CONCURRENCY, async (s) => {
    const ysym = `${s}.NS`;
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);
    url.searchParams.set('interval', Y_INTERVAL);
    url.searchParams.set('range', Y_RANGE_INTRADAY);
    url.searchParams.set('includePrePost', 'false');

    // up to 2 tries with backoff
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url.toString(), { headers: H_JSON });
        if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) break;

        const parsed = parseYahooIntraday(result);
        const { open, ltp, pct_change, volume } = parsed;
        if ([open, ltp, pct_change].every(Number.isFinite)) {
          out.push({ symbol: s, open, ltp, volume, pct_change });
        }
        break;
      } catch {
        if (attempt === 1) break;
        await sleep(backoff(attempt));
      }
    }
  });
  return out;
}

async function fetchPreviousSessionFromYahoo(symbols) {
  const out = [];
  await pool(symbols, FEED_CONCURRENCY, async (s) => {
    const ysym = `${s}.NS`;
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);
    url.searchParams.set('interval', PREV_INTERVAL);
    url.searchParams.set('range', PREV_RANGE);
    url.searchParams.set('includePrePost', 'false');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchWithTimeout(url.toString(), { headers: H_JSON });
        if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) break;

        const parsed = parseYahooDaily(result);
        if (parsed) {
          const { open, ltp, volume, pct_change } = parsed;
          out.push({ symbol: s, open, ltp, volume, pct_change });
        }
        break;
      } catch {
        if (attempt === 1) break;
        await sleep(backoff(attempt));
      }
    }
  });
  return out;
}

// ---------- Public API ----------
export async function getSnapshot() {
  try {
    const universe = await getUniverseSymbols();

    // 1) Yahoo intraday
    const y = await fetchFromYahoo(universe);
    if (Array.isArray(y) && y.length > 0) {
      // Deduplicate by symbol (keep first)
      const seen = new Set();
      const dedup = [];
      for (const row of y) {
        if (!row?.symbol || seen.has(row.symbol)) continue;
        seen.add(row.symbol);
        dedup.push(row);
      }
      return dedup;
    }

    // 2) NSE
    const nse = await fetchFromNSE(universe);
    if (Array.isArray(nse) && nse.length > 0) return nse;

    // 3) Twelve Data (if configured)
    const td = await fetchFromTwelveData(universe);
    if (Array.isArray(td) && td.length > 0) return td;
  } catch (err) {
    console.error('getSnapshot: live fetch failed, using mock. Reason:', err?.message || err);
  }

  // 4) Mock fallback (never empty)
  const universe = await getUniverseSymbols();
  return universe.map(genRow);
}

export async function getPreviousSessionSnapshot() {
  try {
    const universe = await getUniverseSymbols();
    const y = await fetchPreviousSessionFromYahoo(universe);
    if (Array.isArray(y) && y.length > 0) return y;
  } catch {}
  // Fallback to mock
  const universe = await getUniverseSymbols();
  return universe.map(genRow);
}

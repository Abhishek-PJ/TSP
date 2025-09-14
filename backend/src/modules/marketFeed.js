import fetch from 'node-fetch';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
// Market feed order (free sources first):
// 1) Yahoo Finance public endpoint (same data source used by yfinance) -> no key, stable
// 2) NSE India public endpoints (free, unofficial) -> may be blocked intermittently
// 3) Twelve Data (optional if TWELVEDATA_KEY set)
// 4) Mock fallback

let SYMBOLS_CACHE = null;
async function fetchNifty500Symbols() {
  // Bootstrap headers and cookie similar to fetchFromNSE
  const bootstrapUrl = 'https://www.nseindia.com/';
  const commonHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
  };
  let cookie = '';
  try {
    const resp = await fetch(bootstrapUrl, { headers: commonHeaders, redirect: 'manual' });
    const setCookie = resp.headers.get('set-cookie') || '';
    cookie = setCookie.split(',').map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  } catch {}

  const url = 'https://www.nseindia.com/api/index-constituents?index=NIFTY%20500';
  const res = await fetch(url, { headers: { ...commonHeaders, 'accept': 'application/json, text/plain, */*', cookie } });
  if (!res.ok) throw new Error(`NSE constituents HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const symbols = rows.map((r) => String(r?.symbol || '').trim().toUpperCase()).filter(Boolean);
  // De-duplicate and optionally cap size
  const unique = Array.from(new Set(symbols));
  const cap = Number(process.env.SYMBOL_UNIVERSE_SIZE || 500);
  return unique.slice(0, cap);
}

async function getUniverseSymbols() {
  if (SYMBOLS_CACHE) return SYMBOLS_CACHE;
  try {
    // Try live NIFTY 500 constituents first
    const live = await fetchNifty500Symbols();
    if (Array.isArray(live) && live.length > 0) {
      SYMBOLS_CACHE = live;
      return SYMBOLS_CACHE;
    }
  } catch {}
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const filePath = path.resolve(here, '../data/nse_universe.json');
    const raw = await readFile(filePath, 'utf-8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length > 0) {
      SYMBOLS_CACHE = arr.map((s) => String(s).toUpperCase());
      return SYMBOLS_CACHE;
    }
  } catch {}
  // Fallback small default list
  SYMBOLS_CACHE = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'HINDUNILVR', 'SBIN', 'BHARTIARTL', 'ITC', 'LTIM',
    'MARUTI', 'ASIANPAINT', 'AXISBANK', 'KOTAKBANK', 'ULTRACEMCO'
  ];
  return SYMBOLS_CACHE;
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function fetchFromNSE(symbols) {
  // NSE blocks requests without proper headers and a session cookie.
  // Step 1: bootstrap session by visiting the homepage to get cookies.
  const bootstrapUrl = 'https://www.nseindia.com/';
  const commonHeaders = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
  };
  const jar = { cookie: '' };
  try {
    const resp = await fetch(bootstrapUrl, { headers: commonHeaders, redirect: 'manual' });
    const setCookie = resp.headers.get('set-cookie') || '';
    jar.cookie = setCookie.split(',').map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  } catch (e) {
    // If bootstrap fails, proceed without cookie; some environments may still succeed.
  }

  const results = [];
  const limit = Number(process.env.FEED_CONCURRENCY || 8);
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      const s = symbols[i];
      try {
        const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(s)}`;
        const res = await fetch(url, {
          headers: {
            ...commonHeaders,
            'accept': 'application/json, text/plain, */*',
            'referer': `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(s)}`,
            'cookie': jar.cookie,
          },
        });
        if (!res.ok) throw new Error(`NSE HTTP ${res.status}`);
        const data = await res.json();
        const p = data?.priceInfo || {};
        const open = Number(p?.open);
        const ltp = Number(p?.lastPrice ?? p?.close);
        const volume = Number(data?.securityInfo?.totalTradedVolume || data?.preOpenMarket?.totalTradedVolume || 0);
        const pct_change = Number(p?.pChange);
        if ([open, ltp, pct_change].every((v) => isFinite(v))) {
          results.push({ symbol: s, open, ltp, volume: isFinite(volume) ? volume : 0, pct_change });
        }
      } catch (err) {
        // Skip symbol on failure
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, symbols.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function genRow(symbol) {
  const open = Math.round(randomBetween(40, 2500) * 100) / 100;
  // Bias some changes into the 0% to +4% range for demo
  const pct = Math.round(randomBetween(-2, 4) * 100) / 100;
  const ltp = Math.round(open * (1 + pct / 100) * 100) / 100;
  const volume = Math.floor(randomBetween(50_000, 2_000_000));
  return { symbol, open, ltp, volume, pct_change: pct };
}

async function fetchFromTwelveData(symbols) {
  const apiKey = process.env.TWELVEDATA_KEY;
  if (!apiKey) return null; // No API key configured

  async function tryFetch(buildListFn) {
    const list = buildListFn(symbols);
    const url = new URL('https://api.twelvedata.com/quote');
    url.searchParams.set('symbol', list);
    url.searchParams.set('apikey', apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`TwelveData HTTP ${res.status}`);
    }
    const data = await res.json();

    // Normalize structure: some responses return { data: [...] }, some return keyed object
    const entries = Array.isArray(data) ? data : data.data ? data.data : data;
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
        if ([open, ltp, volume, pct_change].every((v) => isFinite(v))) {
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
        if ([open, ltp, volume, pct_change].every((v) => isFinite(v))) {
          out.push({ symbol, open, ltp, volume, pct_change });
        }
      }
    }
    return out;
  }

  // Attempt 1: NSE:SYMBOL format
  let out = await tryFetch((arr) => arr.map((s) => `NSE:${s}`).join(','));
  if (!out || out.length === 0) {
    // Attempt 2: SYMBOL:NS format
    out = await tryFetch((arr) => arr.map((s) => `${s}:NS`).join(','));
  }
  return out;
}

async function fetchFromYahoo(symbols) {
  // Use chart endpoint per symbol with limited concurrency. Derive open from first 1m candle, LTP from meta.regularMarketPrice
  const out = [];
  const limit = Number(process.env.FEED_CONCURRENCY || 8);
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      const s = symbols[i];
      try {
        const ysym = `${s}.NS`;
        const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);
        url.searchParams.set('interval', '1m');
        url.searchParams.set('range', '1d');
        url.searchParams.set('includePrePost', 'false');
        const res = await fetch(url.toString(), {
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
          },
        });
        if (!res.ok) {
          continue;
        }
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) continue;
        const meta = result.meta || {};
        const quotes = result.indicators?.quote?.[0] || {};
        const opens = Array.isArray(quotes.open) ? quotes.open : [];
        const volumes = Array.isArray(quotes.volume) ? quotes.volume : [];
        const firstOpen = Number(opens.find((v) => isFinite(Number(v))));
        const lastPrice = Number(meta.regularMarketPrice ?? meta.previousClose);
        // Use cumulative intraday volume instead of the last 1m bar volume.
        // This aligns with our filter that expects total traded volume thresholds (e.g., >= 100,000).
        let cumVol = 0;
        for (let j = 0; j < volumes.length; j++) {
          const v = Number(volumes[j]);
          if (isFinite(v)) cumVol += v;
        }
        // Some Yahoo responses provide meta.regularMarketVolume; prefer it if present and valid
        const metaVol = Number(meta.regularMarketVolume);
        const totalVolume = isFinite(metaVol) && metaVol > 0 ? metaVol : cumVol;
        const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose);
        const pct_change = isFinite(lastPrice) && isFinite(prevClose) && prevClose !== 0
          ? ((lastPrice - prevClose) / prevClose) * 100
          : NaN;
        if ([firstOpen, lastPrice, pct_change].every((v) => isFinite(v))) {
          out.push({ symbol: s, open: firstOpen, ltp: lastPrice, volume: isFinite(totalVolume) ? totalVolume : 0, pct_change });
        }
      } catch {}
    }
  }
  const workers = Array.from({ length: Math.min(limit, symbols.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

export async function getSnapshot() {
  try {
    // 1) Yahoo Finance (yfinance-equivalent)
    const y = await fetchFromYahoo(await getUniverseSymbols());
    if (Array.isArray(y) && y.length > 0) return y;

    // 2) NSE free public endpoints (no API key)
    const nse = await fetchFromNSE(await getUniverseSymbols());
    if (Array.isArray(nse) && nse.length > 0) return nse;

    // 3) Twelve Data if API key is available
    const live = await fetchFromTwelveData(await getUniverseSymbols());
    if (Array.isArray(live) && live.length > 0) return live;
  } catch (err) {
    console.error('getSnapshot: live fetch failed, using mock. Reason:', err?.message || err);
  }

  // Fallback to mock data
  const data = (await getUniverseSymbols()).map(genRow);
  return data;
}

async function fetchPreviousSessionFromYahoo(symbols) {
  const out = [];
  const limit = Number(process.env.FEED_CONCURRENCY || 8);
  let idx = 0;
  async function worker() {
    while (idx < symbols.length) {
      const i = idx++;
      const s = symbols[i];
      const ysym = `${s}.NS`;
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);
      url.searchParams.set('interval', '1d');
      url.searchParams.set('range', '5d');
      url.searchParams.set('includePrePost', 'false');
      const res = await fetch(url.toString(), {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'accept': 'application/json, text/plain, */*',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const quote = result.indicators?.quote?.[0] || {};
      const opens = Array.isArray(quote.open) ? quote.open : [];
      const closes = Array.isArray(quote.close) ? quote.close : [];
      const volumes = Array.isArray(quote.volume) ? quote.volume : [];
      const validIdx = [];
      for (let j = closes.length - 1; j >= 0 && validIdx.length < 2; j--) {
        const c = Number(closes[j]);
        const o = Number(opens[j]);
        if (isFinite(c) && isFinite(o)) validIdx.push(j);
      }
      if (validIdx.length < 2) continue;
      const idxPrev = validIdx[0];
      const idxPrevPrev = validIdx[1];
      const prevOpen = Number(opens[idxPrev]);
      const prevClose = Number(closes[idxPrev]);
      const prevVol = Number(volumes[idxPrev]);
      const priorClose = Number(closes[idxPrevPrev]);
      if ([prevOpen, prevClose, priorClose].every((v) => isFinite(v)) && priorClose !== 0) {
        const pct_change = ((prevClose - priorClose) / priorClose) * 100;
        out.push({ symbol: s, open: prevOpen, ltp: prevClose, volume: isFinite(prevVol) ? prevVol : 0, pct_change });
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, symbols.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

export async function getPreviousSessionSnapshot() {
  try {
    const y = await fetchPreviousSessionFromYahoo(await getUniverseSymbols());
    if (Array.isArray(y) && y.length > 0) return y;
  } catch (err) {
    // ignore and fall through
  }
  // As a last resort, return mock so the app is never empty
  return (await getUniverseSymbols()).map(genRow);
}

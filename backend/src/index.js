import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import fetch from 'node-fetch';
import { getSnapshot, getPreviousSessionSnapshot } from './modules/marketFeed.js';
import { primaryFilter } from './modules/filters.js';
import { getNewsForSymbol } from './modules/newsFetcher.js';
import { aggregateSentiment } from './modules/sentimentService.js';
import { getCached, setCached, isRedisEnabled } from './modules/cache.js';
import { buildRecommendation, buildEnhancedRecommendations } from './modules/recommendationEngine.js';
import { checkAgnoHealth, getAgnoMetrics } from './modules/agnoClient.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Simple in-memory last snapshot
let lastSnapshot = { at: 0, data: [] };
// Cache last session picks to display during off-hours
let lastSessionPicks = { sessionDate: '', results: [], asOf: '' };

function nowInIST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

function isMarketOpenIST(d = nowInIST()) {
  const day = d.getUTCDay ? d.getUTCDay() : d.getDay(); // we already shifted, but getDay is fine
  // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = d.getHours();
  const m = d.getMinutes();
  const time = h * 60 + m; // minutes since midnight
  const open = 9 * 60 + 15;  // 09:15
  const close = 15 * 60 + 30; // 15:30
  return time >= open && time <= close;
}

function formatYMD(d = nowInIST()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function refreshSnapshot() {
  try {
    const data = await getSnapshot();
    lastSnapshot = { at: Date.now(), data };
  } catch (e) {
    console.error('refreshSnapshot failed', e.message || e);
  }
}

// Schedule snapshot refresh every 30 seconds during market hours 
cron.schedule('*/30 * * * * *', async () => {
  await refreshSnapshot();
});

app.get('/health', async (req, res) => {
  const agnoHealth = await checkAgnoHealth();
  const agnoMetrics = getAgnoMetrics();
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(), 
    redis: isRedisEnabled(),
    agno: agnoHealth,
    agnoMetrics,
  });
});

app.get('/api/snapshot', async (req, res) => {
  try {
    const now = Date.now();
    if (!lastSnapshot.at || now - lastSnapshot.at > 30_000) {
      const data = await getSnapshot();
      lastSnapshot = { at: now, data };
    }
    res.json(lastSnapshot);
  } catch (err) {
    console.error('snapshot error', err);
    res.status(500).json({ error: 'snapshot_failed' });
  }
});

app.get('/api/candidates', async (req, res) => {
  try {
    const now = Date.now();
    if (!lastSnapshot.at || now - lastSnapshot.at > 30_000) {
      const data = await getSnapshot();
      lastSnapshot = { at: now, data };
    }
    const candidates = lastSnapshot.data.filter(primaryFilter);
    res.json({ count: candidates.length, candidates });
  } catch (err) {
    console.error('candidates error', err);
    res.status(500).json({ error: 'candidates_failed' });
  }
});

app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `news:${symbol}`;
    const istNow = nowInIST();
    const marketOpen = isMarketOpenIST(istNow);

    const cached = await getCached(cacheKey);
    if (!marketOpen) {
      // Market closed: return cached news if available; do not fetch externally
      if (cached) return res.json({ source: 'cache', symbol, articles: cached, marketOpen: false });
      return res.json({ source: 'closed', symbol, articles: [], marketOpen: false });
    }

    if (cached) return res.json({ source: 'cache', symbol, articles: cached, marketOpen: true });

    const articles = await getNewsForSymbol(symbol);
    // cache for 10 minutes during market hours
    await setCached(cacheKey, articles, 10 * 60 * 1000);
    res.json({ source: 'live', symbol, articles, marketOpen: true });
  } catch (err) {
    console.error('news error', err);
    res.status(500).json({ error: 'news_failed' });
  }
});

app.get('/api/picks/today', async (req, res) => {
  try {
    const istNow = nowInIST();
    const marketOpen = isMarketOpenIST(istNow);
    const nowMs = Date.now();

    if (marketOpen) {
      if (!lastSnapshot.at || nowMs - lastSnapshot.at > 30_000) {
        const data = await getSnapshot();
        lastSnapshot = { at: nowMs, data };
      }
      const candidates = lastSnapshot.data.filter(primaryFilter);
      
      // Build news map for all candidates
      const newsMap = {};
      await Promise.all(
        candidates.map(async (row) => {
          const cacheKey = `news:${row.symbol}`;
          let articles = await getCached(cacheKey);
          if (!articles) {
            articles = await getNewsForSymbol(row.symbol);
            await setCached(cacheKey, articles, 10 * 60 * 1000);
          }
          newsMap[row.symbol] = articles;
        })
      );

      // Use enhanced recommendations with Agno + fallback
      const results = await buildEnhancedRecommendations(candidates, newsMap);
      
      // Add top headline to each result
      const resultsWithHeadlines = results.map(row => ({
        ...row,
        topHeadline: newsMap[row.symbol]?.[0]?.title || null,
      }));

      // Update lastSessionPicks cache continuously during market to have fresh at close
      lastSessionPicks = { sessionDate: formatYMD(istNow), results: resultsWithHeadlines, asOf: new Date(nowMs).toISOString() };
      res.json({ asOf: new Date(nowMs).toISOString(), marketOpen: true, count: resultsWithHeadlines.length, results: resultsWithHeadlines });
      return;
    }

    // Market closed: serve cached last session picks if present, else compute from previous session data
    if (lastSessionPicks.results.length > 0) {
      res.json({ asOf: lastSessionPicks.asOf, marketOpen: false, sessionDate: lastSessionPicks.sessionDate, count: lastSessionPicks.results.length, results: lastSessionPicks.results });
      return;
    }

    // Build from previous session snapshot without live news fetching
    const prev = await getPreviousSessionSnapshot();
    const candidates = prev.filter(primaryFilter);
    
    // Build news map from cache
    const newsMap = {};
    await Promise.all(
      candidates.map(async (row) => {
        const cacheKey = `news:${row.symbol}`;
        newsMap[row.symbol] = await getCached(cacheKey) || [];
      })
    );

    // Use enhanced recommendations (will fallback to VADER since no live Agno call needed)
    const results = await buildEnhancedRecommendations(candidates, newsMap);
    
    // Add top headline to each result
    const resultsWithHeadlines = results.map(row => ({
      ...row,
      topHeadline: newsMap[row.symbol]?.[0]?.title || null,
    }));

    lastSessionPicks = { sessionDate: formatYMD(istNow), results: resultsWithHeadlines, asOf: new Date(nowMs).toISOString() };
    res.json({ asOf: lastSessionPicks.asOf, marketOpen: false, sessionDate: lastSessionPicks.sessionDate, count: resultsWithHeadlines.length, results: resultsWithHeadlines });
  } catch (err) {
    console.error('picks error', err);
    res.status(500).json({ error: 'picks_failed' });
  }
});

// OHLC endpoint for candlestick charts
// Returns: { symbol, candles: [{ time, open, high, low, close, volume }] }
app.get('/api/ohlc/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol) return res.status(400).json({ error: 'symbol_required' });
    const ysym = `${symbol}.NS`;
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);
    // Reasonable defaults for a modal chart
    const interval = String(req.query.interval || '1d'); // 1m, 5m, 15m, 1h, 1d
    const range = String(req.query.range || '6mo'); // 1d,5d,1mo,3mo,6mo,1y,5y
    url.searchParams.set('interval', interval);
    url.searchParams.set('range', range);
    url.searchParams.set('includePrePost', 'false');

    const resp = await fetch(url.toString(), {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!resp.ok) {
      return res.status(502).json({ error: 'upstream_failed', status: resp.status });
    }
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'no_data' });
    const ts = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = Array.isArray(quote.open) ? quote.open : [];
    const highs = Array.isArray(quote.high) ? quote.high : [];
    const lows = Array.isArray(quote.low) ? quote.low : [];
    const closes = Array.isArray(quote.close) ? quote.close : [];
    const volumes = Array.isArray(quote.volume) ? quote.volume : [];

    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = Number(opens[i]);
      const h = Number(highs[i]);
      const l = Number(lows[i]);
      const c = Number(closes[i]);
      const v = Number(volumes[i]);
      if ([o, h, l, c].every((v) => isFinite(v))) {
        candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: isFinite(v) ? v : 0 });
      }
    }
    res.json({ symbol, interval, range, candles });
  } catch (err) {
    console.error('ohlc error', err);
    res.status(500).json({ error: 'ohlc_failed' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

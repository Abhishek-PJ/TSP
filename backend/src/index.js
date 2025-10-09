// backend/src/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import fetch from 'node-fetch';

import { getSnapshot, getPreviousSessionSnapshot } from './modules/marketFeed.js';
import { primaryFilter } from './modules/filters.js';
import { getNewsForSymbol } from './modules/newsFetcher.js';
import { getCached, setCached, isRedisEnabled } from './modules/cache.js';
import { buildEnhancedRecommendations } from './modules/recommendationEngine.js';
import { checkAgnoPredictionHealth as checkAgnoHealth, getAgnoMetrics } from './modules/agnoClient.js';

dotenv.config();

/**
 * NEW knobs:
 *  - OFFHOURS_NEWS_FETCH: if true, we are allowed to fetch news when market is closed
 *  - LAST_SESSION_TTL_MS: how long to persist last session picks in Redis (default 20 hours)
 */
const OFFHOURS_NEWS_FETCH = String(process.env.OFFHOURS_NEWS_FETCH ?? 'true').toLowerCase() === 'true';
const LAST_SESSION_TTL_MS = Math.max(60_000, parseInt(process.env.LAST_SESSION_TTL_MS ?? `${20 * 60 * 60 * 1000}`, 10));

const app = express();
app.use(cors());
app.use(express.json());

// Dynamic responses: disable caches
app.use((_, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// In-memory snapshot + last-session cache (we also persist last session to Redis)
let lastSnapshot = { at: 0, data: [] };
let lastSessionPicks = { sessionDate: '', results: [], asOf: '' };

// --- Time helpers (IST) ---
function nowInIST() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}
function isMarketOpenIST(d = nowInIST()) {
  // IST local day/hour
  const day = d.getDay(); // 0=Sun..6=Sat
  if (day === 0 || day === 6) return false;
  const h = d.getHours();
  const m = d.getMinutes();
  const minutes = h * 60 + m;
  const open = 9 * 60 + 15;   // 09:15
  const close = 15 * 60 + 30; // 15:30
  return minutes >= open && minutes <= close;
}
function formatYMD(d = nowInIST()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// --- Snapshot refresh (only during market hours) ---
async function refreshSnapshot() {
  try {
    if (!isMarketOpenIST()) return;
    const data = await getSnapshot();
    lastSnapshot = { at: Date.now(), data };
  } catch (e) {
    console.error('refreshSnapshot failed', e?.message || e);
  }
}

// Every 30s, but only effective during market hours
cron.schedule('*/30 * * * * *', refreshSnapshot);

/**
 * NEW: End-of-day (EOD) job
 * Runs at 15:35 IST to compute and persist a "last session" pickset with live news (so UI is rich off-hours).
 * Adjust cron if your infra timezone differs; here we approximate IST by server clock + helper.
 */
cron.schedule('35 15 * * 1-5', async () => {
  try {
    const istNow = nowInIST();
    if (isMarketOpenIST(istNow)) return; // safety
    // Use latest live snapshot (refresh if stale)
    if (!lastSnapshot.at || Date.now() - lastSnapshot.at > 60_000) {
      const data = await getSnapshot();
      lastSnapshot = { at: Date.now(), data };
    }
    const candidates = lastSnapshot.data.filter(primaryFilter).sort((a, b) => b.pct_change - a.pct_change);
    const topCandidates = candidates.slice(0, 50);

    // Fetch fresh news even off-hours (EOD build)
    const newsMap = {};
    await Promise.all(
      topCandidates.map(async (row) => {
        const key = `news:${row.symbol}`;
        let articles = await getCached(key);
        if (!articles || OFFHOURS_NEWS_FETCH) {
          // refresh cache EOD
          articles = await getNewsForSymbol(row.symbol);
          await setCached(key, articles, 10 * 60 * 1000);
        }
        newsMap[row.symbol] = articles;
      })
    );

    const enriched = await buildEnhancedRecommendations(topCandidates, newsMap);
    const withHeadlines = enriched.map((row) => ({
      ...row,
      topHeadline: newsMap[row.symbol]?.[0]?.title || null,
    }));

    lastSessionPicks = {
      sessionDate: formatYMD(istNow),
      results: withHeadlines,
      asOf: new Date().toISOString(),
    };
    // persist to Redis so a server restart still has off-hours data
    await setCached('last:session:picks', lastSessionPicks, LAST_SESSION_TTL_MS);

    console.log(`[EOD] persisted last session picks for ${lastSessionPicks.sessionDate} (${withHeadlines.length} rows)`);
  } catch (e) {
    console.error('[EOD] build failed:', e?.message || e);
  }
});

// --- Health ---
app.get('/health', async (_req, res) => {
  const agnoHealth = await checkAgnoHealth();
  const agnoMetrics = getAgnoMetrics?.() || {};
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    redis: isRedisEnabled(),
    agno: agnoHealth,
    agnoMetrics,
    uptimeSec: Math.floor(process.uptime()),
  });
});

// --- Snapshot ---
app.get('/api/snapshot', async (req, res) => {
  try {
    const force = String(req.query.refresh || '').toLowerCase() === 'true';
    const now = Date.now();
    if (force || !lastSnapshot.at || now - lastSnapshot.at > 30_000) {
      const data = await getSnapshot();
      lastSnapshot = { at: now, data };
    }
    res.json(lastSnapshot);
  } catch (err) {
    console.error('snapshot error', err);
    res.status(500).json({ error: 'snapshot_failed' });
  }
});

// --- Candidates (primary filter) ---
app.get('/api/candidates', async (_req, res) => {
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

// --- News for a symbol (allow off-hours refresh if enabled) ---
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `news:${symbol}`;
    const istNow = nowInIST();
    const marketOpen = isMarketOpenIST(istNow);

    const cached = await getCached(cacheKey);

    if (!marketOpen) {
      if (OFFHOURS_NEWS_FETCH) {
        // allow refresh off-hours if enabled
        const articles = await getNewsForSymbol(symbol);
        await setCached(cacheKey, articles, 10 * 60 * 1000);
        return res.json({ source: 'offhours_live', symbol, articles, marketOpen: false });
      }
      // strict cache-only off-hours
      if (cached) return res.json({ source: 'cache', symbol, articles: cached, marketOpen: false });
      return res.json({ source: 'closed', symbol, articles: [], marketOpen: false });
    }

    if (cached) return res.json({ source: 'cache', symbol, articles: cached, marketOpen: true });

    const articles = await getNewsForSymbol(symbol);
    await setCached(cacheKey, articles, 10 * 60 * 1000); // 10 min
    res.json({ source: 'live', symbol, articles, marketOpen: true });
  } catch (err) {
    console.error('news error', err);
    res.status(500).json({ error: 'news_failed' });
  }
});

// --- Picks (today) ---
app.get('/api/picks/today', async (req, res) => {
  try {
    const istNow = nowInIST();
    const marketOpen = isMarketOpenIST(istNow);
    const nowMs = Date.now();
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';

    if (marketOpen || forceRefresh) {
      if (forceRefresh || !lastSnapshot.at || nowMs - lastSnapshot.at > 30_000) {
        const data = await getSnapshot();
        lastSnapshot = { at: nowMs, data };
      }

      // Primary candidates
      const candidates = lastSnapshot.data.filter(primaryFilter);
      const sortedCandidates = candidates.slice().sort((a, b) => b.pct_change - a.pct_change);

      // Analyze up to 50 (enough to fill top 5 per bucket after sentiment)
      const topCandidates = sortedCandidates.slice(0, 50);
      const newsMap = {};

      // Fetch news for just the ones we'll analyze (cache where possible)
      await Promise.all(
        topCandidates.map(async (row) => {
          const key = `news:${row.symbol}`;
          let articles = await getCached(key);
          if (!articles) {
            articles = await getNewsForSymbol(row.symbol);
            await setCached(key, articles, 10 * 60 * 1000);
          }
          newsMap[row.symbol] = articles;
        })
      );

      // Agno + fallback (VADER) recommendation enrichment
      const enriched = await buildEnhancedRecommendations(topCandidates, newsMap);

      // Attach top headline
      const withHeadlines = enriched.map((row) => ({
        ...row,
        topHeadline: newsMap[row.symbol]?.[0]?.title || null,
      }));

      // Cache for off-hours serving (memory + Redis)
      lastSessionPicks = {
        sessionDate: formatYMD(istNow),
        results: withHeadlines,
        asOf: new Date(nowMs).toISOString(),
      };
      await setCached('last:session:picks', lastSessionPicks, LAST_SESSION_TTL_MS);

      res.json({
        asOf: new Date(nowMs).toISOString(),
        marketOpen: true,
        count: withHeadlines.length,
        totalCandidates: candidates.length,
        results: withHeadlines,
      });
      return;
    }

    // Market closed → prefer in-memory last session picks
    if (lastSessionPicks.results.length > 0) {
      res.json({
        asOf: lastSessionPicks.asOf,
        marketOpen: false,
        sessionDate: lastSessionPicks.sessionDate,
        count: lastSessionPicks.results.length,
        results: lastSessionPicks.results,
      });
      return;
    }

    // Try Redis persisted last session
    const redisLast = await getCached('last:session:picks');
    if (redisLast && Array.isArray(redisLast.results) && redisLast.results.length > 0) {
      lastSessionPicks = redisLast;
      res.json({
        asOf: lastSessionPicks.asOf,
        marketOpen: false,
        sessionDate: lastSessionPicks.sessionDate,
        count: lastSessionPicks.results.length,
        results: lastSessionPicks.results,
      });
      return;
    }

    // Rebuild from previous session; optionally fetch fresh news off-hours
    const prev = await getPreviousSessionSnapshot();
    const candidates = prev.filter(primaryFilter).sort((a, b) => b.pct_change - a.pct_change);
    const topCandidates = candidates.slice(0, 50);

    const newsMap = {};
    await Promise.all(
      topCandidates.map(async (row) => {
        const key = `news:${row.symbol}`;
        let articles = await getCached(key);
        if ((!articles || articles.length === 0) && OFFHOURS_NEWS_FETCH) {
          // warm cache off-hours if allowed
          articles = await getNewsForSymbol(row.symbol);
          await setCached(key, articles, 10 * 60 * 1000);
        }
        newsMap[row.symbol] = articles || [];
      })
    );

    const enriched = await buildEnhancedRecommendations(topCandidates, newsMap);
    const withHeadlines = enriched.map((row) => ({
      ...row,
      topHeadline: newsMap[row.symbol]?.[0]?.title || null,
    }));

    lastSessionPicks = {
      sessionDate: formatYMD(istNow),
      results: withHeadlines,
      asOf: new Date(nowMs).toISOString(),
    };
    await setCached('last:session:picks', lastSessionPicks, LAST_SESSION_TTL_MS);

    res.json({
      asOf: lastSessionPicks.asOf,
      marketOpen: false,
      sessionDate: lastSessionPicks.sessionDate,
      count: withHeadlines.length,
      totalCandidates: candidates.length,
      results: withHeadlines,
    });
  } catch (err) {
    console.error('picks error', err);
    res.status(500).json({ error: 'picks_failed' });
  }
});

// --- OHLC for candles ---
app.get('/api/ohlc/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol) return res.status(400).json({ error: 'symbol_required' });

    const ysym = `${symbol}.NS`;
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`);

    const interval = String(req.query.interval || '1d'); // 1m, 5m, 15m, 1h, 1d
    const range = String(req.query.range || '6mo');     // 1d,5d,1mo,3mo,6mo,1y,5y
    url.searchParams.set('interval', interval);
    url.searchParams.set('range', range);
    url.searchParams.set('includePrePost', 'false');

    const resp = await fetch(url.toString(), { headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
    }});
    if (!resp.ok) return res.status(502).json({ error: 'upstream_failed', status: resp.status });

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
      if ([o, h, l, c].every(Number.isFinite)) {
        candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
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

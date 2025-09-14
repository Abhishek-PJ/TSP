import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import { getSnapshot, getPreviousSessionSnapshot } from './modules/marketFeed.js';
import { primaryFilter } from './modules/filters.js';
import { getNewsForSymbol } from './modules/newsFetcher.js';
import { aggregateSentiment } from './modules/sentimentService.js';
import { getCached, setCached, isRedisEnabled } from './modules/cache.js';
import { buildRecommendation } from './modules/recommendationEngine.js';

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

// Schedule snapshot refresh every 30 seconds during market hours (every minute of every day for demo)
cron.schedule('*/30 * * * * *', async () => {
  await refreshSnapshot();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), redis: isRedisEnabled() });
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
      const results = await Promise.all(
        candidates.map(async (row) => {
          const cacheKey = `news:${row.symbol}`;
          let articles = await getCached(cacheKey);
          if (!articles) {
            articles = await getNewsForSymbol(row.symbol);
            await setCached(cacheKey, articles, 10 * 60 * 1000);
          }
          const sentiment = aggregateSentiment(articles);
          const rec = buildRecommendation(row, sentiment);
          return { ...row, sentiment, recommendation: rec, topHeadline: articles[0]?.title || null };
        })
      );
      // Update lastSessionPicks cache continuously during market to have fresh at close
      lastSessionPicks = { sessionDate: formatYMD(istNow), results, asOf: new Date(nowMs).toISOString() };
      res.json({ asOf: new Date(nowMs).toISOString(), marketOpen: true, count: results.length, results });
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
    const results = await Promise.all(
      candidates.map(async (row) => {
        const cacheKey = `news:${row.symbol}`;
        const articles = await getCached(cacheKey) || [];
        const sentiment = aggregateSentiment(articles);
        const rec = buildRecommendation(row, sentiment);
        return { ...row, sentiment, recommendation: rec, topHeadline: articles[0]?.title || null };
      })
    );
    lastSessionPicks = { sessionDate: formatYMD(istNow), results, asOf: new Date(nowMs).toISOString() };
    res.json({ asOf: lastSessionPicks.asOf, marketOpen: false, sessionDate: lastSessionPicks.sessionDate, count: results.length, results });
  } catch (err) {
    console.error('picks error', err);
    res.status(500).json({ error: 'picks_failed' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

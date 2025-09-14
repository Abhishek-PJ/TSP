// Real news fetcher: NewsAPI (if key present) -> Google News RSS fallback
// Returns last-48h articles for a symbol as {title, summary, url, publishedAt}

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';

function buildQuery(symbol) {
  // Convert symbol to company name if needed, or use as is
  // For now, we'll just use the symbol as the query
  return `"${symbol}" OR "${symbol}.NS"`;
}

const HORIZON_MS = 48 * 3600 * 1000;

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

function within48h(dateStr) {
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) && (Date.now() - t) <= HORIZON_MS;
}

function dedupeArticles(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = (it.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

async function fetchNewsAPI(symbol) {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];
  const query = encodeURIComponent(buildQuery(symbol));
  const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`;
  const res = await fetchWithTimeout(url, undefined, 8000);
  if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
  const data = await res.json();
  const articles = (data.articles || []).map(a => ({
    title: a.title || '',
    summary: a.description || a.content || '',
    url: a.url,
    publishedAt: a.publishedAt || a.__publishedAt || new Date().toISOString(),
  })).filter(a => a.url && within48h(a.publishedAt));
  return dedupeArticles(articles);
}

async function fetchGoogleNewsRSS(symbol) {
  // Google News RSS query
  const q = encodeURIComponent(buildQuery(symbol));
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
    },
  }, 8000);
  if (!res.ok) throw new Error(`GoogleRSS HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  const articles = items.map(it => ({
    title: it.title || '',
    summary: (it.description || '').replace(/<[^>]+>/g, ''),
    url: it.link,
    publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
  })).filter(a => a.url && within48h(a.publishedAt));
  return dedupeArticles(articles);
}

async function fetchBingNewsRSS(symbol) {
  // Bing News RSS as secondary fallback
  const q = encodeURIComponent(buildQuery(symbol));
  const url = `https://www.bing.com/news/search?q=${q}&setlang=en-IN&format=rss`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
  }, 8000);
  if (!res.ok) throw new Error(`BingRSS HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item || [];
  const articles = items.map(it => ({
    title: it.title || '',
    summary: (it.description || '').replace(/<[^>]+>/g, ''),
    url: it.link,
    publishedAt: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
  })).filter(a => a.url && within48h(a.publishedAt));
  return dedupeArticles(articles);
}

export async function getNewsForSymbol(symbol) {
  // Try NewsAPI first if key provided, else fall back to Google News RSS
  try {
    const primary = await fetchNewsAPI(symbol);
    if (primary.length > 0) return primary;
  } catch (e) {
    console.warn(`[news] NewsAPI failed for ${symbol}, falling back to RSS:`, e.message || e);
  }
  try {
    // Simple retry on Google RSS to handle transient DNS/edge failures
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const rss = await fetchGoogleNewsRSS(symbol);
        return rss;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('google_rss_failed');
  } catch (e) {
    console.warn(`[news] Google News RSS failed for ${symbol}, trying Bing RSS:`, e.message || e);
    try {
      const bing = await fetchBingNewsRSS(symbol);
      return bing;
    } catch (e2) {
      console.warn(`[news] Bing RSS also failed for ${symbol}:`, e2.message || e2);
      return [];
    }
  }
}

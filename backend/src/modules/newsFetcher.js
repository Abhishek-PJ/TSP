// Real news fetcher: NewsAPI (if key present) -> RSS fallback
// Returns last-48h articles for a symbol as {title, summary, url, publishedAt}

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';

function buildQuery(symbol) {
  // You can enhance this to map symbols to company names if you have a mapping.
  return `"${symbol}" OR "${symbol}.NS" OR "NSE:${symbol}" OR "${symbol} stock" OR "${symbol} share"`;
}

const HORIZON_MS = 48 * 3600 * 1000;

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
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

const stripTags = (html = '') => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const toISO = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt) ? null : dt.toISOString();
};

function isFresh(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && (Date.now() - t) <= HORIZON_MS && t <= Date.now();
}

function normalizeItem({ title, summary, url, publishedAt }) {
  const cleanTitle = (title || '').trim();
  const cleanSummary = stripTags(summary || '').slice(0, 400);
  const iso = toISO(publishedAt);
  return { title: cleanTitle, summary: cleanSummary, url, publishedAt: iso };
}

function sortByNewest(items) {
  return [...items].sort((a, b) => (new Date(b.publishedAt) - new Date(a.publishedAt)));
}

/* =========================
   NewsAPI (preferred)
   ========================= */
async function fetchNewsAPI(symbol) {
  const key = process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY;
  if (!key) return [];

  const q = buildQuery(symbol);
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', q);
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '30');

  const r = await fetchWithTimeout(url.toString(), {
    headers: { 'X-Api-Key': key, 'Accept': 'application/json' },
  }, 10000);

  if (!r.ok) throw new Error(`NewsAPI HTTP ${r.status}`);
  const data = await r.json();
  const articles = Array.isArray(data?.articles) ? data.articles : [];

  const mapped = articles.map((a) =>
    normalizeItem({
      title: a.title,
      summary: a.description || a.content || '',
      url: a.url,
      publishedAt: a.publishedAt,
    })
  ).filter(a => a.title && a.url && isFresh(a.publishedAt));

  return sortByNewest(dedupeArticles(mapped));
}

/* =========================
   RSS helpers
   ========================= */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  trimValues: true,
});

function parseRSS(xml) {
  const obj = parser.parse(xml);
  // Support both RSS and Atom-ish shapes
  const channelItems = obj?.rss?.channel?.item;
  const feedEntries = obj?.feed?.entry;
  if (Array.isArray(channelItems)) return channelItems;
  if (Array.isArray(feedEntries)) return feedEntries;
  return [];
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'object') {
      // handle arrays like [{...}] or strings inside arrays
      if (Array.isArray(v) && v.length) {
        const first = v[0];
        if (typeof first === 'string') return first;
        if (typeof first === 'object') {
          // try common link shapes
          if (first.href) return first.href;
          if (first.link) return first.link;
        }
      }
    }
  }
  return undefined;
}

/* =========================
   Google News RSS
   ========================= */
async function fetchGoogleNewsRSS(symbol) {
  const q = buildQuery(symbol);
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', q);
  url.searchParams.set('hl', 'en-IN');
  url.searchParams.set('gl', 'IN');
  url.searchParams.set('ceid', 'IN:en');

  const r = await fetchWithTimeout(url.toString(), { headers: { 'Accept': 'application/rss+xml, application/xml' } });
  if (!r.ok) throw new Error(`Google News RSS HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseRSS(xml);

  const mapped = items.map((it) => {
    const title = it.title || it['media:title'] || '';
    const url = pickFirst(it.link, it.guid, it?.source?.url) || '';
    const publishedAt = it.pubDate || it.published || it.updated || '';
    const summary = it.description || it.summary || '';
    return normalizeItem({ title, summary, url, publishedAt });
  }).filter(a => a.title && a.url && isFresh(a.publishedAt));

  return sortByNewest(dedupeArticles(mapped));
}

/* =========================
   Yahoo Finance RSS (per symbol)
   ========================= */
async function fetchYahooFinanceRSS(symbol) {
  const ysym = `${symbol}.NS`;
  const url = new URL('https://feeds.finance.yahoo.com/rss/2.0/headline');
  url.searchParams.set('s', ysym);
  url.searchParams.set('region', 'IN');
  url.searchParams.set('lang', 'en-IN');

  const r = await fetchWithTimeout(url.toString(), { headers: { 'Accept': 'application/rss+xml, application/xml' } });
  if (!r.ok) throw new Error(`Yahoo Finance RSS HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseRSS(xml);

  const mapped = items.map((it) => {
    const title = it.title || '';
    const url = pickFirst(it.link, it.guid) || '';
    const publishedAt = it.pubDate || '';
    const summary = it.description || '';
    return normalizeItem({ title, summary, url, publishedAt });
  }).filter(a => a.title && a.url && isFresh(a.publishedAt));

  return sortByNewest(dedupeArticles(mapped));
}

/* =========================
   Economic Times RSS (site-wide search feed)
   ========================= */
async function fetchEconomicTimesRSS(symbol) {
  // ET RSS search is not officially documented; use Google News ET section as a fallback pattern if needed.
  // Here we query site: URLs through Google News itself filtered to economictimes.com
  const q = `${buildQuery(symbol)} site:economictimes.com`;
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', q);
  url.searchParams.set('hl', 'en-IN');
  url.searchParams.set('gl', 'IN');
  url.searchParams.set('ceid', 'IN:en');

  const r = await fetchWithTimeout(url.toString(), { headers: { 'Accept': 'application/rss+xml, application/xml' } });
  if (!r.ok) throw new Error(`Economic Times RSS via Google News HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseRSS(xml);

  const mapped = items.map((it) => {
    const title = it.title || '';
    const url = pickFirst(it.link, it.guid) || '';
    const publishedAt = it.pubDate || '';
    const summary = it.description || '';
    return normalizeItem({ title, summary, url, publishedAt });
  }).filter(a => a.title && a.url && isFresh(a.publishedAt) && /economictimes\.com/i.test(a.url));

  return sortByNewest(dedupeArticles(mapped));
}

/* =========================
   Bing News RSS
   ========================= */
async function fetchBingNewsRSS(symbol) {
  const q = buildQuery(symbol);
  const url = new URL('https://www.bing.com/news/search');
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'rss');

  const r = await fetchWithTimeout(url.toString(), { headers: { 'Accept': 'application/rss+xml, application/xml' } });
  if (!r.ok) throw new Error(`Bing News RSS HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseRSS(xml);

  const mapped = items.map((it) => {
    const title = it.title || '';
    const url = pickFirst(it.link, it.guid) || '';
    const publishedAt = it.pubDate || it.updated || '';
    const summary = it.description || it.summary || '';
    return normalizeItem({ title, summary, url, publishedAt });
  }).filter(a => a.title && a.url && isFresh(a.publishedAt));

  return sortByNewest(dedupeArticles(mapped));
}

/* =========================
   Public API
   ========================= */
export async function getNewsForSymbol(symbol) {
  console.log(`[news] Starting news fetch for ${symbol}`);

  // 1) Prefer NewsAPI if available
  try {
    const primary = await fetchNewsAPI(symbol);
    if (primary.length > 0) {
      console.log(`[news] Found ${primary.length} articles from NewsAPI for ${symbol}`);
      return primary;
    } else {
      console.log(`[news] NewsAPI returned no recent items for ${symbol}`);
    }
  } catch (e) {
    console.warn(`[news] NewsAPI failed for ${symbol}:`, e.message || e);
  }

  // 2) RSS fallbacks in order of reliability
  const sources = [
    { name: 'Google News', fetcher: fetchGoogleNewsRSS },
    { name: 'Yahoo Finance', fetcher: fetchYahooFinanceRSS },
    { name: 'Economic Times', fetcher: fetchEconomicTimesRSS },
    { name: 'Bing News', fetcher: fetchBingNewsRSS },
  ];

  for (const source of sources) {
    try {
      console.log(`[news] Trying ${source.name} for ${symbol}`);
      const articles = await source.fetcher(symbol);
      if (articles.length > 0) {
        console.log(`[news] Found ${articles.length} articles from ${source.name} for ${symbol}`);
        return articles;
      } else {
        console.log(`[news] No articles found from ${source.name} for ${symbol}`);
      }
    } catch (e) {
      console.warn(`[news] ${source.name} failed for ${symbol}:`, e.message || e);
    }
  }

  console.log(`[news] No news found for ${symbol} from any source`);
  return [];
}

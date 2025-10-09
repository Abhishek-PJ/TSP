// backend/src/modules/sentimentService.js
// VADER sentiment analysis implementation
// Uses vader-sentiment to compute polarity scores per article and aggregates them.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const vader = require('vader-sentiment');

// ---- Tunables ----
const POS_THRESHOLD = 0.05;   // VADER convention
const NEG_THRESHOLD = -0.05;  // VADER convention
const TITLE_WEIGHT  = 0.7;    // Title importance vs summary (0..1)

// ---- Utils ----
const stripTags = (html = '') => String(html).replace(/<[^>]*>/g, ' ');
const squash = (s = '') => s.replace(/\s+/g, ' ').trim();
const clampUnit = (n) => Math.max(-1, Math.min(1, Number.isFinite(n) ? n : 0));

function buildArticleText(article) {
  const title = squash(stripTags(article?.title ?? ''));
  const summary = squash(stripTags(article?.summary ?? ''));
  if (!title && !summary) return '';
  if (!summary) return title;
  if (!title) return summary;

  // Weighted join: emphasize title while keeping summary context
  // (VADER is not linear on text length, so we emulate weighting by repetition)
  // Repeat title proportionally to weight; keep summary once.
  const repeats = Math.max(1, Math.round(TITLE_WEIGHT * 3)); // small, bounded
  return `${Array.from({ length: repeats }, () => title).join('. ')}. ${summary}`;
}

// ---- Scoring for a single article ----
export function scoreArticle(article) {
  try {
    const text = buildArticleText(article);
    if (!text) return { compound: 0 };
    const { compound } = vader.SentimentIntensityAnalyzer.polarity_scores(text);
    return { compound: clampUnit(compound) };
  } catch {
    return { compound: 0 };
  }
}

// ---- Aggregate across articles ----
export function aggregateSentiment(articles) {
  try {
    const list = Array.isArray(articles) ? articles : [];
    if (list.length === 0) return { compound: 0, label: 'Neutral', count: 0 };

    // Deduplicate by normalized title to reduce syndication double-counts
    const seen = new Set();
    const deduped = [];
    for (const a of list) {
      const key = squash(stripTags(a?.title ?? '')).toLowerCase();
      if (!key) { deduped.push(a); continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
    }

    // Score each, ignore pathological NaNs
    const scores = deduped.map(scoreArticle).map((s) => clampUnit(s.compound));
    if (scores.length === 0) return { compound: 0, label: 'Neutral', count: 0 };

    const sum = scores.reduce((acc, v) => acc + v, 0);
    const compound = clampUnit(sum / scores.length);

    let label = 'Neutral';
    if (compound >= POS_THRESHOLD) label = 'Positive';
    else if (compound <= NEG_THRESHOLD) label = 'Negative';

    return { compound, label, count: deduped.length };
  } catch {
    return { compound: 0, label: 'Neutral', count: 0 };
  }
}

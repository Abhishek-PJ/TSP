// backend/src/modules/recommendationEngine.js
// Cheap first-pass sentiment using VADER; send only hard/impactful cases to Agno (LLM).

import { getAgnoPicks } from './agnoClient.js';
import { aggregateSentiment } from './sentimentService.js';

/* =========================
   Tunables (env overridable)
   ========================= */
const VADER_NEUTRAL_BAND = Number(process.env.VADER_NEUTRAL_BAND ?? 0.20); // |compound| < 0.20 -> neutral-ish
const PRICE_CONFLICT_BAND = Number(process.env.PRICE_CONFLICT_BAND ?? 1.0); // % move that triggers conflict detection
const BIG_MOVE_PCT = Number(process.env.BIG_MOVE_PCT ?? 3.0);              // abs(% change) considered "big"
const HIGH_VOLUME = Number(process.env.HIGH_VOLUME_THRESHOLD ?? 1_000_000); // very high volume flag
const REQUIRE_NEWS_FOR_LLM = String(process.env.REQUIRE_NEWS_FOR_LLM ?? 'false').toLowerCase() === 'true';
const AGNO_MAX_PER_BATCH = Math.max(1, Number(process.env.AGNO_MAX_PER_BATCH ?? 100)); // extra safety cap

/* =========================
   Utilities
   ========================= */
const clampUnit = (n) => Math.max(-1, Math.min(1, Number.isFinite(n) ? n : 0));

const vaderToRec = (label) => {
  const v = String(label || '').toLowerCase();
  if (v === 'positive') return 'BULLISH';
  if (v === 'negative') return 'SKIP';
  return 'WATCH';
};

const normRec = (label) => {
  const v = String(label || '').toUpperCase();
  if (v === 'BULLISH') return 'BULLISH';
  if (v === 'SKIP') return 'SKIP';
  return 'WATCH';
};

function mapAgnoLabelToVader(agnoLabel) {
  switch (String(agnoLabel || '').toUpperCase()) {
    case 'BULLISH': return 'Positive';
    case 'SKIP':    return 'Negative';
    default:        return 'Neutral';
  }
}

function generateVaderReason(sentiment, articleCount) {
  const count = Number.isFinite(articleCount) ? articleCount : 0;
  if (count === 0) return 'No recent news available';
  const label = String(sentiment?.label || 'Neutral');
  const score = Math.abs(Number(sentiment?.compound || 0)).toFixed(2);
  if (label === 'Positive') return `Positive sentiment (${score}) across ${count} articles`;
  if (label === 'Negative') return `Negative sentiment (${score}) across ${count} articles`;
  return `Neutral sentiment across ${count} articles`;
}

/**
 * Decide whether to escalate a symbol to LLM.
 * Heuristics:
 *  - Near-neutral VADER: |compound| < VADER_NEUTRAL_BAND
 *  - Conflict vs price:  Positive but % < -PRICE_CONFLICT_BAND OR Negative but % > PRICE_CONFLICT_BAND
 *  - Big movers or high volume
 *  - Optional: require at least one article
 */
function shouldSendToLLM(row, vader, articleCount) {
  const pct = Number(row?.pct_change ?? 0);
  const vol = Number(row?.volume ?? 0);
  const absPct = Math.abs(pct);
  const compound = Number(vader?.compound ?? 0);
  const label = String(vader?.label || 'Neutral');

  if (REQUIRE_NEWS_FOR_LLM && articleCount === 0) return false;

  // Big move or very high volume -> likely impactful
  if (absPct >= BIG_MOVE_PCT || vol >= HIGH_VOLUME) return true;

  // Neutral-ish VADER -> LLM might add value
  if (Math.abs(compound) < VADER_NEUTRAL_BAND) return true;

  // Conflict: sentiment vs price direction
  if (label === 'Positive' && pct <= -PRICE_CONFLICT_BAND) return true;
  if (label === 'Negative' && pct >= PRICE_CONFLICT_BAND) return true;

  return false;
}

/**
 * Priority score (for optional ordering if you later add queueing):
 * large move + fresh news + volume
 */
function priorityScore(row, articleCount) {
  const pct = Math.abs(Number(row?.pct_change ?? 0));
  const vol = Math.max(0, Number(row?.volume ?? 0));
  return pct * 10 + (articleCount > 0 ? 20 : 0) + (vol > 0 ? Math.log10(vol + 1) : 0);
}

/* =========================
   Public API
   ========================= */

/**
 * Enhanced recommendation builder using VADER first, then Agno (LLM) only for selected cases.
 * @param {Array<{symbol:string, open:number, ltp:number, pct_change:number, volume:number}>} candidates
 * @param {Object<string, Array<{title:string, summary:string, url?:string, publishedAt?:string}>>} newsMap
 * @returns {Promise<Array<Object>>}
 */
export async function buildEnhancedRecommendations(candidates, newsMap) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // 1) VADER for everyone (fast, local)
  const baseRows = candidates.map((row) => {
    const articles = Array.isArray(newsMap?.[row.symbol]) ? newsMap[row.symbol] : [];
    const vader = aggregateSentiment(articles) || { compound: 0, label: 'Neutral', count: 0 };

    const recommendation = vaderToRec(vader.label);
    return {
      row,
      articles,
      vader,
      articleCount: articles.length,
      rec: recommendation,
      needsLLM: shouldSendToLLM(row, vader, articles.length),
      priority: priorityScore(row, articles.length),
    };
  });

  // 2) Choose a subset for Agno (respect cap)
  const llmCandidates = baseRows
    .filter((x) => x.needsLLM)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, AGNO_MAX_PER_BATCH); // soft cap to avoid bursts

  const llmSymbols = llmCandidates.map((x) => x.row.symbol);
  const useAgno = llmSymbols.length > 0;

  // 3) Call Agno once for the selected subset (it will return null if disabled)
  let agnoMap = new Map();
  if (useAgno) {
    try {
      const subNewsMap = {};
      for (const x of llmCandidates) subNewsMap[x.row.symbol] = x.articles;
      const agnoResults = await getAgnoPicks(llmSymbols, subNewsMap);
      if (Array.isArray(agnoResults)) {
        for (const r of agnoResults) {
          if (r?.symbol) agnoMap.set(r.symbol, r);
        }
      }
    } catch {
      // If Agno fails, we simply leave agnoMap empty and keep VADER results.
      agnoMap = new Map();
    }
  }

  // 4) Merge: for LLM subset (when result exists & no error), replace VADER-derived recommendation
  const enriched = baseRows.map(({ row, vader, rec, articles }) => {
    const articleCount = articles.length;
    const cachedVader = {
      compound: clampUnit(vader.compound),
      label: String(vader.label || 'Neutral'),
      count: articleCount,
      source: 'vader',
    };

    const agno = agnoMap.get(row.symbol);
    if (agno && !agno.error) {
      const score = clampUnit(Number(agno.sentiment_score));
      const agnoLabel = normRec(agno.sentiment_label);
      const reason = String(agno.reason || '').trim() || 'AI summary';

      return {
        ...row,
        sentiment: {
          compound: score,
          label: mapAgnoLabelToVader(agnoLabel),
          count: articleCount,
          source: 'agno',
        },
        sentiment_score: score,
        sentiment_label: agnoLabel,
        reason,
        recommendation: agnoLabel,
        enhanced_recommendation: agnoLabel,
      };
    }

    // No Agno (not selected, disabled, or failed) -> keep VADER
    const vaderRec = rec; // BULLISH/WATCH/SKIP
    return {
      ...row,
      sentiment: cachedVader,
      sentiment_score: clampUnit(vader.compound),
      sentiment_label: vaderRec,
      reason: generateVaderReason(vader, articleCount),
      recommendation: vaderRec,
      enhanced_recommendation: vaderRec,
    };
  });

  return enriched;
}

/**
 * Legacy helper used elsewhere sometimes
 */
export function buildRecommendation(_row, sentiment) {
  const label = String(sentiment?.label || '').toLowerCase();
  if (label === 'positive') return 'BULLISH';
  if (label === 'negative') return 'SKIP';
  return 'WATCH';
}

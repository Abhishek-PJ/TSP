// backend/src/modules/recommendationEngine.js
// Cheap first-pass sentiment (VADER) + selective Agno + fast rule-based "today" prediction.
// Works without ML training; uses current pct_change, volume, and sentiment as signals.

import { getAgnoPicks } from './agnoClient.js';
import { aggregateSentiment } from './sentimentService.js';

/* =========================
   Tunables (env overridable)
   ========================= */
const VADER_NEUTRAL_BAND   = numEnv('VADER_NEUTRAL_BAND', 0.20); // |compound| < -> neutral-ish
const PRICE_CONFLICT_BAND  = numEnv('PRICE_CONFLICT_BAND', 1.00); // % move that triggers conflict
const BIG_MOVE_PCT         = numEnv('BIG_MOVE_PCT', 3.00);        // abs(% change) considered "big"
const HIGH_VOLUME_THRESHOLD= intEnv('HIGH_VOLUME_THRESHOLD', 1_000_000);
const REQUIRE_NEWS_FOR_LLM = boolEnv('REQUIRE_NEWS_FOR_LLM', false);
const AGNO_MAX_PER_BATCH   = intEnv('AGNO_MAX_PER_BATCH', 100);

// Quick predictor knobs
const PRED_LIMIT_ABS_PCT   = numEnv('PRED_LIMIT_ABS_PCT', 3.0);    // clamp ±3%
const PRED_SENTIMENT_GAIN  = numEnv('PRED_SENTIMENT_GAIN', 2.0);    // sentiment weight
const PRED_MOMENTUM_GAIN   = numEnv('PRED_MOMENTUM_GAIN', 0.25);    // pct_change carryover
const PRED_VOL_1           = intEnv('PRED_VOL_1', 1_000_000);       // volume tier 1
const PRED_VOL_2           = intEnv('PRED_VOL_2', 3_000_000);       // volume tier 2
const PRED_VOL_GAIN_1      = numEnv('PRED_VOL_GAIN_1', 0.3);
const PRED_VOL_GAIN_2      = numEnv('PRED_VOL_GAIN_2', 0.6);

/* =========================
   Utilities
   ========================= */
function numEnv(k, def) {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : def;
}
function intEnv(k, def) {
  const v = parseInt(process.env[k] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}
function boolEnv(k, def) {
  const v = String(process.env[k] ?? '').trim().toLowerCase();
  return v ? v === 'true' : def;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampUnit = (n) => clamp(Number.isFinite(n) ? n : 0, -1, 1);

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

/* =========================
   LLM selection heuristics
   ========================= */
function shouldSendToLLM(row, vader, articleCount) {
  const pct = Number(row?.pct_change ?? 0);
  const vol = Number(row?.volume ?? 0);
  const absPct = Math.abs(pct);
  const compound = Number(vader?.compound ?? 0);
  const label = String(vader?.label || 'Neutral');

  if (REQUIRE_NEWS_FOR_LLM && articleCount === 0) return false;

  if (absPct >= BIG_MOVE_PCT || vol >= HIGH_VOLUME_THRESHOLD) return true;       // impactful
  if (Math.abs(compound) < VADER_NEUTRAL_BAND) return true;                      // uncertain
  if (label === 'Positive' && pct <= -PRICE_CONFLICT_BAND) return true;          // conflict
  if (label === 'Negative' && pct >= PRICE_CONFLICT_BAND) return true;           // conflict

  return false;
}

function priorityScore(row, articleCount) {
  const pct = Math.abs(Number(row?.pct_change ?? 0));
  const vol = Math.max(0, Number(row?.volume ?? 0));
  return pct * 10 + (articleCount > 0 ? 20 : 0) + (vol > 0 ? Math.log10(vol + 1) : 0);
}

/* =========================
   Quick intraday predictor
   ========================= */
/**
 * Fast, rule-based "how much it will move today" (% from current price)
 * Blends:
 *  - sentiment_score in [-1,1]
 *  - momentum (current pct_change)
 *  - simple volume tiers
 */
function predictTodayChangePct(row, sentimentScore) {
  const pct = Number(row?.pct_change ?? 0);     // current day move so far
  const vol = Number(row?.volume ?? 0);         // current volume
  const s   = clampUnit(Number(sentimentScore)); // -1..1

  // Volume boost (simple tiers)
  let volBoost = 0;
  if (vol >= PRED_VOL_2) volBoost = PRED_VOL_GAIN_2;
  else if (vol >= PRED_VOL_1) volBoost = PRED_VOL_GAIN_1;

  const momentum = clamp(pct, -3, 3) * PRED_MOMENTUM_GAIN;     // carry some momentum, bounded
  const sentimentBoost = s * PRED_SENTIMENT_GAIN;              // map [-1,1] -> roughly ±2%
  let pred = sentimentBoost + volBoost + momentum;

  pred = clamp(pred, -PRED_LIMIT_ABS_PCT, PRED_LIMIT_ABS_PCT); // keep sane bounds

  // Confidence: blend of |sentiment|, |momentum|, and volume tier
  const confSent = Math.abs(s);                                 // 0..1
  const confMom  = clamp(Math.abs(pct) / PRED_LIMIT_ABS_PCT, 0, 1);
  const confVol  = volBoost > 0 ? (volBoost / PRED_VOL_GAIN_2) : 0; // 0..1
  const confidence = clamp(0.25 + 0.5 * confSent + 0.15 * confMom + 0.10 * confVol, 0.2, 0.95);

  const trend = pred > 0.15 ? 'bullish' : pred < -0.15 ? 'bearish' : 'sideways';
  const risk_level = confidence >= 0.75 ? 'low' : confidence >= 0.5 ? 'medium' : 'high';
  const volatility = clamp(Math.abs(pred) / PRED_LIMIT_ABS_PCT, 0, 1);

  return { pred, confidence, trend, risk_level, volatility };
}

/* =========================
   Public API
   ========================= */
/**
 * Enhanced recommendations + immediate intraday prediction.
 * @param {Array<{symbol:string, open:number, ltp:number, pct_change:number, volume:number}>} candidates
 * @param {Object<string, Array<{title:string, summary:string, url?:string, publishedAt?:string}>>} newsMap
 * @returns {Promise<Array<Object>>}
 */
export async function buildEnhancedRecommendations(candidates, newsMap) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  // 1) VADER pass
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

  // 2) Agno subset
  const llmCandidates = baseRows
    .filter((x) => x.needsLLM)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, AGNO_MAX_PER_BATCH);

  const llmSymbols = llmCandidates.map((x) => x.row.symbol);
  let agnoMap = new Map();

  if (llmSymbols.length > 0) {
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
      agnoMap = new Map(); // fallback silently to VADER
    }
  }

  // 3) Merge + fast prediction
  const enriched = baseRows.map(({ row, vader, rec, articles }) => {
    const articleCount = articles.length;
    const vaderCompound = clampUnit(vader.compound);

    const agno = agnoMap.get(row.symbol);
    let finalScore = vaderCompound;
    let finalLabel = rec; // BULLISH/WATCH/SKIP
    let reason = generateVaderReason(vader, articleCount);
    let source = 'vader';

    if (agno && !agno.error) {
      const score = clampUnit(Number(agno.sentiment_score));
      finalScore = score;
      finalLabel = normRec(agno.sentiment_label);
      reason = String(agno.reason || '').trim() || 'AI summary';
      source = 'agno';
    }

    // ---- Quick intraday prediction block ----
    const { pred, confidence, trend, risk_level, volatility } = predictTodayChangePct(row, finalScore);
    const ltp = Number(row.ltp ?? 0);
    const targetPrice = Number.isFinite(ltp) ? Math.round(ltp * (1 + pred / 100)) : null;

    return {
      ...row,
      sentiment: {
        compound: finalScore,
        label: source === 'agno' ? mapAgnoLabelToVader(finalLabel) : String(vader.label || 'Neutral'),
        count: articleCount,
        source,
      },
      sentiment_score: finalScore,
      sentiment_label: finalLabel,
      reason,
      recommendation: finalLabel,
      enhanced_recommendation: finalLabel,

      // 👇 New prediction payload for UI badges/cards
      prediction: {
        predicted_change_pct: Number(pred.toFixed(2)),
        trend,
        confidence: Number(confidence.toFixed(2)),
        risk_level,
        volatility: Number(volatility.toFixed(2)),
        price_targets: targetPrice ? [targetPrice] : [],
      },
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

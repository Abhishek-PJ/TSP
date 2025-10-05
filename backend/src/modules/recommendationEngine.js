// Recommendation engine - integrates Agno sentiment with numeric filters
import { getAgnoPicks } from './agnoClient.js';
import { aggregateSentiment } from './sentimentService.js';

export function buildRecommendation(row, sentiment) {
  if (!sentiment) return 'WATCH';
  if (sentiment.label === 'Negative') return 'SKIP';
  if (sentiment.label === 'Positive') return 'BULLISH';
  return 'WATCH';
}

// Enhanced recommendation builder using Agno sentiment with VADER fallback
export async function buildEnhancedRecommendations(candidates, newsMap) {
  const symbols = candidates.map(c => c.symbol);
  
  // Try Agno service first
  const agnoResults = await getAgnoPicks(symbols, newsMap);
  const agnoMap = new Map();
  
  if (agnoResults && Array.isArray(agnoResults)) {
    for (const r of agnoResults) {
      agnoMap.set(r.symbol, r);
    }
  }

  // Enrich candidates with sentiment analysis
  const enriched = candidates.map(row => {
    const agnoResult = agnoMap.get(row.symbol);
    
    if (agnoResult && !agnoResult.error) {
      // Use Agno results
      return {
        ...row,
        sentiment: {
          compound: agnoResult.sentiment_score,
          label: mapAgnoLabelToVader(agnoResult.sentiment_label),
          count: newsMap[row.symbol]?.length || 0,
          source: 'agno',
        },
        sentiment_score: agnoResult.sentiment_score,
        sentiment_label: agnoResult.sentiment_label,
        reason: agnoResult.reason,
        recommendation: agnoResult.sentiment_label,
      };
    } else {
      // Fallback to VADER sentiment
      const articles = newsMap[row.symbol] || [];
      const vaderSentiment = aggregateSentiment(articles);
      const recommendation = buildRecommendation(row, vaderSentiment);
      
      return {
        ...row,
        sentiment: { ...vaderSentiment, source: 'vader' },
        sentiment_score: vaderSentiment.compound,
        sentiment_label: recommendation,
        reason: generateVaderReason(vaderSentiment, articles.length),
        recommendation,
      };
    }
  });

  return enriched;
}

function mapAgnoLabelToVader(agnoLabel) {
  const map = {
    'BULLISH': 'Positive',
    'SKIP': 'Negative',
    'WATCH': 'Neutral',
  };
  return map[agnoLabel] || 'Neutral';
}

function generateVaderReason(sentiment, articleCount) {
  if (articleCount === 0) return 'No recent news available';
  const { label, compound } = sentiment;
  const score = Math.abs(compound).toFixed(2);
  
  if (label === 'Positive') {
    return `Positive sentiment (${score}) across ${articleCount} articles`;
  } else if (label === 'Negative') {
    return `Negative sentiment (${score}) across ${articleCount} articles`;
  }
  return `Neutral sentiment across ${articleCount} articles`;
}

// VADER sentiment analysis implementation
// Uses vader-sentiment to compute polarity scores per article and aggregates them.

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const vader = require('vader-sentiment');

export function scoreArticle(article) {
  const text = [article?.title, article?.summary].filter(Boolean).join('. ');
  // console.log(text);
  const { compound } = vader.SentimentIntensityAnalyzer.polarity_scores(text || '');
  return { compound };
}

export function aggregateSentiment(articles) {
  if (!articles || articles.length === 0) {
    return { compound: 0, label: 'Neutral', count: 0 };
  }
  const compounds = articles.map(scoreArticle).map(s => s.compound);
  const compound = compounds.reduce((a, b) => a + b, 0) / compounds.length;
  // VADER conventional thresholds
  let label = 'Neutral';
  if (compound >= 0.05) label = 'Positive';
  else if (compound <= -0.05) label = 'Negative';
  return { compound, label, count: articles.length };
}

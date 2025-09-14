export function buildRecommendation(row, sentiment) {
  if (!sentiment) return 'WATCH';
  if (sentiment.label === 'Negative') return 'SKIP';
  if (sentiment.label === 'Positive') return 'BULLISH';
  return 'WATCH';
}

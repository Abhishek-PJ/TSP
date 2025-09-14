// Build final recommendation from numeric filters + aggregated sentiment
// Output: 'BULLISH', 'SKIP', or 'WATCH'

export function buildRecommendation(row, sentiment) {
  // Numeric pre-filter should already be applied before calling this.
  if (!sentiment) return 'WATCH';
  if (sentiment.label === 'Negative') return 'SKIP';
  if (sentiment.label === 'Positive') return 'BULLISH';
  return 'WATCH';
}

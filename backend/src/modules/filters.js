// Primary numeric filters
// Rules:
// - pct_change between +1% and +3%
// - open price > 50
// - volume >= 100,000

export function primaryFilter(row) {
  const pct = Number(row.pct_change);
  const open = Number(row.open);
  const volume = Number(row.volume);
  if (!isFinite(pct) || !isFinite(open) || !isFinite(volume)) return false;
  return pct >= 1 && pct <= 3 && open > 50 && volume >= 100000;
}

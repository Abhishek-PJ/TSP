import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from './components/Modal.jsx';
import CandlestickChart from './components/CandlestickChart.jsx';
import './index.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function Badge({ text, variant = 'neutral' }) {
  const styles = {
    positive: 'bg-emerald-100 text-emerald-800',
    negative: 'bg-red-100 text-red-800',
    watch: 'bg-amber-100 text-amber-800',
    bullish: 'bg-green-100 text-green-800',
    skip: 'bg-slate-100 text-slate-800',
  };
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[variant] || 'bg-slate-100 text-slate-800'}`}>
      {String(text)}
    </span>
  );
}

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState([]);
  const [asOf, setAsOf] = useState('');
  const [marketOpen, setMarketOpen] = useState(true);
  const [sessionDate, setSessionDate] = useState('');
  const [health, setHealth] = useState({ redis: false });

  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [newsArticles, setNewsArticles] = useState([]);

  // Select a symbol for the right sidebar (mini chart + news)
  function selectSymbol(sym) {
    setChartSymbol(sym);
    setSidebarOpen(true);
  }
  // Open the modal with the currently selected symbol
  function openChartModal() {
    if (chartSymbol) setChartOpen(true);
  }
  function closeChart() {
    setChartOpen(false);
  }
  function closeSidebar() {
    setSidebarOpen(false);
    setChartSymbol('');
  }

  const sorted = useMemo(() => {
    return [...picks].sort((a, b) => b.pct_change - a.pct_change);
  }, [picks]);

  const grouped = useMemo(() => {
    const bull = [];
    const watch = [];
    const skip = [];
    for (const r of sorted) {
      if (r.recommendation === 'BULLISH') bull.push(r);
      else if (r.recommendation === 'SKIP') skip.push(r);
      else watch.push(r);
    }
    return { bull, watch, skip };
  }, [sorted]);

  async function fetchPicks() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/api/picks/today`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAsOf(data.asOf);
      setMarketOpen(data.marketOpen !== false);
      setSessionDate(data.sessionDate || '');
      setPicks(data.results || []);
    } catch (e) {
      setError(e.message || 'Failed to load picks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPicks();
    const id = setInterval(fetchPicks, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load health status
  useEffect(() => {
    async function loadHealth() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          setHealth({ redis: !!data.redis });
        }
      } catch {}
    }
    loadHealth();
    const id = setInterval(loadHealth, 60_000);
    return () => clearInterval(id);
  }, []);

  // Load news for the selected chart symbol to show in sidebar
  useEffect(() => {
    if (!chartSymbol) { setNewsArticles([]); setNewsError(''); return; }
    let abort = false;
    async function loadNews() {
      try {
        setNewsLoading(true);
        setNewsError('');
        const res = await fetch(`${API_BASE}/api/news/${encodeURIComponent(chartSymbol)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!abort) setNewsArticles(Array.isArray(data.articles) ? data.articles : []);
      } catch (e) {
        if (!abort) setNewsError(e.message || 'Failed to load news');
      } finally {
        if (!abort) setNewsLoading(false);
      }
    }
    loadNews();
    return () => { abort = true; };
  }, [chartSymbol]);

  return (
    <div className="bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="w-full px-6 lg:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl grid place-items-center bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <div className="text-xl font-extrabold tracking-tight text-slate-900">Trendy Stocks Predictor </div>
              <div className="text-sm text-slate-600">AI-Powered Trend Prediction Platform</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={fetchPicks} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-md disabled:opacity-60">
              {loading ? 'Updating…' : 'Refresh Data'}
            </button>
            {asOf && (
              <div className="text-right">
                <div className="text-[11px] font-bold text-slate-800">Last Updated</div>
                <div className="text-xs text-slate-600">{new Date(asOf).toLocaleTimeString()}</div>
              </div>
            )}
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${health.redis ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
              <span style={{width:8, height:8, borderRadius:999, background: health.redis ? '#10b981' : '#ef4444'}} />
              Redis {health.redis ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <main className="w-full px-6 lg:px-10 py-6">
        {!marketOpen && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-4">
            Market Closed — Showing last session's picks{sessionDate ? ` (${sessionDate})` : ''}.
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-4">{error}</div>
        )}

        {/* Top summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-emerald-50 rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-emerald-700 tracking-wide">Bullish</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.bull.length}</div>
          </div>
          <div className="bg-amber-50 rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-amber-700 tracking-wide">Watch</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.watch.length}</div>
          </div>
          <div className="bg-rose-50 rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-rose-700 tracking-wide">Skip</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.skip.length}</div>
          </div>
          <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs font-semibold text-slate-700 tracking-wide">Total</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{sorted.length}</div>
          </div>
        </div>

        {/* Split grid: left tables, right animated sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left: tables */}
          <div className={sidebarOpen ? '' : 'xl:col-span-2'}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">Today's Market Picks</div>
                  <div className="text-sm text-slate-600">AI-curated investment opportunities</div>
                </div>
                {loading && <div className="text-sm text-slate-600">Loading…</div>}
              </div>
              <div>
                {loading && (
                  <div className="p-5">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex items-center p-4 border-b border-slate-100 last:border-0">
                        <div className="bg-slate-200 rounded h-3 w-2/5 animate-pulse" />
                      </div>
                    ))}
                  </div>
                )}
                {!loading && sorted.length === 0 && (
                  <div className="p-6 text-sm text-slate-600">No candidates yet. Try refresh.</div>
                )}

                {!loading && sorted.length > 0 && (
                  <div className="grid gap-4 p-4">
                    {/* Bullish Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                      <div className="bg-white border-b border-l-4 border-emerald-500 px-6 py-4 pl-5 flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-900">Bullish</div>
                          <div className="text-xs tracking-wide text-slate-600">Strong positive sentiment and metrics</div>
                        </div>
                        <Badge text={`${grouped.bull.length} picks`} variant="bullish" />
                      </div>
                      <div className="relative max-h-[60vh] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left">
                          <thead>
                            <tr className="text-slate-700 text-xs sticky top-0 bg-slate-50 z-10">
                              <th className="px-4 py-3">Symbol</th>
                              <th className="px-4 py-3">Change</th>
                              <th className="px-4 py-3">Open</th>
                              <th className="px-4 py-3">LTP</th>
                              <th className="px-4 py-3">Volume</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {grouped.bull.map((row) => (
                              <tr
                                key={row.symbol}
                                className={`border-t border-slate-200 transition-colors border-l-4 ${row.symbol === chartSymbol ? 'bg-emerald-100 border-emerald-500' : 'border-transparent hover:bg-emerald-50'}`}
                              >
                                <td className="px-4 py-3">
                                  <button type="button" onClick={() => selectSymbol(row.symbol)} className="text-blue-600 hover:text-blue-800 font-semibold bg-transparent border-0 p-0 cursor-pointer">
                                    {row.symbol}
                                  </button>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                                </td>
                                <td className="px-4 py-3 text-slate-900">₹{row.open.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">₹{row.ltp.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">{row.volume.toLocaleString()}</td>
                              </tr>
                            ))}
                            {grouped.bull.length === 0 && (
                              <tr><td colSpan={5} className="px-4 py-3 text-slate-500">No bullish picks.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Watch Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                      <div className="bg-white border-b border-l-4 border-amber-500 px-6 py-4 pl-5 flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-900">Watch</div>
                          <div className="text-xs tracking-wide text-slate-600">Meets some criteria; monitor closely</div>
                        </div>
                        <Badge text={`${grouped.watch.length} picks`} variant="watch" />
                      </div>
                      <div className="relative max-h-[60vh] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left">
                          <thead>
                            <tr className="text-slate-700 text-xs sticky top-0 bg-slate-50 z-10">
                              <th className="px-4 py-3">Symbol</th>
                              <th className="px-4 py-3">Change</th>
                              <th className="px-4 py-3">Open</th>
                              <th className="px-4 py-3">LTP</th>
                              <th className="px-4 py-3">Volume</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {grouped.watch.map((row) => (
                              <tr
                                key={row.symbol}
                                className={`border-t border-slate-200 transition-colors border-l-4 ${row.symbol === chartSymbol ? 'bg-amber-100 border-amber-500' : 'border-transparent hover:bg-amber-50'}`}
                              >
                                <td className="px-4 py-3">
                                  <button type="button" onClick={() => selectSymbol(row.symbol)} className="text-blue-600 hover:text-blue-800 font-semibold bg-transparent border-0 p-0 cursor-pointer">
                                    {row.symbol}
                                  </button>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                                </td>
                                <td className="px-4 py-3 text-slate-900">₹{row.open.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">₹{row.ltp.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">{row.volume.toLocaleString()}</td>
                              </tr>
                            ))}
                            {grouped.watch.length === 0 && (
                              <tr><td colSpan={5} className="px-4 py-3 text-slate-500">No watchlist picks.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Skip Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                      <div className="bg-white border-b border-l-4 border-rose-500 px-6 py-4 pl-5 flex items-center justify-between">
                        <div>
                          <div className="text-lg font-bold text-slate-900">Skip</div>
                          <div className="text-xs tracking-wide text-slate-600">Fails numeric/sentiment checks</div>
                        </div>
                        <Badge text={`${grouped.skip.length} picks`} variant="skip" />
                      </div>
                      <div className="relative max-h-[60vh] overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-left">
                          <thead>
                            <tr className="text-slate-700 text-xs sticky top-0 bg-slate-50 z-10">
                              <th className="px-4 py-3">Symbol</th>
                              <th className="px-4 py-3">Change</th>
                              <th className="px-4 py-3">Open</th>
                              <th className="px-4 py-3">LTP</th>
                              <th className="px-4 py-3">Volume</th>
                            </tr>
                          </thead>
                          <tbody className="text-sm">
                            {grouped.skip.map((row) => (
                              <tr
                                key={row.symbol}
                                className={`border-t border-slate-200 transition-colors border-l-4 ${row.symbol === chartSymbol ? 'bg-rose-100 border-rose-500' : 'border-transparent hover:bg-rose-50'}`}
                              >
                                <td className="px-4 py-3">
                                  <button type="button" onClick={() => selectSymbol(row.symbol)} className="text-blue-600 hover:text-blue-800 font-semibold bg-transparent border-0 p-0 cursor-pointer">
                                    {row.symbol}
                                  </button>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                                </td>
                                <td className="px-4 py-3 text-slate-900">₹{row.open.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">₹{row.ltp.toFixed(2)}</td>
                                <td className="px-4 py-3 text-slate-900">{row.volume.toLocaleString()}</td>
                              </tr>
                            ))}
                            {grouped.skip.length === 0 && (
                              <tr><td colSpan={5} className="px-4 py-3 text-slate-500">No symbols to skip.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar: Live Chart and Latest News (animated) */}
          <aside
            className={
              `grid gap-4 h-fit self-start sticky top-6 z-0 max-h-[calc(100vh-6rem)] overflow-auto transform transition-all duration-300 ease-out ` +
              (sidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6 pointer-events-none')
            }
          >
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">Live Chart</div>
                  <div className="text-sm text-slate-600">{chartSymbol ? chartSymbol : 'Pick a symbol'}</div>
                </div>
                {sidebarOpen && (
                  <button
                    type="button"
                    onClick={closeSidebar}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                    title="Close sidebar"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="p-4" style={{ minHeight: 300 }}>
                {chartSymbol ? (
                  <button type="button" onClick={openChartModal} title="Open full chart" className="block w-full h-[360px] cursor-pointer bg-transparent p-0 border-0">
                    <div className="w-full h-full">
                      <CandlestickChart symbol={chartSymbol} />
                    </div>
                  </button>
                ) : (
                  <div className="text-sm text-slate-600">Click a symbol to preview its chart here.</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="border-b border-slate-200 px-6 py-4">
                <div>
                  <div className="text-lg font-bold text-slate-900">Latest News</div>
                  <div className="text-sm text-slate-600">{chartSymbol ? chartSymbol : 'Pick a symbol'}</div>
                </div>
              </div>
              <div className="p-4">
                {!chartSymbol && <div className="text-sm text-slate-600">Select a symbol to load recent news.</div>}
                {chartSymbol && newsLoading && <div className="text-sm text-slate-600">Loading…</div>}
                {chartSymbol && newsError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3">{newsError}</div>
                )}
                {chartSymbol && !newsLoading && newsArticles.length === 0 && (
                  <div className="text-sm text-slate-600">No recent articles.</div>
                )}
                <div className="grid gap-3">
                  {newsArticles.slice(0, 6).map((a, idx) => (
                    <a key={idx} href={a.url} target="_blank" rel="noreferrer" className="bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 p-3 text-slate-800 transition-colors">
                      <div className="text-[11px] text-slate-500">{new Date(a.publishedAt).toLocaleString()}</div>
                      <div className="mt-1 font-bold">{a.title}</div>
                      {a.summary && <div className="mt-1 text-sm text-slate-700">{a.summary}</div>}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>

        <Modal open={chartOpen} onClose={closeChart} title={`${chartSymbol} — Candlestick`}>
          <div className="h-full">
            <CandlestickChart symbol={chartSymbol} />
          </div>
        </Modal>

        <div className="mt-6 text-xs text-slate-600">
          Rules: +1% to +3% gain, Open ≥ ₹50, Volume ≥ 100,000, and positive recent news ⇒ Bullish. Otherwise, Watch/Skip.
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="w-full px-6 lg:px-10 py-4">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span> {new Date().getFullYear()} Trendy Stocks Predictor</span>
            <a href="https://vitejs.dev" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:text-blue-800"></a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

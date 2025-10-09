import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useReactTable, getCoreRowModel, getSortedRowModel, flexRender } from '@tanstack/react-table';
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
    neutral: 'bg-slate-100 text-slate-800',
  };
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[variant] || styles.neutral}`}>
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
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [health, setHealth] = useState({ redis: false });

  const [chartOpen, setChartOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [newsArticles, setNewsArticles] = useState([]);

  // Sorting persistence via URL/localStorage only
  const [searchParams, setSearchParams] = useSearchParams();

  // Read persisted sort on first render only
  const initialPersist = useMemo(() => {
    let fromLS = {};
    try { fromLS = JSON.parse(localStorage.getItem('tsp_ui_state') || '{}'); } catch {}
    const sp = Object.fromEntries(searchParams.entries());
    return {
      sortKey: String(sp.sortKey ?? fromLS.sortKey ?? 'pct_change'),
      sortDir: String(sp.sortDir ?? fromLS.sortDir ?? 'desc'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sortKey, setSortKey] = useState(initialPersist.sortKey); // symbol | pct_change | open | ltp | volume
  const [sortDir, setSortDir] = useState(initialPersist.sortDir); // asc | desc

  // TanStack Table sorting state (shared across all three tables)
  const [sorting, setSorting] = useState(() => [{ id: initialPersist.sortKey, desc: initialPersist.sortDir === 'desc' }]);

  // TanStack Table column visibility state (shared across tables)
  const [columnVisibility, setColumnVisibility] = useState({
    symbol: true,
    pct_change: true,
    open: true,
    ltp: true,
    volume: true,
  });

  // Category visibility checkboxes
  const [showBull, setShowBull] = useState(true);
  const [showWatch, setShowWatch] = useState(true);
  const [showSkip, setShowSkip] = useState(true);
  const allChecked = showBull && showWatch && showSkip;

  function toggleAll(next) {
    setShowBull(next);
    setShowWatch(next);
    setShowSkip(next);
  }

  // Persist sort to URL + localStorage
  useEffect(() => {
    const state = { sortKey, sortDir };
    try { localStorage.setItem('tsp_ui_state', JSON.stringify(state)); } catch {}
    setSearchParams(state, { replace: true });
  }, [sortKey, sortDir, setSearchParams]);

  // Keep TanStack sorting updated when our persisted sort changes
  useEffect(() => {
    setSorting([{ id: sortKey, desc: sortDir === 'desc' }]);
  }, [sortKey, sortDir]);

  // When TanStack sorting changes (via header clicks), update our persisted state
  const onSortingChange = useCallback((updater) => {
    setSorting((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const first = next?.[0];
      if (first?.id) {
        setSortKey(first.id);
        setSortDir(first.desc ? 'desc' : 'asc');
      }
      return next;
    });
  }, []);

  // Memoize handlers so columns memo stays stable
  const selectSymbol = useCallback((sym) => {
    setChartSymbol(sym);
    setSidebarOpen(true);
  }, []);
  const openChartModal = useCallback(() => {
    if (chartSymbol) setChartOpen(true);
  }, [chartSymbol]);
  const closeChart = useCallback(() => setChartOpen(false), []);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    setChartSymbol('');
  }, []);

  // Columns (stable thanks to memoized handlers)
  const columns = useMemo(() => [
    {
      header: 'Symbol',
      accessorKey: 'symbol',
      size: 80,
      cell: ({ row }) => (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={() => selectSymbol(row.original.symbol)}
          className="text-blue-600 hover:text-blue-800 font-semibold bg-transparent border-0 p-0 cursor-pointer"
        >
          {row.original.symbol}
        </motion.button>
      ),
      sortingFn: 'alphanumeric',
    },
    {
      header: 'Change',
      accessorKey: 'pct_change',
      size: 70,
      cell: ({ row }) => (
        <div>
          <Badge
            text={`${row.original.pct_change >= 0 ? '+' : ''}${row.original.pct_change.toFixed(2)}%`}
            variant={row.original.pct_change >= 0 ? 'positive' : 'negative'}
          />
        </div>
      ),
      sortingFn: (a, b, columnId) => a.getValue(columnId) - b.getValue(columnId),
    },
    {
      header: 'Open',
      accessorKey: 'open',
      size: 80,
      cell: ({ row }) => <span className="font-mono">{`₹${row.original.open.toFixed(2)}`}</span>,
      sortingFn: (a, b, columnId) => a.getValue(columnId) - b.getValue(columnId),
    },
    {
      header: 'LTP',
      accessorKey: 'ltp',
      size: 80,
      cell: ({ row }) => <span className="font-mono">{`₹${row.original.ltp.toFixed(2)}`}</span>,
      sortingFn: (a, b, columnId) => a.getValue(columnId) - b.getValue(columnId),
    },
    {
      header: 'Volume',
      accessorKey: 'volume',
      size: 100,
      cell: ({ row }) => <span className="font-mono">{row.original.volume.toLocaleString()}</span>,
      sortingFn: (a, b, columnId) => a.getValue(columnId) - b.getValue(columnId),
    },
  ], [selectSymbol]);

  // Pre-sort by pct_change just for category bucketing (table sorting remains interactive)
  const sortedForBuckets = useMemo(
    () => [...picks].sort((a, b) => b.pct_change - a.pct_change),
    [picks]
  );

  const grouped = useMemo(() => {
    const bull = [];
    const watch = [];
    const skip = [];
    for (const r of sortedForBuckets) {
      if (r.recommendation === 'BULLISH') bull.push(r);
      else if (r.recommendation === 'SKIP') skip.push(r);
      else watch.push(r);
    }
    return {
      bull: bull.slice(0, 5),
      watch: watch.slice(0, 5),
      skip: skip.slice(0, 5),
    };
  }, [sortedForBuckets]);

  // DataTable component (shared config)
  function DataTable({ data, highlight, hoverBg, borderColor }) {
    const table = useReactTable({
      data,
      columns,
      state: { sorting, columnVisibility },
      onSortingChange,
      onColumnVisibilityChange: setColumnVisibility,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
    });

    return (
      <table className="w-full table-fixed text-left">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="text-slate-700 text-xs sticky top-0 bg-slate-50 z-10">
              {hg.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th key={header.id} className="px-4 py-3 text-center font-semibold">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="font-semibold hover:underline inline-flex items-center justify-center gap-1 w-full"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' && <span>↑</span>}
                        {sorted === 'desc' && <span>↓</span>}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="text-sm">
          <AnimatePresence initial={false}>
            {table.getRowModel().rows.map((row) => (
              <motion.tr
                key={row.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className={`border-t border-slate-200 transition-colors border-l-4 ${
                  row.original.symbol === chartSymbol
                    ? `${highlight} ${borderColor}`
                    : `border-transparent ${hoverBg}`
                }`}
              >
                {row.getVisibleCells().map((cell) => {
                  const columnId = cell.column.id;
                  return (
                    <td key={cell.id} className="px-4 py-3 text-slate-800 text-center">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </AnimatePresence>
          {table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-3 text-slate-500 text-center">
                No data.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  // Fetch picks
  const fetchPicks = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/api/picks/today`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAsOf(data.asOf);
      setMarketOpen(data.marketOpen !== false);
      setSessionDate(data.sessionDate || '');
      setTotalCandidates(data.totalCandidates || 0);
      setPicks(data.results || []);
    } catch (e) {
      setError(e.message || 'Failed to load picks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPicks();
    const id = setInterval(fetchPicks, 300_000);
    return () => clearInterval(id);
  }, [fetchPicks]);

  // Load health status
  useEffect(() => {
    let active = true;
    async function loadHealth() {
      try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
          const data = await res.json();
          if (active) setHealth({ redis: !!data.redis });
        }
      } catch {}
    }
    loadHealth();
    const id = setInterval(loadHealth, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
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

  // Helper: format date as dd-mm-yyyy, handling ISO yyyy-mm-dd strings
  function formatDateDMY(v) {
    if (!v) return '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const [y, m, d] = v.split('-');
      return `${d}-${m}-${y}`;
    }
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }

  // Helper: format date-time as dd-mm-yyyy hh:mm (24h)
  function formatDateTimeDMY(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
  }

  return (
    <div className="bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 min-h-screen">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="w-full px-6 lg:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl grid place-items-center bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-lg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <div className="text-xl font-bold tracking-tight text-slate-900">Trendy Stocks Predictor </div>
              <div className="text-sm text-slate-600">AI-Powered Trend Prediction Platform</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={fetchPicks}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-md disabled:opacity-60"
            >
              {loading ? 'Updating…' : 'Refresh Data'}
            </motion.button>
            {asOf && (
              <div className="text-right">
                <div className="text-[11px] font-bold text-slate-800">Last Updated</div>
                <div className="text-xs text-slate-600">{formatDateTimeDMY(asOf)}</div>
              </div>
            )}
            
          </div>
        </div>
      </header>

      <main className="w-full px-6 lg:px-10 py-6">
        {!marketOpen && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-4 text-center">
            Market Closed — Showing last session&apos;s picks{sessionDate ? ` (${formatDateDMY(sessionDate)})` : ''}.
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 mb-4">{error}</div>
        )}

        {/* Top summary bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-emerald-50 rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <div className="text-xs font-semibold text-emerald-700 tracking-wide">Bullish</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.bull.length}</div>
          </div>
          <div className="bg-amber-50 rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <div className="text-xs font-semibold text-amber-700 tracking-wide">Watch</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.watch.length}</div>
          </div>
          <div className="bg-rose-50 rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <div className="text-xs font-semibold text-rose-700 tracking-wide">Skip</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.skip.length}</div>
          </div>
          <div className="bg-slate-50 rounded-xl border border-slate-200 shadow-sm p-4 text-center">
            <div className="text-xs font-semibold text-slate-700 tracking-wide">Total</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{grouped.bull.length + grouped.watch.length + grouped.skip.length}</div>
          </div>
        </div>

        {/* Optimization info */}
        {totalCandidates > 0 && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 mb-4">
            <div className="text-xs font-medium">
              ⚡ Performance Optimized: Analyzed top 50 stocks to find the best 5 per category from {totalCandidates} total candidates
            </div>
          </div>
        )}

        {/* Split grid: left tables, right animated sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Left: tables */}
          <div className={sidebarOpen ? '' : 'xl:col-span-2'}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">Today&apos;s Market Picks</div>
                  <div className="text-sm text-slate-600">AI-curated investment opportunities</div>
                </div>
                {loading && <div className="text-sm text-slate-600">Loading…</div>}
              </div>

              {/* Category filters */}
              <div className="border-b border-slate-200 bg-slate-50/50 px-6 py-3">
                <div className="flex flex-wrap items-center gap-6 text-sm text-slate-700">
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="accent-blue-600" checked={allChecked} onChange={(e)=>toggleAll(e.target.checked)} />
                    <span className="font-semibold">All</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="accent-emerald-600" checked={showBull} onChange={(e)=>setShowBull(e.target.checked)} />
                    <span>Bullish</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="accent-amber-600" checked={showWatch} onChange={(e)=>setShowWatch(e.target.checked)} />
                    <span>Watch</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" className="accent-rose-600" checked={showSkip} onChange={(e)=>setShowSkip(e.target.checked)} />
                    <span>Skip</span>
                  </label>
                </div>
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

                {!loading && sortedForBuckets.length === 0 && (
                  <div className="p-6 text-sm text-slate-600">No candidates yet. Try refresh.</div>
                )}

                {!loading && sortedForBuckets.length > 0 && (
                  <div className="grid gap-4 p-4">
                    {/* Column visibility toggles */}
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex flex-wrap items-center gap-4 text-sm text-slate-700"
                    >
                      <span className="text-xs font-semibold text-slate-600">Columns:</span>
                      {[
                        { key: 'symbol', label: 'Symbol' },
                        { key: 'pct_change', label: 'Change' },
                        { key: 'open', label: 'Open' },
                        { key: 'ltp', label: 'LTP' },
                        { key: 'volume', label: 'Volume' },
                      ].map((c) => (
                        <label key={c.key} className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={columnVisibility[c.key] !== false}
                            onChange={(e) => setColumnVisibility((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </motion.div>

                    {/* Bullish Table */}
                    {showBull && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                        className="bg-white rounded-xl border border-slate-200 shadow-sm"
                      >
                        <div className="bg-white border-b border-l-4 border-emerald-500 px-6 py-4 pl-5 flex items-center justify-between">
                          <div>
                            <div className="text-lg font-bold text-slate-900">Bullish</div>
                            <div className="text-xs tracking-wide text-slate-600">Top 5 stocks with strong positive sentiment</div>
                          </div>
                          <Badge text={`${grouped.bull.length}picks`} variant="bullish" />
                        </div>
                        <div className="relative max-h-[60vh] overflow-auto">
                          <DataTable
                            data={grouped.bull}
                            highlight="bg-emerald-100"
                            hoverBg="hover:bg-emerald-50"
                            borderColor="border-emerald-500"
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Watch Table */}
                    {showWatch && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: showBull ? 0.5 : 0.1 }}
                        className="bg-white rounded-xl border border-slate-200 shadow-sm"
                      >
                        <div className="bg-white border-b border-l-4 border-amber-500 px-6 py-4 pl-5 flex items-center justify-between">
                          <div>
                            <div className="text-lg font-bold text-slate-900">Watch</div>
                            <div className="text-xs tracking-wide text-slate-600">Top 5 stocks meeting some criteria</div>
                          </div>
                          <Badge text={`${grouped.watch.length} picks`} variant="watch" />
                        </div>
                        <div className="relative max-h-[60vh] overflow-auto">
                          <DataTable
                            data={grouped.watch}
                            highlight="bg-amber-100"
                            hoverBg="hover:bg-amber-50"
                            borderColor="border-amber-500"
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Skip Table */}
                    {showSkip && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: (showBull && showWatch) ? 0.9 : (showBull || showWatch) ? 0.5 : 0.1 }}
                        className="bg-white rounded-xl border border-slate-200 shadow-sm"
                      >
                        <div className="bg-white border-b border-l-4 border-rose-500 px-6 py-4 pl-5 flex items-center justify-between">
                          <div>
                            <div className="text-lg font-bold text-slate-900">Skip</div>
                            <div className="text-xs tracking-wide text-slate-600">Top 5 stocks failing criteria</div>
                          </div>
                          <Badge text={`${grouped.skip.length} picks`} variant="skip" />
                        </div>
                        <div className="relative max-h-[60vh] overflow-auto">
                          <DataTable
                            data={grouped.skip}
                            highlight="bg-rose-100"
                            hoverBg="hover:bg-rose-50"
                            borderColor="border-rose-500"
                          />
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar: Live Chart and Latest News (animated) */}
          <AnimatePresence>
            {sidebarOpen && (
              <motion.aside
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="grid gap-4 h-fit self-start sticky top-6 z-0 max-h-[calc(100vh-6rem)] overflow-auto"
              >
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                  <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                    <div>
                      <div className="text-lg font-bold text-slate-900">Live Chart</div>
                      <div className="text-sm text-slate-600">{chartSymbol ? chartSymbol : 'Pick a symbol'}</div>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={closeSidebar}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                      title="Close sidebar"
                    >
                      ✕
                    </motion.button>
                  </div>
                  <div className="p-4" style={{ minHeight: 300 }}>
                    {chartSymbol ? (
                      <button type="button" onClick={openChartModal} title="Open full chart" className="block w-full h-[360px] cursor-pointer bg-transparent border-0 p-0">
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
                        <motion.a
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          key={idx}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 p-3 text-slate-800 transition-colors"
                        >
                          <div className="text-[11px] text-slate-500">{formatDateTimeDMY(a.publishedAt)}</div>
                          <div className="mt-1 font-bold">{a.title}</div>
                          {a.summary && <div className="mt-1 text-sm text-slate-700">{a.summary}</div>}
                        </motion.a>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
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
            <span>{new Date().getFullYear()} Trendy Stocks Predictor</span>
            <a href="https://vitejs.dev" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:text-blue-800"></a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

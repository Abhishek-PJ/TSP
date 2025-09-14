import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, PriceScaleMode } from 'lightweight-charts';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

export default function CandlestickChart({ symbol, height, interval = '1d', range = '6mo' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const resizeObsRef = useRef(null);
  const barSpacingRef = useRef(8);

  // Theme removed; default chart styling to light theme
  const isDark = false;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastCandle, setLastCandle] = useState(null);
  const [hoverCandle, setHoverCandle] = useState(null);
  const [useLog, setUseLog] = useState(false);

  // Controls state
  const [selInterval, setSelInterval] = useState(interval);
  const [selRange, setSelRange] = useState(range);

  const display = hoverCandle || lastCandle;

  // Allowed ranges per interval (Yahoo Finance compatibility)
  const allowedRangesByInterval = {
    '5m': ['5d', '1mo', '3mo'],
    '30m': ['1mo', '3mo', '6mo', '1y'],
    '1h': ['1mo', '3mo', '6mo', '1y', '2y'],
    '1d': ['1mo', '3mo', '6mo', '1y', '5y', 'max'],
    '1mo': ['1y', '5y', '10y', 'max'],
  };

  function ensureRangeCompatible(nextInterval, currentRange) {
    const allowed = allowedRangesByInterval[nextInterval] || [];
    if (allowed.includes(currentRange)) return currentRange;
    return allowed[0] || currentRange;
  }

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;
    const initialHeight = height || containerRef.current.clientHeight || 420;
    const layoutColors = {
      light: {
        background: '#ffffff',
        text: '#0f172a',
        grid: '#f1f5f9',
        watermark: 'rgba(2,6,23,0.12)',
      },
    };
    const theme = layoutColors.light;
    const chart = createChart(containerRef.current, {
      height: initialHeight,
      layout: { background: { type: 'solid', color: theme.background }, textColor: theme.text },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, mode: useLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      leftPriceScale: { visible: false },
      timeScale: { borderVisible: false, barSpacing: barSpacingRef.current },
      watermark: { visible: true, fontSize: 20, horzAlign: 'left', vertAlign: 'bottom', color: theme.watermark, text: symbol },
    });
    chartRef.current = chart;

    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.seriesData) return;
      const c = param.seriesData.get(candleSeriesRef.current);
      if (c) setHoverCandle(c); else setHoverCandle(null);
    });

    // Resize handling
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === containerRef.current) {
          const { width, height: h } = entry.contentRect;
          if (width > 0 && h > 0) {
            chart.applyOptions({ width, height: height || h });
          }
        }
      }
    });
    resizeObsRef.current = ro;
    ro.observe(containerRef.current);
  }, [height, symbol, useLog]);

  // Update watermark text when symbol changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ watermark: { visible: true, fontSize: 20, horzAlign: 'left', vertAlign: 'bottom', color: 'rgba(2,6,23,0.12)', text: symbol } });
    }
  }, [symbol]);

  // Toggle log/normal
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ rightPriceScale: { borderVisible: false, mode: useLog ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal } });
    }
  }, [useLog]);

  // Respond to theme change for chart layout/grid colors
  useEffect(() => {
    if (!chartRef.current) return;
    const theme = {
      background: '#ffffff',
      text: '#0f172a',
      grid: '#f1f5f9',
      watermark: 'rgba(2,6,23,0.12)',
    };
    chartRef.current.applyOptions({
      layout: { background: { type: 'solid', color: theme.background }, textColor: theme.text },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      watermark: { visible: true, fontSize: 20, horzAlign: 'left', vertAlign: 'bottom', color: theme.watermark, text: symbol },
    });
  }, [symbol]);

  // Fetch data whenever symbol/interval/range changes
  useEffect(() => {
    async function load() {
      if (!symbol) return;
      setLoading(true); setError(''); setLastCandle(null); setHoverCandle(null);
      try {
        const res = await fetch(`${API_BASE}/api/ohlc/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(selInterval)}&range=${encodeURIComponent(selRange)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const candles = Array.isArray(data.candles) ? data.candles : [];

        const candleData = candles.map((c) => ({ time: Number(c.time), open: +c.open, high: +c.high, low: +c.low, close: +c.close }));

        candleSeriesRef.current?.setData(candleData);
        setLastCandle(candleData[candleData.length - 1] || null);
        chartRef.current?.timeScale().fitContent();
      } catch (e) {
        setError(e.message || 'Failed to load OHLC data');
      } finally { setLoading(false); }
    }
    load();
  }, [symbol, selInterval, selRange]);

  function zoomIn() {
    barSpacingRef.current = Math.min(barSpacingRef.current + 2, 50);
    chartRef.current?.applyOptions({ timeScale: { barSpacing: barSpacingRef.current } });
  }
  function zoomOut() {
    barSpacingRef.current = Math.max(barSpacingRef.current - 2, 2);
    chartRef.current?.applyOptions({ timeScale: { barSpacing: barSpacingRef.current } });
  }
  function resetView() {
    barSpacingRef.current = 8;
    chartRef.current?.applyOptions({ timeScale: { barSpacing: barSpacingRef.current } });
    chartRef.current?.timeScale().fitContent();
  }

  // UI controls presets (restricted)
  const ranges = [
    { key: '5d', label: '5D' },
    { key: '1mo', label: '1M' },
    { key: '3mo', label: '3M' },
    { key: '6mo', label: '6M' },
    { key: '1y', label: '1Y' },
    { key: '2y', label: '2Y' },
    { key: '5y', label: '5Y' },
    { key: '10y', label: '10Y' },
    { key: 'max', label: 'Max' },
  ];
  const intervals = [
    { key: '5m', label: '5m' },
    { key: '30m', label: '30m' },
    { key: '1h', label: '1h' },
    { key: '1d', label: '1d' },
    { key: '1mo', label: '1mo' },
  ];

  function onIntervalClick(next) {
    setSelInterval((prev) => {
      const compatibleRange = ensureRangeCompatible(next, selRange);
      if (compatibleRange !== selRange) setSelRange(compatibleRange);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Range</span>
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {ranges.map((r) => (
              <button key={r.key} className={`px-3 py-1.5 text-sm font-bold ${selRange === r.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`} onClick={() => setSelRange(r.key)} type="button">{r.label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Interval</span>
          <div className="flex rounded-xl border border-slate-200 overflow-hidden">
            {intervals.map((it) => (
              <button key={it.key} className={`px-3 py-1.5 text-sm font-bold ${selInterval === it.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`} onClick={() => onIntervalClick(it.key)} type="button">{it.label}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setUseLog((v) => !v)} className={`px-3 py-1.5 text-sm font-bold rounded-xl border ${useLog ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`} type="button">{useLog ? 'Log' : 'Linear'}</button>
          <div className="flex items-center gap-1">
            <button onClick={zoomOut} className="px-2 py-1.5 text-sm font-bold rounded-xl border bg-white text-slate-700 border-slate-200 hover:bg-slate-50" type="button">−</button>
            <button onClick={zoomIn} className="px-2 py-1.5 text-sm font-bold rounded-xl border bg-white text-slate-700 border-slate-200 hover:bg-slate-50" type="button">＋</button>
            <button onClick={resetView} className="px-2 py-1.5 text-sm font-bold rounded-xl border bg-white text-slate-700 border-slate-200 hover:bg-slate-50" type="button">Reset</button>
          </div>
        </div>
      </div>

      {/* OHLC header */}
      {display && (
        <div className="flex flex-wrap items-center gap-3 text-sm shrink-0">
          <span className="font-extrabold text-slate-900">{symbol}</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold">O: {Number(display.open).toFixed(2)}</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold">H: {Number(display.high).toFixed(2)}</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold">L: {Number(display.low).toFixed(2)}</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-50 font-extrabold" style={{ color: Number(display.close) >= Number(display.open) ? '#065f46' : '#991b1b' }}>C: {Number(display.close).toFixed(2)}</span>
          <span className="px-2 py-0.5 rounded-lg bg-slate-50 text-slate-600 font-semibold">{selInterval} · {selRange}</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 shrink-0">{error}</div>
      )}

      {/* Chart area */}
      <div ref={containerRef} className="w-full flex-1 min-h-0" />

      {loading && <div className="text-xs text-slate-500 shrink-0">Loading chart…</div>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

export default function SymbolDetails() {
  const { symbol } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [articles, setArticles] = useState([]);

  // Helper: dd-mm-yyyy
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

  // Helper: dd-mm-yyyy hh:mm (24h)
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

  // Helper: dd-mm-yyyy hh:mm am/pm (12h)
  function formatDateTimeDMY12(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    let h = d.getHours();
    const suffix = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    const hh = String(h).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${hh}:${min} ${suffix}`;
  }

  async function fetchNews() {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_BASE}/api/news/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (e) {
      setError(e.message || 'Failed to load news');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="w-full px-6 lg:px-10 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link to="/" className="text-blue-600 dark:text-blue-400 font-bold hover:text-blue-800 dark:hover:text-blue-300">← Back</Link>
              <div>
                <div className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">{symbol} — News (48h)</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Latest headlines and summaries</div>
              </div>
            </div>
            <button onClick={fetchNews} disabled={loading} className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] shadow-md disabled:opacity-60">
              {loading ? 'Updating…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="w-full px-6 lg:px-10 py-6">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 rounded-xl p-4 mb-4">{error}</div>
        )}

        {loading && (
          <div className="grid gap-4 mb-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 animate-pulse" />
            ))}
          </div>
        )}

        <div className="grid gap-4">
          {articles.length === 0 && !loading && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-slate-600 dark:text-slate-400">No recent articles.</div>
          )}
          {articles.map((a, idx) => (
            <a
              key={idx}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{formatDateTimeDMY12(a.publishedAt)}</div>
              <div className="mt-1 font-bold text-slate-900 dark:text-white">{a.title}</div>
              {a.summary && <div className="mt-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{a.summary}</div>}
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

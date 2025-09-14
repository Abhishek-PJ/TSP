import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../index.css';

const API_BASE = '';

export default function SymbolDetails() {
  const { symbol } = useParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [articles, setArticles] = useState([]);

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
    <div className="app-root">
      <header className="app-header">
        <div className="container" style={{paddingTop:16, paddingBottom:16}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:16}}>
            <div style={{display:'flex', alignItems:'center', gap:12}}>
              <Link to="/" style={{fontSize:14, fontWeight:700, color:'var(--primary)', textDecoration:'none'}}>← Back</Link>
              <div>
                <div className="brand-title" style={{fontSize:20}}>{symbol} — News (48h)</div>
                <div className="brand-subtitle">Latest headlines and summaries</div>
              </div>
            </div>
            <button onClick={fetchNews} disabled={loading} className="btn btn-primary">
              {loading ? 'Updating…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="container" style={{paddingTop:24, paddingBottom:24}}>
        {error && (
          <div className="card" style={{borderColor:'#fecaca', background:'#fef2f2', color:'#991b1b', padding:16, marginBottom:16}}>{error}</div>
        )}

        {loading && (
          <div style={{display:'grid', gap:16, marginBottom:24}}>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card" style={{height:96}} />
            ))}
          </div>
        )}

        <div style={{display:'grid', gap:16}}>
          {articles.length === 0 && !loading && (
            <div className="card" style={{padding:24, color:'var(--text-muted)'}}>No recent articles.</div>
          )}
          {articles.map((a, idx) => (
            <a key={idx} href={a.url} target="_blank" rel="noreferrer" className="card" style={{padding:24, textDecoration:'none', color:'inherit'}}>
              <div style={{fontSize:12, color:'#64748b'}}>{new Date(a.publishedAt).toLocaleString()}</div>
              <div style={{marginTop:6, fontWeight:800, color:'var(--text)'}}>{a.title}</div>
              {a.summary && <div style={{marginTop:8, fontSize:14, color:'#334155', lineHeight:1.5}}>{a.summary}</div>}
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

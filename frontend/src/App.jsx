import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './index.css';

const API_BASE = '';

function Badge({ text, variant = 'neutral' }) {
  const styles = {
    positive: 'badge-positive',
    negative: 'badge-negative',
    watch: 'badge-watch',
    bullish: 'badge-bullish',
    skip: 'badge-skip',
  };
  return <span className={`badge ${styles[variant] || ''}`}>{String(text)}</span>;
}

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState([]);
  const [asOf, setAsOf] = useState('');
  const [marketOpen, setMarketOpen] = useState(true);
  const [sessionDate, setSessionDate] = useState('');
  const [health, setHealth] = useState({ redis: false });

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

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="container" style={{paddingTop:16, paddingBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div className="brand">
            <div className="brand-logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div>
              <div className="brand-title">Stock Market Analytics</div>
              <div className="brand-subtitle">AI-Powered Trend Prediction Platform</div>
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:16}}>
            <button onClick={fetchPicks} disabled={loading} className="btn btn-primary">
              {loading ? 'Updating…' : 'Refresh Data'}
            </button>
            {asOf && (
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:12, fontWeight:700, color:'var(--text)'}}>Last Updated</div>
                <div style={{fontSize:13, color:'var(--text-muted)'}}>{new Date(asOf).toLocaleTimeString()}</div>
              </div>
            )}
            <span className={`status ${health.redis ? '' : 'off'}`}>
              <span style={{width:10, height:10, borderRadius:999, background: health.redis ? 'var(--emerald)' : 'var(--red)'}} />
              Redis {health.redis ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <main className="container" style={{paddingTop:24, paddingBottom:24}}>
        {!marketOpen && (
          <div className="card" style={{padding:16, marginBottom:16, borderColor:'#fde68a', background:'#fffbeb', color:'#92400e'}}>
            Market Closed — Showing last session's picks{sessionDate ? ` (${sessionDate})` : ''}.
          </div>
        )}
        {error && (
          <div className="card" style={{borderColor:'#fecaca', background:'#fef2f2', color:'#991b1b', padding:16, marginBottom:16}}>{error}</div>
        )}

        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Today's Market Picks</div>
              <div className="card-subtitle">AI-curated investment opportunities</div>
            </div>
            {loading && <div className="card-subtitle">Loading…</div>}
          </div>
          <div>
            {loading && (
              <div style={{padding:20}}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="row-item">
                    <div className="row-inner">
                      <div className="metric" style={{height:12, width:'40%'}} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && sorted.length === 0 && (
              <div style={{padding:24, fontSize:14, color:'var(--text-muted)'}}>No candidates yet. Try refresh.</div>
            )}

            {!loading && sorted.length > 0 && (
              <div style={{display:'grid', gap:16, padding:16}}>
                {/* Bullish Table */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Bullish</div>
                      <div className="card-subtitle">Strong positive sentiment and metrics</div>
                    </div>
                    <Badge text={`${grouped.bull.length} picks`} variant="bullish" />
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
                      <thead>
                        <tr style={{textAlign:'left', color:'#64748b', fontSize:12}}>
                          <th style={{padding:'12px 16px'}}>Symbol</th>
                          <th style={{padding:'12px 16px'}}>Change</th>
                          <th style={{padding:'12px 16px'}}>Open</th>
                          <th style={{padding:'12px 16px'}}>LTP</th>
                          <th style={{padding:'12px 16px'}}>Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.bull.map((row) => (
                          <tr key={row.symbol} style={{borderTop:'1px solid #f1f5f9'}}>
                            <td style={{padding:'12px 16px'}}>
                              <Link to={`/symbol/${encodeURIComponent(row.symbol)}`} className="symbol">{row.symbol}</Link>
                            </td>
                            <td style={{padding:'12px 16px'}}>
                              <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                            </td>
                            <td style={{padding:'12px 16px'}}>₹{row.open.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>₹{row.ltp.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>{row.volume.toLocaleString()}</td>
                          </tr>
                        ))}
                        {grouped.bull.length === 0 && (
                          <tr><td colSpan={5} style={{padding:'12px 16px', color:'var(--text-muted)'}}>No bullish picks.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Watch Table */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Watch</div>
                      <div className="card-subtitle">Meets some criteria; monitor closely</div>
                    </div>
                    <Badge text={`${grouped.watch.length} picks`} variant="watch" />
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
                      <thead>
                        <tr style={{textAlign:'left', color:'#64748b', fontSize:12}}>
                          <th style={{padding:'12px 16px'}}>Symbol</th>
                          <th style={{padding:'12px 16px'}}>Change</th>
                          <th style={{padding:'12px 16px'}}>Open</th>
                          <th style={{padding:'12px 16px'}}>LTP</th>
                          <th style={{padding:'12px 16px'}}>Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.watch.map((row) => (
                          <tr key={row.symbol} style={{borderTop:'1px solid #f1f5f9'}}>
                            <td style={{padding:'12px 16px'}}>
                              <Link to={`/symbol/${encodeURIComponent(row.symbol)}`} className="symbol">{row.symbol}</Link>
                            </td>
                            <td style={{padding:'12px 16px'}}>
                              <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                            </td>
                            <td style={{padding:'12px 16px'}}>₹{row.open.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>₹{row.ltp.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>{row.volume.toLocaleString()}</td>
                          </tr>
                        ))}
                        {grouped.watch.length === 0 && (
                          <tr><td colSpan={5} style={{padding:'12px 16px', color:'var(--text-muted)'}}>No watchlist picks.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Skip Table */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <div className="card-title">Skip</div>
                      <div className="card-subtitle">Fails numeric/sentiment checks</div>
                    </div>
                    <Badge text={`${grouped.skip.length} picks`} variant="skip" />
                  </div>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%', borderCollapse:'separate', borderSpacing:0}}>
                      <thead>
                        <tr style={{textAlign:'left', color:'#64748b', fontSize:12}}>
                          <th style={{padding:'12px 16px'}}>Symbol</th>
                          <th style={{padding:'12px 16px'}}>Change</th>
                          <th style={{padding:'12px 16px'}}>Open</th>
                          <th style={{padding:'12px 16px'}}>LTP</th>
                          <th style={{padding:'12px 16px'}}>Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grouped.skip.map((row) => (
                          <tr key={row.symbol} style={{borderTop:'1px solid #f1f5f9'}}>
                            <td style={{padding:'12px 16px'}}>
                              <Link to={`/symbol/${encodeURIComponent(row.symbol)}`} className="symbol">{row.symbol}</Link>
                            </td>
                            <td style={{padding:'12px 16px'}}>
                              <Badge text={`${row.pct_change >= 0 ? '+' : ''}${row.pct_change.toFixed(2)}%`} variant={row.pct_change >= 0 ? 'positive' : 'negative'} />
                            </td>
                            <td style={{padding:'12px 16px'}}>₹{row.open.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>₹{row.ltp.toFixed(2)}</td>
                            <td style={{padding:'12px 16px'}}>{row.volume.toLocaleString()}</td>
                          </tr>
                        ))}
                        {grouped.skip.length === 0 && (
                          <tr><td colSpan={5} style={{padding:'12px 16px', color:'var(--text-muted)'}}>No symbols to skip.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>


        <div style={{marginTop:24, fontSize:12, color:'var(--text-muted)'}}>
          Rules: +1% to +3% gain, Open ≥ ₹50, Volume ≥ 100,000, and positive recent news ⇒ Bullish. Otherwise, Watch/Skip.
        </div>
      </main>

      <footer className="app-footer">
        <div className="container" style={{paddingTop:16, paddingBottom:16}}>
          <div className="footer-row">
            <span>© {new Date().getFullYear()} Stock Trend Predictor</span>
            <a href="https://vitejs.dev" target="_blank" rel="noreferrer" style={{color:'var(--primary)', fontWeight:700}}>Built with Vite + React</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
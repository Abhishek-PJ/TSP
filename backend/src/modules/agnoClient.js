// backend/src/modules/agnoClient.js
// Client for Agno sentiment agent service with timeout and fallback logic

import fetch from 'node-fetch';

const AGNO_URL = process.env.AGNO_URL || 'http://localhost:8000';
const TIMEOUT = parseInt(process.env.AGNO_TIMEOUT_MS || '15000', 10);
const ENABLED = process.env.AGNO_ENABLED === 'true';

// Metrics tracking
let metrics = {
  totalCalls: 0,
  totalFailures: 0,
  totalDuration: 0,
};

export function getAgnoMetrics() {
  return {
    ...metrics,
    avgLatencyMs: metrics.totalCalls > 0 ? Math.round(metrics.totalDuration / metrics.totalCalls) : 0,
  };
}

export async function getAgnoPicks(symbols, newsMap) {
  if (!ENABLED) {
    console.log('[agno] Service disabled via AGNO_ENABLED flag');
    return null;
  }

  const startTime = Date.now();
  metrics.totalCalls++;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    console.log(`[agno] Calling agent for ${symbols.length} symbols...`);
    
    const res = await fetch(`${AGNO_URL}/picks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols, news: newsMap }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    metrics.totalDuration += duration;

    if (!res.ok) {
      throw new Error(`agno HTTP ${res.status}`);
    }

    const result = await res.json();
    console.log(`[agno] Success in ${duration}ms - received ${result.data?.length || 0} results`);
    return result.data;
  } catch (err) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    metrics.totalDuration += duration;
    metrics.totalFailures++;

    if (err.name === 'AbortError') {
      console.error(`[agno] Timeout after ${TIMEOUT}ms`);
    } else {
      console.error('[agno] Error:', err.message);
    }
    return null;
  }
}

export async function checkAgnoHealth() {
  if (!ENABLED) return { status: 'disabled' };
  
  try {
    const res = await fetch(`${AGNO_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { status: 'error', code: res.status };
    const data = await res.json();
    return { status: 'ok', ...data };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

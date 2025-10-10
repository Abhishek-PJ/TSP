// backend/src/modules/agnoClient.js
// Client for Agno sentiment agent service with timeout, retries, and metrics

import fetch from 'node-fetch';

const AGNO_URL = process.env.AGNO_URL || 'http://localhost:8000';
const TIMEOUT_MS = parseInt(process.env.AGNO_TIMEOUT_MS || '15000', 10);
const ENABLED = String(process.env.AGNO_ENABLED || '').toLowerCase() === 'true';
const RETRIES = Math.max(0, parseInt(process.env.AGNO_RETRIES || '2', 10)); // number of retries after the first try

// Metrics tracking (simple rolling counters)
let metrics = {
  totalCalls: 0,
  totalFailures: 0,
  totalDuration: 0, // ms
  lastStatus: 'idle', // 'idle' | 'ok' | 'timeout' | 'error' | 'disabled'
  lastError: '',
  lastOkAt: 0, // epoch ms
};

export function getAgnoMetrics() {
  const avgLatencyMs =
    metrics.totalCalls > 0 ? Math.round(metrics.totalDuration / metrics.totalCalls) : 0;
  return {
    totalCalls: metrics.totalCalls,
    totalFailures: metrics.totalFailures,
    avgLatencyMs,
    lastStatus: metrics.lastStatus,
    lastError: metrics.lastError,
    lastOkAt: metrics.lastOkAt,
  };
}

function normalizeSymbols(symbols) {
  if (!Array.isArray(symbols)) return [];
  return [...new Set(symbols.map((s) => String(s || '').trim()).filter(Boolean))];
}

function normalizeNewsMap(newsMap) {
  const out = {};
  if (newsMap && typeof newsMap === 'object') {
    for (const [sym, arr] of Object.entries(newsMap)) {
      if (!Array.isArray(arr)) continue;
      out[sym] = arr.map((a) => ({
        title: (a?.title ?? '').toString(),
        summary: (a?.summary ?? '').toString(),
        url: a?.url,
        publishedAt: a?.publishedAt,
      }));
    }
  }
  return out;
}

function withTimeoutAbortController(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  // attempt: 0,1,2,...  base^attempt + jitter
  const base = 400; // ms
  const max = 4000; // ms
  const pow = Math.min(max, base * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 200);
  return pow + jitter;
}

function normalizeAgnoResponse(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

/**
 * Call the Agno /picks API with retries and timeout.
 * @param {string[]} symbols
 * @param {Record<string, Array<{title:string, summary:string, url?:string, publishedAt?:string}>>} newsMap
 * @returns {Promise<Array>} results array (empty if none or disabled/failed)
 */
export async function getAgnoPicks(symbols, newsMap) {
  if (!ENABLED) {
    metrics.lastStatus = 'disabled';
    return null; // preserve original contract when disabled
  }

  const cleanSymbols = normalizeSymbols(symbols);
  const cleanNews = normalizeNewsMap(newsMap);

  if (cleanSymbols.length === 0) {
    // Nothing to do; do not count as a failure
    return [];
  }

  let attempt = 0;
  let lastError = '';

  while (attempt <= RETRIES) {
    const started = Date.now();
    metrics.totalCalls += 1;
    const { signal, clear } = withTimeoutAbortController(TIMEOUT_MS);

    try {
      const res = await fetch(`${AGNO_URL}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: cleanSymbols, news: cleanNews }),
        signal,
      });
      clear();

      const duration = Date.now() - started;
      metrics.totalDuration += duration;

      if (!res.ok) {
        lastError = `agno HTTP ${res.status}`;
        throw new Error(lastError);
      }

      const json = await res.json();
      const data = normalizeAgnoResponse(json);

      metrics.lastStatus = 'ok';
      metrics.lastError = '';
      metrics.lastOkAt = Date.now();

      // Return the normalized array (original code expects `result.data`, but callers can accept array)
      return data;
    } catch (err) {
      clear();
      const duration = Date.now() - started;
      metrics.totalDuration += duration;
      metrics.totalFailures += 1;

      // Node-fetch AbortError name
      if (err?.name === 'AbortError') {
        metrics.lastStatus = 'timeout';
        lastError = `Timeout after ${TIMEOUT_MS}ms`;
      } else {
        metrics.lastStatus = 'error';
        lastError = err?.message || 'unknown_error';
      }

      metrics.lastError = lastError;

      if (attempt < RETRIES) {
        const delay = backoffDelay(attempt);
        // Optional: console.warn(`[agno] attempt ${attempt + 1} failed (${lastError}). Retrying in ${delay}ms...`);
        await sleep(delay);
        attempt += 1;
        continue;
      }

      // Out of retries -> return null to trigger VADER fallback in callers
      // Optional: console.error('[agno] final failure:', lastError);
      return null;
    }
  }

  // Should never get here
  return null;
}

/**
 * Health check (exported as checkAgnoPredictionHealth to match backend import)
 * Returns:
 *  - { status: 'disabled' } when disabled
 *  - { status: 'ok', ...json } when /health responds 200
 *  - { status: 'error', code?, message? } otherwise
 */
export async function checkAgnoPredictionHealth() {
  if (!ENABLED) return { status: 'disabled' };

  const { signal, clear } = withTimeoutAbortController(5000);
  try {
    const res = await fetch(`${AGNO_URL}/health`, { signal });
    clear();
    if (!res.ok) return { status: 'error', code: res.status };
    const data = await res.json();
    return { status: 'ok', ...data };
  } catch (err) {
    clear();
    return { status: 'error', message: err?.message || 'fetch_failed' };
  }
}

// Optional legacy alias (if some parts still import checkAgnoHealth)
export const checkAgnoHealth = checkAgnoPredictionHealth;

// Redis-backed cache with in-memory fallback
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config(); // Load .env variables

const memStore = new Map();
let redis = null;
let useRedis = false;


function initRedis() {
  const url = process.env.REDIS_URL;

  if (!url) {
    console.warn('REDIS_URL not found, using in-memory cache only.');
    return;
  }

  redis = new Redis(url);

  redis.on('error', (e) => {
    console.warn('Redis error:', e?.message || e);
    useRedis = false;
  });

  redis.on('ready', () => {
    useRedis = true;
    console.log('Redis cache connected');
  });
}

initRedis();

export async function setCached(key, value, ttlMs) {
  const payload = JSON.stringify({ v: value });

  if (useRedis && redis) {
    if (ttlMs && ttlMs > 0) {
      await redis.set(key, payload, 'PX', ttlMs);
    } else {
      await redis.set(key, payload);
    }
    return;
  }

  const expiresAt = Date.now() + (ttlMs || 0);
  memStore.set(key, { value, expiresAt });
}

export async function getCached(key) {
  if (useRedis && redis) {
    const raw = await redis.get(key);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      return parsed?.v ?? null;
    } catch {
      return null;
    }
  }

  const entry = memStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memStore.delete(key);
    return null;
  }

  return entry.value;
}

export function clearCache() {
  memStore.clear();
}

export function isRedisEnabled() {
  return !!useRedis;
}

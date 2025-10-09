# agent/server.py
import os
import json
import time
import re
import asyncio
import hashlib
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

# Non-blocking Redis client
import redis.asyncio as redis  # type: ignore

# Gemini SDK (sync API; we'll run it in a worker thread)
import google.generativeai as genai
from anyio import to_thread

load_dotenv()

# --- Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
CACHE_TTL_SECONDS = int(os.getenv("AGENT_CACHE_TTL", "3600"))  # 1 hour

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

r = redis.from_url(REDIS_URL, decode_responses=True)

app = FastAPI(title="TrendyStocks-Agent")


# --- Request Schema ---
class NewsItem(BaseModel):
    title: Optional[str] = ""
    summary: Optional[str] = ""


class PicksRequest(BaseModel):
    symbols: List[str]
    news: Dict[str, List[NewsItem]]


# --- Utils ---
def _headlines_fingerprint(articles: List[Dict[str, Any]], limit: int = 5) -> str:
    """Create a stable fingerprint for headlines to make cache news-aware."""
    h = hashlib.sha1()
    for a in articles[:limit]:
        title = (a.get("title") or "").strip()
        summary = (a.get("summary") or "").strip()
        h.update(title.encode("utf-8", errors="ignore"))
        h.update(b"|")
        h.update(summary.encode("utf-8", errors="ignore"))
        h.update(b"\n")
    return h.hexdigest()


def _extract_first_json_object(s: str) -> str:
    """
    Extract the first top-level JSON object from a string.
    Handles cases with extra text or markdown fences.
    """
    if not s:
        return ""
    # Strip code fences if present
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", s, re.I)
    if m:
        s = m.group(1).strip()

    # If it already looks like pure JSON, return it
    s_stripped = s.strip()
    if s_stripped.startswith("{") and s_stripped.endswith("}"):
        return s_stripped

    # Otherwise, greedy scan for first {...} block
    depth = 0
    start = -1
    for i, ch in enumerate(s):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start != -1:
                return s[start : i + 1]
    return s_stripped  # best effort


def _coerce_json_object(text: str) -> Dict[str, Any]:
    """
    Try to parse JSON; also tries removing trailing commas.
    Raises ValueError on failure.
    """
    candidate = _extract_first_json_object(text)
    try:
        return json.loads(candidate)
    except Exception:
        candidate = re.sub(r",\s*([}\]])", r"\1", candidate)  # remove trailing commas
        return json.loads(candidate)


def _build_prompt(symbol: str, articles: List[Dict[str, str]]) -> str:
    lines = []
    for a in articles[:5]:
        title = (a.get("title") or "").strip()
        summary = (a.get("summary") or "").strip()
        if title:
            lines.append(f"- {title}{(' — ' + summary) if summary else ''}")
    headlines = "\n".join(lines) or "(no headlines provided)"

    return f"""
You are given recent headlines for {symbol}. Produce EXACTLY one JSON object with these fields:
  "symbol": string
  "sentiment_score": number between -1.0 and 1.0  // use float
  "sentiment_label": one of "BULLISH","WATCH","SKIP"
  "reason": short string (1-2 sentences)

Headlines:
{headlines}

OUTPUT RULES (CRITICAL):
- Return ONLY a single raw JSON object. No explanations.
- Do NOT wrap output in Markdown or code fences.
- Do NOT include trailing commas. Keys must be double-quoted.
"""


# --- Sentiment Analyzer with Async Retry, Backoff, and Redis Cache ---
async def analyze_sentiment(symbol: str, articles: List[Dict[str, str]], retries: int = 3) -> Dict[str, Any]:
    """
    Analyze sentiment for a stock symbol using Gemini API with async retry/backoff + Redis caching.
    Runs the synchronous Gemini call in a worker thread.
    """
    if not GEMINI_API_KEY:
        # If no API key, return neutral WATCH with reason.
        return {
            "symbol": symbol,
            "sentiment_score": 0.0,
            "sentiment_label": "WATCH",
            "reason": "gemini_api_key_missing",
        }

    # Cache key includes headlines fingerprint to keep cache fresh per news set
    fingerprint = _headlines_fingerprint([a.dict() if isinstance(a, NewsItem) else a for a in articles])
    cache_key = f"sentiment:{symbol}:{fingerprint}"

    cached = await r.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            # Bad cache entry; drop it
            await r.delete(cache_key)

    prompt = _build_prompt(symbol, [a.dict() if isinstance(a, NewsItem) else a for a in articles])

    model_name = GEMINI_MODEL
    delay = 5  # seconds

    for attempt in range(retries):
        try:
            # Build the model each attempt to allow fallback changes
            model = genai.GenerativeModel(
                model_name,
                generation_config={"response_mime_type": "application/json"},
            )

            # Run sync call in a worker thread to avoid blocking the event loop
            response = await to_thread.run_sync(model.generate_content, prompt)
            text = (getattr(response, "text", None) or "").strip()

            parsed = _coerce_json_object(text)

            # Normalize + validate output
            symbol_out = parsed.get("symbol") or symbol
            score = float(parsed.get("sentiment_score", 0.0))
            label = parsed.get("sentiment_label", "WATCH")
            reason = parsed.get("reason", "")

            if label not in {"BULLISH", "WATCH", "SKIP"}:
                label = "WATCH"

            result = {
                "symbol": symbol_out,
                "sentiment_score": round(score, 4),
                "sentiment_label": label,
                "reason": reason,
            }

            await r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(result))
            return result

        except Exception as e:
            msg = str(e).lower()
            # Rate limit / quota-like messages
            if "429" in msg or "quota" in msg or "rate" in msg:
                print(f"[agent] Rate limit for {symbol}. Backing off {delay}s (attempt {attempt+1}/{retries})")
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60)  # cap backoff
                continue
            # Unsupported model -> fallback to a lighter model once
            if ("not found" in msg or "unsupported" in msg or "invalid model" in msg) and model_name != "gemini-2.5-flash-lite":
                print(f"[agent] Fallback to gemini-2.5-flash-lite for {symbol}")
                model_name = "gemini-2.5-flash-lite"
                continue

            # Any other error: on last attempt, raise; otherwise brief backoff
            if attempt < retries - 1:
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise

    # If we got here, retries exhausted
    raise HTTPException(status_code=429, detail=f"Gemini rate limit exceeded for {symbol}")


# --- Endpoint ---
@app.post("/picks")
async def picks(body: PicksRequest):
    if not isinstance(body.symbols, list) or not body.symbols:
        raise HTTPException(status_code=400, detail="symbols must be a non-empty list")

    # Convert news to plain dicts for downstream use
    news_map: Dict[str, List[Dict[str, Any]]] = {
        sym: [ni.dict() if isinstance(ni, NewsItem) else dict(ni) for ni in (body.news.get(sym) or [])]
        for sym in body.symbols
    }

    # Concurrency limiter to avoid Gemini rate-limit bursts
    semaphore = asyncio.Semaphore(int(os.getenv("AGENT_CONCURRENCY", "5")))

    async def process_symbol(sym: str):
        async with semaphore:
          try:
              articles = (news_map.get(sym) or [])[:8]
              out = await analyze_sentiment(sym, articles)
              return out
          except Exception as e:
              print(f"[agent] Error analyzing {sym}: {e}")
              return {
                  "symbol": sym,
                  "error": str(e),
                  "sentiment_score": 0.0,
                  "sentiment_label": "WATCH",
                  "reason": "agent_error",
              }

    results = await asyncio.gather(*[process_symbol(sym) for sym in body.symbols])
    return {"data": results, "ts": int(time.time())}


# --- Health Endpoint ---
@app.get("/health")
async def health():
    try:
        await r.ping()
        redis_status = "connected"
    except Exception:
        redis_status = "disconnected"

    return {
        "agent": "ok",
        "redis": redis_status,
        "gemini": "configured" if bool(GEMINI_API_KEY) else "missing",
        "model": GEMINI_MODEL,
    }

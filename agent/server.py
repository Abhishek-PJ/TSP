# agent/server.py
import os
import json
import time
import re
import asyncio
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import redis
import google.generativeai as genai

load_dotenv()

# --- Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

genai.configure(api_key=GEMINI_API_KEY)
r = redis.from_url(REDIS_URL, decode_responses=True)

app = FastAPI(title="TrendyStocks-Agent")


# --- Request Schema ---
class PicksRequest(BaseModel):
    symbols: List[str]
    news: Dict[str, List[Dict[str, Any]]]


# --- Sentiment Analyzer with Retry, Backoff, and Redis Cache ---
def analyze_sentiment(symbol: str, articles: List[Dict[str, str]], retries: int = 3):
    """Analyze sentiment for a stock symbol using Gemini API with retry/backoff + Redis caching"""

    cache_key = f"sentiment:{symbol}"
    cached = r.get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            r.delete(cache_key)

    # Prepare text
    lines = []
    for a in articles[:5]:
        title = a.get("title", "").strip()
        summary = a.get("summary", "").strip()
        lines.append(f"- {title} {(' — ' + summary) if summary else ''}")
    headlines = "\n".join(lines)

    prompt = f"""
You are given recent headlines for {symbol}. Produce EXACTLY one JSON object with these fields:
  - symbol: string
  - sentiment_score: float   # -1.0 .. +1.0
  - sentiment_label: one of "BULLISH","WATCH","SKIP"
  - reason: short string (1-2 sentences)

Headlines:
{headlines}

OUTPUT RULES (CRITICAL):
- Return ONLY a single raw JSON object. No explanations.
- Do NOT wrap output in Markdown or code fences.
- Do NOT include trailing commas. Keys must be double-quoted.
"""

    model_name = GEMINI_MODEL  # start with default model
    delay = 5  # initial backoff seconds

    for attempt in range(retries):
        try:
            model = genai.GenerativeModel(
                model_name,
                generation_config={"response_mime_type": "application/json"},
            )
            response = model.generate_content(prompt)
            text = (response.text or "").strip()

            # Remove Markdown fences if present
            fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
            if fence:
                text = fence.group(1).strip()

            # Try to parse JSON
            try:
                parsed = json.loads(text)
            except Exception:
                no_trailing = re.sub(r",\s*([}\]])", r"\1", text)
                parsed = json.loads(no_trailing)

            # Cache result for 1 hour
            r.setex(cache_key, 3600, json.dumps(parsed))
            return parsed

        except Exception as e:
            msg = str(e).lower()
            if "429" in msg or "quota" in msg:
                print(f"[agent] Rate limit hit for {symbol}. Backing off {delay}s...")
                time.sleep(delay)
                delay *= 2
                continue
            elif "not found" in msg or "unsupported" in msg:
                if model_name != "gemini-2.5-flash-lite":
                    print(f"[agent] Fallback to gemini-2.5-flash-lite for {symbol}")
                    model_name = "gemini-2.5-flash-lite"
                    continue
            raise

    raise HTTPException(status_code=429, detail=f"Gemini rate limit exceeded for {symbol}")


# --- Endpoint ---
@app.post("/picks")
async def picks(body: PicksRequest):
    symbols = body.symbols
    news_map = body.news
    enriched = []

    # Process symbols concurrently instead of sequentially for better performance
    semaphore = asyncio.Semaphore(5)  # Limit concurrent requests to avoid rate limits

    async def process_symbol(sym):
        async with semaphore:
            articles = news_map.get(sym, [])[:8]
            try:
                out = analyze_sentiment(sym, articles)
                sentiment_score = float(out.get("sentiment_score", 0.0))
                label = out.get("sentiment_label", "WATCH")
                reason = out.get("reason", "")
                return {
                    "symbol": sym,
                    "sentiment_score": round(sentiment_score, 4),
                    "sentiment_label": label,
                    "reason": reason
                }
            except Exception as e:
                print(f"[agent] Error analyzing {sym}: {e}")
                return {
                    "symbol": sym,
                    "error": str(e),
                    "sentiment_score": 0.0,
                    "sentiment_label": "WATCH",
                    "reason": "agent_error"
                }

    # Process all symbols concurrently
    tasks = [process_symbol(sym) for sym in symbols]
    enriched = await asyncio.gather(*tasks)

    return {"data": enriched, "ts": int(time.time())}


# --- Health Endpoint ---
@app.get("/health")
def health():
    try:
        r.ping()
        redis_status = "connected"
    except Exception:
        redis_status = "disconnected"
    return {"agent": "ok", "redis": redis_status}

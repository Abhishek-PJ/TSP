# agent/server.py
import os
import json
import time
import re
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import redis

# Direct Gemini API (no Agno dependency issues)
import google.generativeai as genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
# Use a stable default model name compatible with current SDK
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Configure Gemini API
genai.configure(api_key=GEMINI_API_KEY)

r = redis.from_url(REDIS_URL, decode_responses=True)
app = FastAPI(title="TrendyStocks-Agent")

# Create Gemini model for direct use
gemini_model = genai.GenerativeModel(GEMINI_MODEL)

class PicksRequest(BaseModel):
    symbols: List[str]
    news: Dict[str, List[Dict[str, Any]]]

def analyze_sentiment(symbol: str, articles: List[Dict[str, str]]):
    """Analyze sentiment for a symbol using Gemini directly"""
    # Prepare short aggregated text (limit tokens by trimming)
    lines = []
    for a in articles[:5]:
        title = a.get("title","").strip()
        summary = a.get("summary","").strip()
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
- Do NOT wrap output in Markdown or code fences. No ```json fences.
- Do NOT include trailing commas. Keys must be double-quoted.
"""
    
    # Call Gemini API directly, with fallbacks for model name compatibility
    last_err = None
    chosen_model = None
    for model_name in [GEMINI_MODEL, "gemini-1.5-flash", "gemini-1.5-flash-8b"]:
        try:
            model = genai.GenerativeModel(
                model_name,
                generation_config={
                    "response_mime_type": "application/json",
                },
            )
            response = model.generate_content(prompt)
            text = response.text
            chosen_model = model_name
            break
        except Exception as e:
            last_err = e
            # If it's a model-not-found style error, try next; else re-raise
            msg = str(e).lower()
            if ("404" in msg) or ("not found" in msg) or ("unsupported" in msg):
                continue
            raise
    else:
        # Exhausted fallbacks
        raise last_err
    
    # Normalize common wrappers (e.g., ```json ... ```)
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.I)
    if fence:
        text = fence.group(1).strip()

    # try parsing JSON robustly
    try:
        parsed = json.loads(text)
        return parsed
    except Exception:
        # Log snippet to aid debugging
        snippet = text[:400].replace("\n", " ")
        print(f"[agent] JSON parse failed for {symbol} using model={chosen_model}. Snippet: {snippet}")

        # Attempt sanitizer: remove trailing commas and try again
        try:
            no_trailing = re.sub(r",\s*([}\]])", r"\1", text)
            return json.loads(no_trailing)
        except Exception:
            pass

        # Attempt sanitizer: if mostly single quotes, convert to double quotes
        try:
            if text.count('"') < 2 and text.count("'") >= 2:
                sq = text.replace("'", '"')
                sq = re.sub(r",\s*([}\]])", r"\1", sq)
                return json.loads(sq)
        except Exception:
            pass

        # Fallback: extract first JSON object with a permissive regex
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            return json.loads(m.group(0))
        raise ValueError("Model returned non-parsable JSON: " + text[:400])

@app.post("/picks")
async def picks(body: PicksRequest):
    symbols = body.symbols
    news_map = body.news
    enriched = []
    for sym in symbols:
        articles = news_map.get(sym, [])[:8]
        try:
            out = analyze_sentiment(sym, articles)
            # validate fields and coerce types
            sentiment_score = float(out.get("sentiment_score", 0.0))
            label = out.get("sentiment_label", "WATCH")
            reason = out.get("reason", "")
            enriched.append({
                "symbol": sym,
                "sentiment_score": round(sentiment_score, 4),
                "sentiment_label": label,
                "reason": reason
            })
        except Exception as e:
            print(f"Error analyzing {sym}: {str(e)}")  # Log the error
            enriched.append({
                "symbol": sym,
                "error": str(e),
                "sentiment_score": 0.0,
                "sentiment_label": "WATCH",
                "reason": "agent_error"
            })
    return {"data": enriched, "ts": int(time.time())}

@app.get("/health")
def health():
    try:
        r.ping()
        redis_status = "connected"
    except Exception:
        redis_status = "disconnected"
    return {"agent":"ok","redis":redis_status}

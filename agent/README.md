# TrendyStocks Agent Service

Lightweight Python microservice using Agno with Google Gemini to analyze financial news sentiment and generate stock recommendations.

## Setup

### 1. Install Dependencies
```bash
cd agent
pip install -r requirements.txt
```

### 2. Configure Environment
Create `.env` file from the example:
```bash
cp .env.example .env
```

Edit `.env` and set your Google Gemini API key:
```env
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-1.5-flash
REDIS_URL=redis://localhost:6379/0
```

### 3. Run Locally
```bash
uvicorn server:app --reload --port 8000
```

The service will be available at `http://localhost:8000`

## API Endpoints

### POST /picks
Analyze news sentiment for multiple symbols.

**Request:**
```json
{
  "symbols": ["TCS", "INFY"],
  "news": {
    "TCS": [
      {"title": "TCS Q2 beats estimates", "summary": "Revenue up 12%"}
    ],
    "INFY": [
      {"title": "INFY wins large deal", "summary": "5-year outsourcing contract"}
    ]
  }
}
```

**Response:**
```json
{
  "data": [
    {
      "symbol": "TCS",
      "sentiment_score": 0.7842,
      "sentiment_label": "BULLISH",
      "reason": "Strong Q2 earnings beat with revenue growth signals positive momentum."
    },
    {
      "symbol": "INFY",
      "sentiment_score": 0.6234,
      "sentiment_label": "BULLISH",
      "reason": "Major contract win indicates strong business pipeline."
    }
  ],
  "ts": 1696512000
}
```

### GET /health
Check service health and Redis connectivity.

**Response:**
```json
{
  "agent": "ok",
  "redis": "connected"
}
```

## Quick Test

```bash
curl -X POST http://localhost:8000/picks \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["TCS","INFY"],
    "news": {
      "TCS":[{"title":"TCS Q2 beats estimates","summary":"Revenue up"}],
      "INFY":[{"title":"INFY new deal","summary":"Large outsourcing deal"}]
    }
  }'
```

## Docker Deployment

### Build Image
```bash
docker build -t trendystocks-agent .
```

### Run Container
```bash
docker run -p 8000:8000 --env-file .env trendystocks-agent
```

## Integration with Backend

The Node.js backend calls this service via the `agnoClient.js` module:
- Timeout protection (15s default)
- Automatic fallback to vader-sentiment on failure
- Feature flag `AGNO_ENABLED=true/false` to toggle usage

## Cost Control

- Uses `gemini-1.5-flash` by default (configurable via `GEMINI_MODEL`)
- Gemini offers generous free tier: 15 requests/minute, 1M tokens/day
- Limits to first 8 articles per symbol
- Truncates long summaries to control token usage
- Batches symbols in single request to minimize API calls

## Gemini API Key

Get your free API key at: https://aistudio.google.com/app/apikey
- Free tier: 15 RPM, 1 million tokens per day, 1500 RPD
- No credit card required for free tier

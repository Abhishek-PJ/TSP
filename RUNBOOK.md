# Agno Integration Runbook

## Overview
This document provides setup and testing instructions for the Agno AI sentiment service integration.

## Architecture
```
Frontend (React) → Backend (Node.js) → Agent (Python + Agno) → Google Gemini 1.5 Flash
                                    ↓
                                  Redis
```

## Local Development Setup

### 1. Start Redis (Optional)
```powershell
# If you have Redis installed locally
redis-server

# Or use Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### 2. Start Agent Service
```powershell
cd agent

# Install dependencies (first time only)
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your-gemini-key
# Get free key at: https://aistudio.google.com/app/apikey

# Start agent
uvicorn server:app --reload --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

### 3. Start Backend
```powershell
cd backend

# Create .env file if it doesn't exist
# backend/.env should contain:
# AGNO_ENABLED=true
# AGNO_URL=http://localhost:8000
# AGNO_TIMEOUT_MS=15000

npm run dev
```

Expected output:
```
API listening on http://localhost:4000
Redis cache connected
```

### 4. Start Frontend
```powershell
cd frontend
npm run dev
```

## Testing

### Quick Test - PowerShell
```powershell
.\test-agno-integration.ps1
```

### Quick Test - Bash
```bash
chmod +x test-agno-integration.sh
./test-agno-integration.sh
```

### Manual Testing

#### 1. Test Agent Health
```powershell
curl http://localhost:8000/health
```
Expected: `{"agent":"ok","redis":"connected"}`

#### 2. Test Agent Picks Endpoint
```powershell
$body = @{
    symbols = @("TCS", "INFY")
    news = @{
        TCS = @(
            @{ title = "TCS Q2 earnings beat estimates"; summary = "Strong growth" }
        )
        INFY = @(
            @{ title = "INFY announces layoffs"; summary = "Cost cutting" }
        )
    }
} | ConvertTo-Json -Depth 10

curl -Method Post -Uri http://localhost:8000/picks -Body $body -ContentType "application/json"
```

Expected response:
```json
{
  "data": [
    {
      "symbol": "TCS",
      "sentiment_score": 0.7234,
      "sentiment_label": "BULLISH",
      "reason": "Strong Q2 earnings indicate positive momentum..."
    },
    {
      "symbol": "INFY",
      "sentiment_score": -0.4521,
      "sentiment_label": "SKIP",
      "reason": "Layoff announcements suggest cost pressures..."
    }
  ],
  "ts": 1696512000
}
```

#### 3. Test Backend Integration
```powershell
curl http://localhost:4000/api/picks/today
```

Check that results include:
- `sentiment_score`: Float value (-1.0 to +1.0)
- `sentiment_label`: "BULLISH", "WATCH", or "SKIP"
- `reason`: AI-generated explanation
- `sentiment.source`: "agno" or "vader" (fallback)

#### 4. Test Fallback Behavior
Stop the agent service and test that backend still works:
```powershell
# Stop agent (Ctrl+C in agent terminal)

# Test backend - should fallback to VADER
curl http://localhost:4000/api/picks/today
# Check that sentiment.source = "vader"
```

## Docker Deployment

### Start All Services
```powershell
docker-compose up --build
```

Services will be available at:
- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Agent: http://localhost:8000
- Redis: localhost:6379

### Stop All Services
```powershell
docker-compose down
```

## Monitoring

### Check Backend Health
```powershell
curl http://localhost:4000/health
```

Response includes:
```json
{
  "status": "ok",
  "redis": true,
  "agno": {
    "status": "ok",
    "agent": "ok",
    "redis": "connected"
  },
  "agnoMetrics": {
    "totalCalls": 15,
    "totalFailures": 0,
    "totalDuration": 23450,
    "avgLatencyMs": 1563
  }
}
```

## Troubleshooting

### Agent service fails to start
**Error**: `ModuleNotFoundError: No module named 'agno'`
**Solution**: `pip install -r requirements.txt`

**Error**: `Invalid API key` or `Authentication failed`
**Solution**: Set `GEMINI_API_KEY` in `agent/.env`
Get free key at: https://aistudio.google.com/app/apikey

### Backend cannot connect to Agent
**Error**: `[agno] Error: connect ECONNREFUSED`
**Solution**: 
1. Check agent is running on port 8000
2. Verify `AGNO_URL=http://localhost:8000` in backend `.env`
3. Check firewall settings

### All picks show sentiment.source = "vader"
**Cause**: Agno service not responding or disabled
**Check**:
1. `AGNO_ENABLED=true` in backend `.env`
2. Agent service is running
3. Check `curl http://localhost:8000/health`

### High latency (>10s per request)
**Causes**:
- Too many symbols (batching needed)
- Long article summaries (token limit)
- Gemini API rate limits or throttling

**Solutions**:
1. Reduce `AGNO_TIMEOUT_MS`
2. Limit article count per symbol (already limited to 8)
3. Use faster Gemini model (gemini-1.5-flash is already the fastest)

## Cost Control

### Token Usage Estimation
- ~150 tokens per symbol (prompt + response)
- ~50 symbols/request during market hours
- ~7,500 tokens per picks call
- With 10min caching: ~6 calls/hour = 45K tokens/hour
- **Daily cost: FREE** (well within Gemini's 1M tokens/day free tier)

### Gemini Free Tier Limits
- **15 requests per minute** (RPM)
- **1 million tokens per day** (TPD)
- **1500 requests per day** (RPD)
- No credit card required
- More than sufficient for typical usage (~45K tokens/day)

### Optimization Tips
1. Enable Redis caching
2. Increase cache TTL for news
3. Use `AGNO_TIMEOUT_MS` to prevent long-running calls
4. Set `AGNO_ENABLED=false` during development
5. Batch symbols efficiently (current: all at once)

## Feature Flags

### Disable Agno Completely
```env
# backend/.env
AGNO_ENABLED=false
```
System falls back to VADER sentiment for all picks.

### Adjust Timeout
```env
# backend/.env
AGNO_TIMEOUT_MS=10000  # 10 seconds (default 15000)
```

### Change AI Model
```env
# agent/.env
GEMINI_MODEL=gemini-1.5-flash     # Default: Fast, free tier
# or
GEMINI_MODEL=gemini-1.5-pro       # Higher quality, same free tier
# or
GEMINI_MODEL=gemini-1.0-pro       # Older model, also free
```

## Deployment Checklist

- [ ] Redis is running and accessible
- [ ] Agent service has valid `GEMINI_API_KEY` (get free at https://aistudio.google.com/app/apikey)
- [ ] Backend `.env` has `AGNO_ENABLED=true` and correct `AGNO_URL`
- [ ] Agent health endpoint returns OK
- [ ] Backend health shows Agno status
- [ ] Test picks endpoint returns sentiment data
- [ ] Frontend displays sentiment_label and reason
- [ ] Fallback to VADER works when agent unavailable
- [ ] Monitoring/metrics are logged

## Support

For issues or questions:
1. Check agent logs: Look for `[agno]` prefixed messages
2. Check backend logs: Look for Agno call duration and errors
3. Test agent independently: `curl http://localhost:8000/picks`
4. Verify environment variables are set correctly

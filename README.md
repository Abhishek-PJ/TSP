# Trendy Stocks Predictor

A full-stack app that surfaces intraday stock candidates using numeric filters and AI-powered news sentiment analysis.

## Stack
- **Frontend**: React (Vite) + Tailwind CSS
- **Backend**: Node.js + Express
- **Agent**: Python (Agno) + Google Gemini 1.5 Flash
- **Cache**: Redis (with in-memory fallback)
- **Data**: NSE feed + multi-source news (Google News RSS, Bing RSS, NewsAPI)

## Prerequisites
- Node.js 20.19+
- Python 3.11+ (for AI agent)
- Redis (optional, recommended)
- Google Gemini API key (free tier available - no credit card required)

## Quick Start

### Option 1: With AI Sentiment (Recommended)

**Terminal 1 - Agent Service**
```bash
cd agent
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your-key-here
# Get free key at: https://aistudio.google.com/app/apikey
uvicorn server:app --reload --port 8000
```

**Terminal 2 - Backend**
```bash
cd backend
npm install
npm run dev
# API on http://localhost:4000
```

**Terminal 3 - Frontend**
```bash
cd frontend
npm install
npm run dev
# App on http://localhost:5173
```

### Option 2: Without AI (VADER Fallback Only)

**Terminal 1 - Backend**
```bash
cd backend
npm install
# Set AGNO_ENABLED=false in .env or:
$env:AGNO_ENABLED="false"
npm run dev
```

**Terminal 2 - Frontend**
```bash
cd frontend
npm install
npm run dev
```

## Configuration

### Agent Service (`agent/.env`)
```env
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-1.5-flash
REDIS_URL=redis://localhost:6379/0
```

**Get your free Gemini API key**: https://aistudio.google.com/app/apikey  
✅ No credit card required for free tier (15 RPM, 1M tokens/day)

### Backend (`backend/.env`)
```env
PORT=4000
NEWSAPI_KEY=your_newsapi_key_here

# Redis (optional)
REDIS_URL=redis://localhost:6379

# Agno Agent
AGNO_ENABLED=true
AGNO_URL=http://localhost:8000
AGNO_TIMEOUT_MS=15000
```

### Frontend (`frontend/.env`)
```env
VITE_API_BASE=http://localhost:4000

## Features

### Core Functionality
- **Numeric Filters**: Price gain +1% to +3%, Open ≥ ₹50, Volume ≥ 100K
- **AI Sentiment Analysis**:
  - Agno + Google Gemini 1.5 Flash: Context-aware scoring with detailed reasoning
  - Automatic VADER fallback if AI unavailable
  - 48h news window per symbol
  - Labels: BULLISH, WATCH, SKIP
  - **Free tier**: 15 RPM, 1M tokens/day - no credit card needed
- **Resilient Architecture**:
  - Feature flag toggle (`AGNO_ENABLED`)
  - 15s timeout protection
  - Graceful fallbacks
  - Performance metrics tracking
{{ ... }}
### UI/UX
- Sticky sidebar with mini chart and news
- Click symbol to view details
- Category-colored interactions (Bullish=emerald, Watch=amber, Skip=rose)
- Full candlestick chart modal
- Summary cards and health badges
- Market open/closed banner
- Cached picks during off-hours

## API Endpoints

### Backend (Port 4000)
- `GET /health` - Health check with Agno metrics
- `GET /api/snapshot` - Market snapshot (cached 30s)
- `GET /api/candidates` - Filtered candidates
- `GET /api/news/:symbol` - Recent news (cached 10m)
- `GET /api/picks/today` - **AI-enhanced picks** with sentiment
- `GET /api/ohlc/:symbol` - OHLC candles for charts

### Agent Service (Port 8000)
- `POST /picks` - Analyze sentiment for symbols
- `GET /health` - Agent health check

## Testing

### Automated Test
```powershell
# PowerShell
.\test-agno-integration.ps1

# Bash
chmod +x test-agno-integration.sh
./test-agno-integration.sh
```

### Manual Test
```powershell
# Test agent
curl http://localhost:8000/health

# Test backend with AI sentiment
curl http://localhost:4000/api/picks/today

# Check that results include sentiment_score, sentiment_label, reason
```

## Docker Deployment

```bash
# Start all services
docker-compose up --build

# Services available at:
# Frontend: http://localhost:5173
# Backend: http://localhost:4000
# Agent: http://localhost:8000

# Stop services
docker-compose down
```

## Project Structure
```
TSP/
  agent/                        # NEW: Python Agno service
    server.py                   # FastAPI + Agno agent
    requirements.txt
    .env.example
    Dockerfile
    README.md
  backend/
    src/
      index.js                  # Main server (updated)
      modules/
        agnoClient.js           # NEW: Agent HTTP client
        recommendationEngine.js # NEW: AI integration
        sentimentService.js     # VADER fallback
        newsFetcher.js
        filters.js
        marketFeed.js
        cache.js
    package.json
    .env.example                # NEW: With Agno config
    Dockerfile                  # NEW
  frontend/
    src/
      App.jsx
      components/
      pages/
    package.json
  docker-compose.yml            # NEW: Full stack
  test-agno-integration.ps1     # NEW: Test script
  RUNBOOK.md                    # NEW: Detailed operations guide
```

## Libraries

### Agent (Python)
- agno - AI agent framework
- fastapi - Web framework
- uvicorn - ASGI server
- redis - Caching
- google-generativeai - Gemini API integration

### Backend (Node.js)
- express ^4.19.2
- node-fetch ^3.3.2 - HTTP client for agent
- ioredis ^5.7.0 - Redis client
- vader-sentiment ^1.1.3 - Fallback
- node-cron ^4.2.1

### Frontend (React)
- react ^19.1.1
- react-router-dom ^7.8.2
- lightweight-charts ^4.2.3
- tailwindcss ^4.1.13

## Cost Estimation
- **Tokens per request**: ~7,500 (50 symbols × 150 tokens)
- **With 10m caching**: ~6 requests/hour during market
- **Daily cost**: **FREE** with Gemini 1.5 Flash (within 1M tokens/day limit)
- **Free tier limits**: 15 requests/min, 1M tokens/day, 1500 requests/day

## Troubleshooting

### Agent won't start
```bash
pip install -r requirements.txt
# Verify GEMINI_API_KEY is set in agent/.env
# Get free key at: https://aistudio.google.com/app/apikey
```

### Backend can't reach agent
```bash
# Check agent is running: curl http://localhost:8000/health
# Verify backend .env: AGNO_ENABLED=true, AGNO_URL=http://localhost:8000
```

### All picks use VADER (not AI)
```bash
# Check sentiment.source field in API response
# If "vader": agent is disabled or unavailable
# Verify AGNO_ENABLED=true in backend/.env
```

## Documentation
- **README.md** (this file) - Quick start and overview
- **RUNBOOK.md** - Detailed operations, testing, monitoring
- **agent/README.md** - Agent service specifics

## License
Private project for demonstration purposes.

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


### Using Pre-built Images from Docker Hub

You can run the project using pre-built images from Docker Hub instead of building locally. This is faster and doesn't require the source code.

1. **Pull the images**:
   ```bash
   docker pull abhishekpj/tsp-agent:1.0.0
   docker pull abhishekpj/tsp-backend:1.0.0
   docker pull abhishekpj/tsp-frontend:1.0.0
   ```

2. **Start the services**:
   ```bash
   docker-compose up
   ```

   Services will be available at:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:4000
   - Agent: http://localhost:8000

3. **Stop the services**:
   ```bash
   docker-compose down
   ```

   **Note**: Ensure you have a `.env` file in each service directory (`agent/.env`, `backend/.env`, `frontend/.env`) with the required environment variables (e.g., `GEMINI_API_KEY` for the agent). Copy from the `.env.example` files if needed.

   **Docker Hub Repository**: [https://hub.docker.com/repositories/abhishekpj](https://hub.docker.com/repositories/abhishekpj)

### Building Locally (Alternative)

If you prefer to build the images yourself:

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

## Project Structure
```
TSP/
  agent/                        # Python Agno service
    server.py                   # FastAPI app with Agno agent
    requirements.txt            # Python dependencies
    .env.example                # Environment template
    Dockerfile                  # Container definition
    README.md                   # Agent-specific docs
  backend/
    src/
      index.js                  # Main server 
      modules/
        marketFeed.js           # NSE data feed
        filters.js              # Numeric filters
        newsFetcher.js          # Multi-source news
        sentimentService.js     # VADER fallback
        recommendationEngine.js # Agno integration
        agnoClient.js           # Agno HTTP client
        cache.js                # Redis cache
    package.json
    .env.example               
    Dockerfile                  # Container definition
  frontend/
    src/
      App.jsx
      main.jsx
      components/
        Modal.jsx
        CandlestickChart.jsx
      pages/
        SymbolDetails.jsx
      index.css
    vite.config.js
    Dockerfile                  # Container definition
    package.json
  docker-compose.yml            # Full stack orchestration
  test-agno-integration.ps1     # PowerShell test script
  test-agno-integration.sh      # Bash test script
```


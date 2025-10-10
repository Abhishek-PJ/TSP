#!/bin/bash
# Bash test script for Agno integration (Linux/Mac/WSL)

set -e

echo "=== Testing TrendyStocks Agno Integration ==="
echo ""

# Test 1: Backend health check
echo "[1/4] Testing backend health endpoint..."
HEALTH=$(curl -s http://localhost:4000/health)
echo "✓ Backend health: $(echo $HEALTH | jq -r '.status')"
echo "  Redis: $(echo $HEALTH | jq -r '.redis')"
echo "  Agno: $(echo $HEALTH | jq -r '.agno.status')"
echo "  Agno metrics: $(echo $HEALTH | jq -r '.agnoMetrics')"
echo ""

# Test 2: Agent health check
echo "[2/4] Testing agent health endpoint..."
AGENT_HEALTH=$(curl -s http://localhost:8000/health || echo '{"error":"not_running"}')
if echo "$AGENT_HEALTH" | jq -e '.agent' > /dev/null 2>&1; then
    echo "✓ Agent health: $(echo $AGENT_HEALTH | jq -r '.agent')"
    echo "  Redis: $(echo $AGENT_HEALTH | jq -r '.redis')"
else
    echo "✗ Agent not responding (make sure it's running on port 8000)"
fi
echo ""

# Test 3: Direct agent test
echo "[3/4] Testing agent /picks endpoint directly..."
curl -s -X POST http://localhost:8000/picks \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["TCS", "INFY"],
    "news": {
      "TCS": [
        {"title": "TCS reports strong Q2 earnings", "summary": "Revenue beats estimates with 12% growth"},
        {"title": "TCS wins major banking contract", "summary": "5-year deal worth $500M"}
      ],
      "INFY": [
        {"title": "Infosys announces strategic restructuring", "summary": "Focus on high-margin digital services"}
      ]
    }
  }' | jq '.'
echo ""

# Test 4: Backend picks endpoint
echo "[4/4] Testing backend /api/picks/today endpoint..."
PICKS=$(curl -s http://localhost:4000/api/picks/today)
echo "✓ Backend returned $(echo $PICKS | jq -r '.count') picks"
echo "  Market open: $(echo $PICKS | jq -r '.marketOpen')"
echo "  As of: $(echo $PICKS | jq -r '.asOf')"
echo ""
echo "Sample results:"
echo $PICKS | jq -r '.results[:3][] | "  \(.symbol): \(.recommendation) [\(.sentiment.source)] - \(.reason // "N/A")"'
echo ""

echo "=== Test Complete ==="
echo ""
echo "Next steps:"
echo "  1. Open frontend at http://localhost:5173"
echo "  2. Check that picks show sentiment_label and reason fields"
echo "  3. Verify Agno metrics increase at /health endpoint"

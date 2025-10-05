#!/bin/bash
# Quick test script for the agent service

echo "Testing agent health endpoint..."
curl -s http://localhost:8000/health | python -m json.tool

echo -e "\n\nTesting picks endpoint with sample data..."
curl -s -X POST http://localhost:8000/picks \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["TCS", "INFY", "WIPRO"],
    "news": {
      "TCS": [
        {"title": "TCS reports strong Q2 earnings", "summary": "Revenue beats estimates with 12% growth"},
        {"title": "TCS wins major banking contract", "summary": "5-year deal worth $500M"}
      ],
      "INFY": [
        {"title": "Infosys announces layoffs", "summary": "Cost cutting measures amid slow demand"},
        {"title": "INFY misses revenue targets", "summary": "Q2 results disappoint investors"}
      ],
      "WIPRO": [
        {"title": "Wipro maintains guidance", "summary": "Steady outlook for next quarter"}
      ]
    }
  }' | python -m json.tool

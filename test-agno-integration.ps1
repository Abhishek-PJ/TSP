# PowerShell test script for Agno integration
# Run this after starting the backend and agent services

Write-Host "=== Testing TrendyStocks Agno Integration ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Backend health check
Write-Host "[1/4] Testing backend health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:4000/health" -Method Get
    Write-Host "[PASS] Backend health: $($health.status)" -ForegroundColor Green
    Write-Host "  Redis: $($health.redis)" -ForegroundColor Gray
    if ($health.agno -and $health.agno.status) {
        Write-Host "  Agno: $($health.agno.status)" -ForegroundColor Gray
    } else {
        Write-Host "  Agno: disabled" -ForegroundColor Gray
    }
    if ($health.agnoMetrics) {
        Write-Host "  Agno calls: $($health.agnoMetrics.totalCalls), failures: $($health.agnoMetrics.totalFailures)" -ForegroundColor Gray
    }
} catch {
    Write-Host "[FAIL] Backend health check failed: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 2: Agent health check
Write-Host "[2/4] Testing agent health endpoint..." -ForegroundColor Yellow
try {
    $agentHealth = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method Get
    Write-Host "[PASS] Agent health: $($agentHealth.agent)" -ForegroundColor Green
    Write-Host "  Redis: $($agentHealth.redis)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Agent health check failed: $_" -ForegroundColor Red
    Write-Host "  Note: Make sure agent service is running on port 8000" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Direct agent test with sample data
Write-Host "[3/4] Testing agent /picks endpoint directly..." -ForegroundColor Yellow
$agentPayload = @{
    symbols = @("TCS", "INFY")
    news = @{
        TCS = @(
            @{
                title = "TCS reports strong Q2 earnings"
                summary = "Revenue beats estimates with 12% growth"
            },
            @{
                title = "TCS wins major banking contract"
                summary = "5-year deal worth `$500M"
            }
        )
        INFY = @(
            @{
                title = "Infosys announces strategic restructuring"
                summary = "Focus on high-margin digital services"
            }
        )
    }
} | ConvertTo-Json -Depth 10

try {
    $agentResult = Invoke-RestMethod -Uri "http://localhost:8000/picks" -Method Post -Body $agentPayload -ContentType "application/json"
    Write-Host "[PASS] Agent returned $($agentResult.data.Count) results" -ForegroundColor Green
    foreach ($result in $agentResult.data) {
        Write-Host "  $($result.symbol): $($result.sentiment_label) (score: $($result.sentiment_score))" -ForegroundColor Gray
        Write-Host "    Reason: $($result.reason)" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "[FAIL] Agent test failed: $_" -ForegroundColor Red
}
Write-Host ""

# Test 4: Backend picks endpoint (integration test)
Write-Host "[4/4] Testing backend /api/picks/today endpoint..." -ForegroundColor Yellow
try {
    $picks = Invoke-RestMethod -Uri "http://localhost:4000/api/picks/today" -Method Get
    Write-Host "[PASS] Backend returned $($picks.count) picks" -ForegroundColor Green
    Write-Host "  Market open: $($picks.marketOpen)" -ForegroundColor Gray
    Write-Host "  As of: $($picks.asOf)" -ForegroundColor Gray
    
    if ($picks.results.Count -gt 0) {
        Write-Host "`n  Sample results:" -ForegroundColor Gray
        $picks.results | Select-Object -First 3 | ForEach-Object {
            $source = if ($_.sentiment -and $_.sentiment.source) { "[$($_.sentiment.source)]" } else { "[vader]" }
            Write-Host "    $($_.symbol): $($_.recommendation) $source" -ForegroundColor DarkGray
            if ($_.reason) {
                Write-Host "      Reason: $($_.reason)" -ForegroundColor DarkGray
            }
        }
    }
} catch {
    Write-Host "[FAIL] Backend picks test failed: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Test Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open frontend at http://localhost:5173" -ForegroundColor Gray
Write-Host "  2. Check that picks show sentiment_label and reason fields" -ForegroundColor Gray
Write-Host "  3. Verify Agno metrics increase at /health endpoint" -ForegroundColor Gray

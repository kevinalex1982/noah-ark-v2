# MQTT Test Client Startup Script
# Simulate IAMS credential delivery

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MQTT Test Client (Simulate IAMS)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Broker: mqtt://localhost:1883" -ForegroundColor Yellow
Write-Host "Device: iris-device-001" -ForegroundColor Yellow
Write-Host ""
Write-Host "Functions:" -ForegroundColor White
Write-Host "  1. Iris Add" -ForegroundColor Gray
Write-Host "  2. Iris Update" -ForegroundColor Gray
Write-Host "  3. Iris Delete" -ForegroundColor Gray
Write-Host "  4. Palm Add" -ForegroundColor Gray
Write-Host "  5. Palm Update" -ForegroundColor Gray
Write-Host "  6. Palm Delete" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to exit" -ForegroundColor Gray
Write-Host ""

# Change to script directory
Set-Location $PSScriptRoot

# Start MQTT Test Client
npx ts-node scripts\mqtt-test-client.ts
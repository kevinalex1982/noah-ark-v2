# Noah Ark - Electron Startup Script
# Make sure Next.js backend is running on localhost:3001

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  Noah Ark - Electron Client" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Change to script directory
Set-Location $PSScriptRoot

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check if dist directory exists
if (-not (Test-Path "dist")) {
    Write-Host "Compiling TypeScript..." -ForegroundColor Yellow
    npm run build
    Write-Host ""
}

Write-Host "Starting Electron..." -ForegroundColor Green
Write-Host "Backend URL: http://localhost:3001" -ForegroundColor Gray
Write-Host ""

# Start Electron
npm start
# 诺亚方舟 - 生产环境启动脚本
# 使用方法：在 PowerShell 中运行 .\start-production.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  诺亚方舟 - 生产服务" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 切换到脚本所在目录
Set-Location $PSScriptRoot

Write-Host "项目目录：$PSScriptRoot" -ForegroundColor Gray
Write-Host ""

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "错误：未安装 Node.js" -ForegroundColor Red
    Write-Host "请从 https://nodejs.org 下载安装" -ForegroundColor Yellow
    exit 1
}

Write-Host "Node.js 版本：$(node --version)" -ForegroundColor Gray
Write-Host ""

# 检查 .next 目录
if (-not (Test-Path ".next")) {
    Write-Host "错误：未找到 .next 目录" -ForegroundColor Red
    Write-Host "请先运行: npm run build" -ForegroundColor Yellow
    exit 1
}

Write-Host "正在启动 Next.js 生产服务器..." -ForegroundColor Yellow
Write-Host "端口：3001" -ForegroundColor Yellow
Write-Host ""
Write-Host "访问地址：" -ForegroundColor Green
Write-Host "  - Kiosk:     http://localhost:3001/kiosk" -ForegroundColor White
Write-Host "  - Dashboard: http://localhost:3001/dashboard" -ForegroundColor White
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Gray
Write-Host ""

# 启动 Next.js 生产服务器
.\node_modules\.bin\next start -p 3001
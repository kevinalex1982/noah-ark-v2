# 诺亚方舟项目 - 开发服务器启动脚本
# 使用方法：在 PowerShell 中运行 .\start-dev.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  诺亚方舟 - 开发服务器" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 切换到脚本所在目录
Set-Location $PSScriptRoot

Write-Host "项目目录：$PSScriptRoot" -ForegroundColor Gray
Write-Host ""
Write-Host "正在启动 Next.js 开发服务器..." -ForegroundColor Yellow
Write-Host "端口：3001" -ForegroundColor Yellow
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Gray
Write-Host ""

# 启动 Next.js 开发服务器
.\node_modules\.bin\next dev -p 3001

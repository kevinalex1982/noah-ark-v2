# 诺亚方舟 - 一键启动所有服务
# 使用方法：在 PowerShell 中运行 .\start-all.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  诺亚方舟 - 启动所有服务" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 切换到脚本所在目录
Set-Location $PSScriptRoot

Write-Host "项目目录：$PSScriptRoot" -ForegroundColor Gray
Write-Host ""

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "错误：未安装 Node.js" -ForegroundColor Red
    exit 1
}

Write-Host "Node.js 版本：$(node --version)" -ForegroundColor Gray
Write-Host ""

# 启动 Next.js 服务（新窗口）
Write-Host "[1/3] 启动 Next.js 服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @{
    ArgumentList = @(
        "-NoExit",
        "-Command",
        "Set-Location '$PSScriptRoot'; Write-Host 'Next.js 服务 - 端口 3001' -ForegroundColor Cyan; .\node_modules\.bin\next start -p 3001"
    )
}
Start-Sleep -Seconds 3

# 启动 MQTT Broker（新窗口）
Write-Host "[2/3] 启动 MQTT Broker..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @{
    ArgumentList = @(
        "-NoExit",
        "-Command",
        "Set-Location '$PSScriptRoot'; Write-Host 'MQTT Broker - 端口 1883' -ForegroundColor Cyan; node scripts/mqtt-broker.js"
    )
}
Start-Sleep -Seconds 2

# 启动 Electron 客户端
Write-Host "[3/3] 启动 Electron 客户端..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @{
    ArgumentList = @(
        "-Command",
        "Set-Location '$PSScriptRoot\electron'; npm run start"
    )
}

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  所有服务已启动" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "服务列表：" -ForegroundColor White
Write-Host "  - Next.js:  http://localhost:3001" -ForegroundColor Gray
Write-Host "  - MQTT:     localhost:1883" -ForegroundColor Gray
Write-Host ""
Write-Host "关闭此窗口不会停止服务" -ForegroundColor Gray
Write-Host "要停止服务，请关闭对应的 PowerShell 窗口" -ForegroundColor Gray
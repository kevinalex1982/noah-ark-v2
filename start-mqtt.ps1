# MQTT Broker 启动脚本
# 前台运行，显示日志，按 Ctrl+C 停止

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MQTT Broker (模拟 IAMS)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "端口：1883" -ForegroundColor Yellow
Write-Host "协议：TCP/MQTT" -ForegroundColor Yellow
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Gray
Write-Host ""

# 切换到脚本所在目录
Set-Location $PSScriptRoot

# 启动 MQTT Broker（前台运行）
node scripts\mqtt-broker.js

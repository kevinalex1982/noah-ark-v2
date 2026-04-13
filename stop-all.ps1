# 诺亚方舟 - 停止所有服务

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  诺亚方舟 - 停止所有服务" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 停止 Node.js 进程（Next.js 和 MQTT Broker）
Write-Host "正在停止 Next.js 服务..." -ForegroundColor Yellow
$nextProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.MainWindowTitle -like "*next*" -or $_.CommandLine -like "*next*"
}
if ($nextProcesses) {
    $nextProcesses | Stop-Process -Force
    Write-Host "Next.js 服务已停止" -ForegroundColor Green
} else {
    # 尝试通过端口查找
    $port3001 = netstat -ano | findstr ":3001" | findstr "LISTENING"
    if ($port3001) {
        $pid = ($port3001 -split '\s+')[-1]
        if ($pid -match '^\d+$') {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Write-Host "Next.js 服务已停止 (PID: $pid)" -ForegroundColor Green
        }
    } else {
        Write-Host "未找到 Next.js 服务" -ForegroundColor Gray
    }
}

Write-Host "正在停止 MQTT Broker..." -ForegroundColor Yellow
$mqttPort = netstat -ano | findstr ":1883" | findstr "LISTENING"
if ($mqttPort) {
    $pid = ($mqttPort -split '\s+')[-1]
    if ($pid -match '^\d+$') {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Write-Host "MQTT Broker 已停止 (PID: $pid)" -ForegroundColor Green
    }
} else {
    Write-Host "未找到 MQTT Broker" -ForegroundColor Gray
}

Write-Host "正在停止 Electron..." -ForegroundColor Yellow
$electronProcesses = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($electronProcesses) {
    $electronProcesses | Stop-Process -Force
    Write-Host "Electron 已停止" -ForegroundColor Green
} else {
    Write-Host "未找到 Electron 进程" -ForegroundColor Gray
}

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  所有服务已停止" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
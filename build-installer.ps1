# 诺亚方舟 - 打包脚本
# 生成 Windows 安装程序

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  诺亚方舟 - 打包安装程序" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 切换到项目根目录
Set-Location $PSScriptRoot

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "错误：未安装 Node.js" -ForegroundColor Red
    exit 1
}

Write-Host "步骤 1/4: 安装依赖..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误：npm install 失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "步骤 2/4: 编译 Next.js..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误：Next.js 编译失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "步骤 3/5: 安装 Electron 依赖..." -ForegroundColor Yellow
Set-Location electron
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误：Electron 依赖安装失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "步骤 4/5: 编译 Electron TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误：Electron TypeScript 编译失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "步骤 5/5: 打包 Electron..." -ForegroundColor Yellow
npx electron-builder --win
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误：Electron 打包失败" -ForegroundColor Red
    exit 1
}

Set-Location ..

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  打包完成！" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "安装程序位置：" -ForegroundColor White
Write-Host "  electron\release\noah-ark-electron Setup 1.0.0.exe" -ForegroundColor Gray
Write-Host ""
Write-Host "安装后首次运行：" -ForegroundColor White
Write-Host "  1. 运行安装程序" -ForegroundColor Gray
Write-Host "  2. 安装完成后启动应用" -ForegroundColor Gray
Write-Host "  3. 应用会自动启动后端服务" -ForegroundColor Gray
Write-Host "  4. 通过系统托盘管理应用" -ForegroundColor Gray
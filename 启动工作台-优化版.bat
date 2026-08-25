@echo off
setlocal
cd /d "%~dp0"

where.exe node >nul 2>&1
if errorlevel 1 (
    echo 错误：未找到 Node.js，请先安装 Node.js 并确保 node 已加入 PATH。
    pause
    exit /b 1
)

where.exe npm >nul 2>&1
if errorlevel 1 (
    echo 错误：未找到 npm，请先安装 Node.js 并确保 npm 已加入 PATH。
    pause
    exit /b 1
)

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
    echo 首次运行正在安装依赖，请稍候...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo 错误：依赖安装失败。
        pause
        exit /b 1
    )
)

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
    echo 错误：安装完成后未找到 "%~dp0node_modules\electron\dist\electron.exe"。
    pause
    exit /b 1
)

call npm start
if errorlevel 1 (
    echo 错误：工作台启动失败。
    pause
    exit /b 1
)

exit /b 0

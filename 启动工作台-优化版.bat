@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if errorlevel 1 (
    echo 错误：无法切换到工作台目录 "%~dp0"。
    pause
    exit /b 1
)

set "ELECTRON_TEMP_DIR=%LOCALAPPDATA%\personal-workbench-v2-temp"
if not defined LOCALAPPDATA set "ELECTRON_TEMP_DIR=%~dp0.tmp"

if not exist "%ELECTRON_TEMP_DIR%\" (
    mkdir "%ELECTRON_TEMP_DIR%" >nul 2>&1
    if errorlevel 1 (
        echo 错误：无法创建 Electron 临时目录 "%ELECTRON_TEMP_DIR%"。
        pause
        exit /b 1
    )
)

if not exist "%ELECTRON_TEMP_DIR%\" (
    echo 错误：无法确认 Electron 临时目录 "%ELECTRON_TEMP_DIR%" 已创建。
    pause
    exit /b 1
)

set "TEMP=%ELECTRON_TEMP_DIR%"
set "TMP=%ELECTRON_TEMP_DIR%"

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
    if not exist "%~dp0node_modules\electron\install.js" (
        echo 未找到 Electron 安装脚本，正在安装依赖，请稍候...
        call npm install --no-audit --no-fund
        if errorlevel 1 (
            echo 错误：依赖安装失败。
            pause
            exit /b 1
        )
    )

    echo 正在执行 Electron 安装脚本，强制补下载 Electron 二进制，请稍候...
    node "%~dp0node_modules\electron\install.js"
    if errorlevel 1 (
        echo 错误：Electron 二进制补下载失败。
        pause
        exit /b 1
    )
)

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
    echo 错误：Electron 二进制安装后仍未找到 "%~dp0node_modules\electron\dist\electron.exe"。
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

@echo off
cd /d %~dp0
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=
set NODE_OPTIONS=
start "" "..\personal-workbench\node_modules\electron\dist\electron.exe" .

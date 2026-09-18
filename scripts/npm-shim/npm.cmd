@echo off
if /I "%~1"=="prefix" if /I "%~2"=="-w" (
  echo %CD%
  exit /b 0
)
if not defined PERSONAL_WORKBENCH_REAL_NPM (
  echo PERSONAL_WORKBENCH_REAL_NPM is not set 1>&2
  exit /b 127
)
call "%PERSONAL_WORKBENCH_REAL_NPM%" %*
exit /b %ERRORLEVEL%

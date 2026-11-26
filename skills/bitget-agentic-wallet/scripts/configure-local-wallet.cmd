@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%SCRIPT_DIR%configure-local-wallet.ps1" %*
if errorlevel 1 (
  echo.
  echo Bitget Wallet local wallet setup did not complete.
  pause
)
endlocal

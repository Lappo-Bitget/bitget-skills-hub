@echo off
setlocal
title Bitget Wallet - Local Signer Setup
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-local-signer.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Configuration did not complete. Review the message above.
) else (
  echo Configuration flow finished.
)
echo.
pause
exit /b %EXIT_CODE%

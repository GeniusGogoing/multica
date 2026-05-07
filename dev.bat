@echo off
REM Multica Dev - Windows one-click startup
REM Double-click this file or run from CMD to start everything.
REM
REM Usage:
REM   dev.bat              Start all services (backend + frontend + daemon)
REM   dev.bat --no-daemon  Start without daemon
REM   dev.bat --stop       Stop all services

pushd "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
popd

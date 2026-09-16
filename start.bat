@echo off
title Slice Player
echo ===================================================
echo       SLICE PLAYER - KHOI CHAY UNG DUNG
echo ===================================================

cd /d "%~dp0"

echo [1/2] Dang build frontend...
call bun run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build frontend that bai voi ma loi %ERRORLEVEL%!
    pause
    exit /b %ERRORLEVEL%
)

netstat -ano | findstr :3000 | findstr LISTENING >nul
if %ERRORLEVEL% NEQ 0 (
    echo [2/2] Dang khoi dong server Bun...
    start "SlicePlayerServer" /min bun run src/server/index.ts
    timeout /t 2 /nobreak >nul
) else (
    echo [2/2] Server Bun dang hoat dong tren port 3000.
)

set "EDGE_PATH="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if defined EDGE_PATH (
    echo Dang mo giao dien MS Edge App Mode...
    start "" "%EDGE_PATH%" --app=http://127.0.0.1:3000 --user-data-dir="%~dp0data\edge_profile" --window-size=1280,850
) else (
    echo Dang mo trinh duyet mac dinh...
    start http://127.0.0.1:3000
)

echo ===================================================
echo Slice Player da san sang tren http://127.0.0.1:3000
echo ===================================================

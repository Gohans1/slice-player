@echo off
title Slice Player
echo ===================================================
echo       SLICE PLAYER - KHOI CHAY UNG DUNG
echo ===================================================

cd /d "%~dp0"

if not exist "dist\index.html" (
    echo [1/2] Dang build frontend...
    call bun run build
)

echo [2/2] Dang khoi dong server Bun...
start "SlicePlayerServer" /B bun run src/server/index.ts

timeout /t 2 /nobreak >nul

echo Dang mo giao dien MS Edge App Mode...
start msedge.exe --app=http://127.0.0.1:3000 --user-data-dir="%~dp0data\edge_profile" --window-size=1280,850

echo ===================================================
echo Slice Player da san sang tren http://127.0.0.1:3000
echo ===================================================

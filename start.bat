@echo off
@chcp 65001 >nul 2>&1
title Slice Player
echo ===================================================
echo       SLICE PLAYER - KHOI CHAY UNG DUNG
echo ===================================================

cd /d "%~dp0"
set NODE_ENV=production

where bun >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Khong tim thay Bun trong PATH! Vui long cai dat Bun truoc khi chay.
    pause
    exit /b 1
)

where ffmpeg >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Khong tim thay ffmpeg trong PATH! Song am se dung peaks mac dinh.
)

where yt-dlp >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] Khong tim thay yt-dlp trong PATH! Chuc nang tai YouTube se khong hoat dong.
)

set PORT_NUM=3000
if defined PORT set "PORT_NUM=%PORT%"

curl -s -f -m 1 http://127.0.0.1:%PORT_NUM%/api/tracks >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [1/2] Server Slice Player dang hoat dong san tren port %PORT_NUM%.
    goto skip_build
)

if "%~1"=="--no-build" (
    echo [1/2] Bo qua build frontend theo yeu cau.
    goto skip_build
)

echo [1/2] Dang kiem tra va build frontend moi nhat...
call bun run build
if errorlevel 1 (
    echo [ERROR] Build frontend that bai voi ma loi %ERRORLEVEL%!
    pause
    exit /b %ERRORLEVEL%
)

if not "%~1"=="--bun" (
    echo [1/2] Dang kiem tra va build slice-server ^(Rust^)...
    cargo build --release -p slice-engine --bin slice-server
    if errorlevel 1 (
        echo [ERROR] Build slice-server that bai voi ma loi %ERRORLEVEL%!
        pause
        exit /b %ERRORLEVEL%
    )
)

:skip_build

if "%~1"=="--bun" (
    echo [2/2] Dang khoi dong server Bun ^(rollback^) va mo giao dien...
    start "SlicePlayerServer" /min bun run src/server/index.ts
    goto done
)

if not exist "target\release\slice-server.exe" (
    echo [2/2] Dang build slice-server ^(Rust^)...
    cargo build --release -p slice-engine --bin slice-server
    if errorlevel 1 (
        echo [ERROR] Build slice-server that bai voi ma loi %ERRORLEVEL%!
        pause
        exit /b %ERRORLEVEL%
    )
)

rem The server opens the app window itself; with one already running, it just opens another window and exits
echo [2/2] Dang khoi dong slice-server ^(Rust^) va mo giao dien...
start "SlicePlayerServer" /min target\release\slice-server.exe

:done
echo ===================================================
echo Slice Player da san sang tren http://127.0.0.1:%PORT_NUM%
echo ===================================================

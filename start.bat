@echo off
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
if defined PORT set PORT_NUM=%PORT%

curl -s -f -m 1 http://127.0.0.1:%PORT_NUM%/api/tracks >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [1/2] Server Slice Player dang hoat dong san tren port %PORT_NUM%.
    goto launch_client
)

if "%~1"=="--no-build" (
    echo [1/2] Bo qua build frontend theo yeu cau.
) else (
    echo [1/2] Dang kiem tra va build frontend moi nhat...
    call bun run build
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Build frontend that bai voi ma loi %ERRORLEVEL%!
        pause
        exit /b %ERRORLEVEL%
    )
)

echo [2/2] Dang khoi dong server Bun...
start "SlicePlayerServer" /min bun run src/server/index.ts
set /a ATTEMPTS=0

:wait_loop
ping -n 2 127.0.0.1 >nul
curl -s -f -m 1 http://127.0.0.1:%PORT_NUM%/api/tracks >nul 2>&1
if %ERRORLEVEL% EQU 0 goto launch_client
set /a ATTEMPTS+=1
if %ATTEMPTS% GEQ 15 (
    echo [WARNING] Server chua phan hoi sau 15 giay, tiep tuc mo trinh duyet...
    goto launch_client
)
goto wait_loop

:launch_client

set "EDGE_PATH="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_PATH=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_PATH=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" (
    set "EDGE_PATH=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
)

if defined EDGE_PATH (
    echo Dang mo giao dien MS Edge App Mode...
    start "" "%EDGE_PATH%" --app=http://127.0.0.1:%PORT_NUM% --user-data-dir="%~dp0data\edge_profile" --autoplay-policy=no-user-gesture-required --window-size=1280,850
) else (
    echo Dang mo trinh duyet mac dinh...
    start http://127.0.0.1:%PORT_NUM%
)

echo ===================================================
echo Slice Player da san sang tren http://127.0.0.1:%PORT_NUM%
echo ===================================================

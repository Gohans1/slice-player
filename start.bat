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

if "%1"=="--no-build" (
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

curl -s -f -m 1 http://127.0.0.1:3000/api/tracks >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [2/2] Dang khoi dong server Bun...
    start "SlicePlayerServer" /min bun run src/server/index.ts
    set /a ATTEMPTS=0
    :wait_loop
    timeout /t 1 /nobreak >nul
    curl -s -f -m 1 http://127.0.0.1:3000/api/tracks >nul 2>&1
    if %ERRORLEVEL% EQU 0 goto server_ready
    set /a ATTEMPTS+=1
    if %ATTEMPTS% GEQ 15 goto server_timeout
    goto wait_loop
    :server_timeout
    echo [WARNING] Server chua phan hoi sau 15 giay, tiep tuc mo trinh duyet...
    :server_ready
) else (
    echo [2/2] Server Slice Player dang hoat dong san tren port 3000.
)

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
    start "" "%EDGE_PATH%" --app=http://127.0.0.1:3000 --user-data-dir="%~dp0data\edge_profile" --window-size=1280,850
) else (
    echo Dang mo trinh duyet mac dinh...
    start http://127.0.0.1:3000
)

echo ===================================================
echo Slice Player da san sang tren http://127.0.0.1:3000
echo ===================================================

@echo off
cd /d "%~dp0"
echo ==========================================
echo   Fiber Customer Maps - Deploy ke Vercel
echo ==========================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo PC ini TIDAK punya Node.js - itu tidak masalah.
    echo.
    echo Cara deploy tanpa Node.js di PC:
    echo   1. Upload folder ini ke GitHub ^(GitHub Desktop atau upload di browser^)
    echo   2. Buka https://vercel.com - Import project dari GitHub
    echo   3. Set Environment Variables:
    echo        NOTION_API_KEY      = API key Notion Anda
    echo        NOTION_DATABASE_ID  = ID database Notion
    echo   4. Deploy
    echo.
    echo Panduan lengkap: buka file DEPLOY_VERCEL.md
    echo.
    start "" DEPLOY_VERCEL.md 2>nul
    pause
    exit /b 0
)

echo Node.js terdeteksi - deploy via CLI opsional.
echo Untuk deploy tanpa CLI, tetap gunakan DEPLOY_VERCEL.md ^(GitHub + Vercel web^).
echo.
set /p LANJUT="Jalankan npx vercel --prod sekarang? (Y/N): "
if /i not "%LANJUT%"=="Y" (
    echo Dibatalkan. Baca DEPLOY_VERCEL.md untuk deploy via browser.
    pause
    exit /b 0
)

call npm install
call npx vercel --prod
echo.
pause

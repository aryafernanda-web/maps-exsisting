@echo off
echo ==========================================
echo   Fiber Customer Maps - Vercel Deployer
echo ==========================================
echo.

REM Cek apakah Node.js terinstall
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js tidak ditemukan! 
    echo Silakan download dan install Node.js dari: https://nodejs.org/
    pause
    exit /b
)

echo [1/3] Menginstall dependencies...
call npm install

echo [2/3] Mencoba deploy ke Vercel...
echo Pastikan Anda sudah login ke Vercel (npx vercel login).
echo.
call npx vercel --prod

echo.
echo [3/3] Selesai! 
echo Jika berhasil, URL website Anda akan muncul di atas.
pause

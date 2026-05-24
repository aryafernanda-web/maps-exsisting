@echo off
cd /d "%~dp0"
echo Starting local development server...
if exist .env.local goto run
if not exist .env (
    echo.
    echo PERINGATAN: File .env belum ada. Salin .env.example ke .env lalu isi NOTION_API_KEY.
    echo.
)
:run
npm run local
pause

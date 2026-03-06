@echo off
echo Liberando puerto 8001...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr " 8001 "') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo Iniciando backend...
cd /d "C:\Users\MiguelAndresBeltranG\Happy-Tree-Friends\backend"
"C:\Users\MiguelAndresBeltranG\AppData\Local\Programs\Python\Python312\python.exe" -m uvicorn main:app --port 8001
pause

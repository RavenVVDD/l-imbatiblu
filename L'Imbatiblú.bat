@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo.
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)

start "" /min cmd /k "npm run serve"
start "" /min cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start http://localhost:5173

endlocal

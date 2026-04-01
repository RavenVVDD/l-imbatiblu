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

echo Compilando build para modo live...
call npm run build
if errorlevel 1 (
  echo.
  echo Fallo el build.
  pause
  exit /b 1
)

echo Iniciando servidor live...
start "L'Imbatiblú Live" cmd /k "npm run serve"

timeout /t 2 /nobreak >nul
start http://localhost:3001

endlocal

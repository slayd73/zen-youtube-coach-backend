@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  make-project-trees-doubleclick.bat
REM  Genera:
REM   - project-tree-frontend.txt
REM   - project-tree-backend.txt
REM  Avvio con doppio click (no CMD)
REM ============================================================

REM ============================================================
REM  PERCORSI ASSOLUTI (CONFERMATI)
REM ============================================================

set "FRONTEND_DIR=C:\Users\christian.SYSTEMA\0000 PROGETTO ZEN COACH CHRY\zen-youtube-coach-dashboard"
set "BACKEND_DIR=C:\Users\christian.SYSTEMA\OneDrive\Immagini\SALUTE E BENESSERE\NUOVI VIDEO FLIKI\YOUTUBE COACH PRO DA ATTIVARE\APPLICAZIONE GITHUB\zen-youtube-coach-backend"

REM ============================================================
REM  OUTPUT (nella stessa cartella del .bat)
REM ============================================================

set "BASE_DIR=%~dp0"
set "OUT_FRONT=%BASE_DIR%project-tree-frontend.txt"
set "OUT_BACK=%BASE_DIR%project-tree-backend.txt"

REM ============================================================
REM  CHECK CARTELLE
REM ============================================================

if not exist "%FRONTEND_DIR%\" (
  echo [ERRORE] Cartella FRONTEND non trovata:
  echo %FRONTEND_DIR%
  goto END
)

if not exist "%BACKEND_DIR%\" (
  echo [ERRORE] Cartella BACKEND non trovata:
  echo %BACKEND_DIR%
  goto END
)

REM ============================================================
REM  HEADER FILE
REM ============================================================

for %%F in ("%OUT_FRONT%" "%OUT_BACK%") do (
  > "%%~F" echo ============================================================
  >> "%%~F" echo Project Tree generated on: %DATE% %TIME%
  >> "%%~F" echo Excludes: node_modules, .git, dist, build, .next, coverage
  >> "%%~F" echo ============================================================
  >> "%%~F" echo.
)

echo [OK] Genero project-tree-frontend.txt
call :DO_TREE "%FRONTEND_DIR%" "%OUT_FRONT%"

echo [OK] Genero project-tree-backend.txt
call :DO_TREE "%BACKEND_DIR%" "%OUT_BACK%"

echo.
echo ============================================================
echo COMPLETATO CON SUCCESSO
echo File creati in:
echo %BASE_DIR%
echo ============================================================

:END
echo.
pause
exit /b 0

REM ============================================================
REM  FUNZIONE TREE
REM ============================================================

:DO_TREE
set "TARGET=%~1"
set "OUT=%~2"

>> "%OUT%" echo ROOT: %TARGET%
>> "%OUT%" echo.

>> "%OUT%" echo [DIRECTORY TREE]
tree "%TARGET%" /A /F ^
 | findstr /I /V ^
   /C:"\node_modules\" ^
   /C:"\.git\" ^
   /C:"\dist\" ^
   /C:"\build\" ^
   /C:"\.next\" ^
   /C:"\coverage\" ^
   /C:"\out\" ^
   /C:"\.turbo\" ^
   /C:"\.cache\" ^
   /C:"\tmp\" ^
   /C:"\temp\" ^
   /C:"\logs\" ^
   /C:"\exports\" ^
 >> "%OUT%"

>> "%OUT%" echo.
>> "%OUT%" echo [FILES - RELATIVE PATHS]
>> "%OUT%" echo.

pushd "%TARGET%"
for /f "delims=" %%P in ('
  dir /S /B /A:-D ^
  ^| findstr /I /V ^
    /C:"\node_modules\" ^
    /C:"\.git\" ^
    /C:"\dist\" ^
    /C:"\build\" ^
    /C:"\.next\" ^
    /C:"\coverage\" ^
    /C:"\out\" ^
    /C:"\.turbo\" ^
    /C:"\.cache\" ^
    /C:"\tmp\" ^
    /C:"\temp\" ^
    /C:"\logs\" ^
    /C:"\exports\"
') do (
  set "ABS=%%P"
  set "REL=!ABS:%CD%\=!"
  >> "%OUT%" echo !REL!
)
popd

>> "%OUT%" echo.
>> "%OUT%" echo [END]
exit /b 0

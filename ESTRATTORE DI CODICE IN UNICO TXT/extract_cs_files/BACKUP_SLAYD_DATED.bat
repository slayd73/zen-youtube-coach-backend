@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=C:\DEV\zen-youtube-coach-backend\ESTRATTORE DI CODICE IN UNICO TXT\extract_cs_files"
set "OUTROOT=C:\DEV\BACKUP_SLAYD"

cd /d "%ROOT%" || (
  echo ERRORE: cartella estrattore non trovata:
  echo %ROOT%
  pause
  exit /b 1
)

echo.
echo === BACKUP SLAYD (Dated) ===
echo Root: %ROOT%
echo Backup root: %OUTROOT%
echo.

rem --- timestamp safe for folder name: YYYY-MM-DD_HHMM
for /f "tokens=1-3 delims=/- " %%a in ("%date%") do (
  set "D1=%%a"
  set "D2=%%b"
  set "D3=%%c"
)
for /f "tokens=1-2 delims=:." %%a in ("%time%") do (
  set "T1=%%a"
  set "T2=%%b"
)
set "T1=%T1: =0%"

rem Prova a comporre in stile europeo (DD/MM/YYYY) oppure YYYY-MM-DD.
rem Se %D3% ha 4 cifre, spesso è l'anno.
set "YYYY=%D3%"
set "MM=%D2%"
set "DD=%D1%"

set "STAMP=%YYYY%-%MM%-%DD%_%T1%%T2%"
set "BKDIR=%OUTROOT%\%STAMP%"

mkdir "%BKDIR%" 2>nul
if errorlevel 1 (
  echo ERRORE: impossibile creare cartella backup:
  echo %BKDIR%
  pause
  exit /b 1
)

echo Cartella backup: %BKDIR%
echo.

echo [1/3] Genero extracted_code.txt ...
python extract_cs_files.py paths.txt extracted_code.txt
if errorlevel 1 (
  echo.
  echo ERRORE: extract_cs_files.py ha fallito.
  pause
  exit /b 1
)

echo.
echo [2/3] Copio i file nel backup...
copy /y "extracted_code.txt" "%BKDIR%\extracted_code.txt" >nul
if errorlevel 1 (
  echo ERRORE: copy extracted_code.txt fallita.
  pause
  exit /b 1
)

copy /y "paths.txt" "%BKDIR%\paths.txt" >nul
copy /y "unpack_extracted_code.py" "%BKDIR%\unpack_extracted_code.py" >nul

echo.
echo [3/3] Verifiche...
echo --- extracted_code.txt (nella cartella estrattore) ---
dir /T:W "extracted_code.txt"
for %%A in ("extracted_code.txt") do echo SIZE=%%~zA bytes

echo.
echo --- extracted_code.txt (nel backup) ---
dir /T:W "%BKDIR%\extracted_code.txt"
for %%A in ("%BKDIR%\extracted_code.txt") do echo SIZE=%%~zA bytes

echo.
echo OK. Backup creato in:
echo %BKDIR%
echo.

echo Prossimo step (restore) esempio:
echo   cd /d "%BKDIR%"
echo   python unpack_extracted_code.py extracted_code.txt "C:\DEV\Restore App SLAYD INTELLIGENCE__RESTORED"
echo.
pause

@echo off
rem Empaqueta public/ en sirius-deploy.zip, listo para subir por cPanel File Manager.
rem Excluye: includes/config.php (nunca se sube; el asistente de instalación lo escribe
rem en el servidor), install/.installed (candado del asistente) y el contenido ya
rem subido de uploads/ (membretes, PDFs archivados) — el sitio nuevo empieza limpio.
cd /d "%~dp0"

set STAGE=%TEMP%\sirius-package
set ZIP=%~dp0sirius-deploy.zip

echo Preparando copia temporal...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

robocopy public "%STAGE%" /E /XF config.php .installed *.sqlite /NFL /NDL /NJH /NJS
if %ERRORLEVEL% GEQ 8 (
  echo ERROR: robocopy fallo al copiar public/
  exit /b 1
)

echo Limpiando contenido ya subido de uploads/ (se queda vacio, solo .htaccess)...
powershell -NoProfile -Command ^
  "Get-ChildItem -Path '%STAGE%\uploads' -Recurse -File | Where-Object { $_.Name -ne '.htaccess' } | Remove-Item -Force; " ^
  "Get-ChildItem -Path '%STAGE%\uploads' -Recurse -Directory | Where-Object { $_.Name -eq 'cache' } | Remove-Item -Recurse -Force"

echo Comprimiendo a sirius-deploy.zip...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zip_deploy.ps1" -StageDir "%STAGE%" -ZipPath "%ZIP%"

rmdir /s /q "%STAGE%"

if exist "%ZIP%" (
  echo.
  echo Listo: sirius-deploy.zip
  echo Subelo por cPanel ^> Administrador de archivos, extraelo dentro de public_html
  echo y visita https://tudominio.com/install/ para terminar la instalacion.
) else (
  echo ERROR: no se genero el zip.
  exit /b 1
)

@echo off
rem Compila Tailwind CSS. Uso: build.bat [--watch]
rem Nota: el binario standalone falla al escribir en rutas con espacios,
rem por eso se genera en %TEMP% (ruta corta) y luego se copia al proyecto.
cd /d "%~dp0"
set OUT=%TEMP%\sirius-app.css
tools\tailwindcss.exe -i src\tailwind.css -o "%OUT%" --minify %*
if exist "%OUT%" copy /y "%OUT%" "public\assets\css\app.css" >nul
echo CSS listo en public\assets\css\app.css

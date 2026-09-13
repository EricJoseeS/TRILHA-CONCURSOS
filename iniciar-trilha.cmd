@echo off
setlocal
cd /d "%~dp0"
if "%GEMINI_API_KEY%"=="" echo [INFO] GEMINI_API_KEY nao configurada; a IA pode usar a chave local do navegador.
"%ProgramFiles%\nodejs\node.exe" server.mjs
pause

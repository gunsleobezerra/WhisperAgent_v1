@echo off
title Build Instalador WhisperAgent
echo ========================================================
echo   Compilando e Gerando Instalador: WhisperAgent
echo ========================================================

:: 1. Carregar ambiente de compilação MSVC x64
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) else if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" (
    call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)

:: 2. Variaveis de ambiente para whisper-rs (LLVM / Clang / CMake)
set LIBCLANG_PATH=C:\Program Files\LLVM\bin
set PATH=C:\Program Files\CMake\bin;C:\Program Files\LLVM\bin;%PATH%

:: 3. Navegar para a pasta app e executar o build do Tauri
cd /d "%~dp0app"
call npm run tauri build

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Falha durante a geracao do instalador. Verifique as mensagens acima.
    if "%~1" neq "--no-pause" pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================================
echo   [SUCESSO] Instalador gerado com sucesso!
echo ========================================================
echo   Local do instalador (.exe NSIS):
echo   %~dp0app\src-tauri\target\release\bundle\nsis\
echo ========================================================
echo.
if "%~1" neq "--no-pause" pause


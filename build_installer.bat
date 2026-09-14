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

:: 3. Navegar para a pasta app e compilar o binario
cd /d "%~dp0app"
echo [1/3] Compilando binarios Rust/Tauri...
call npm run tauri build -- --no-bundle

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERRO] Falha durante a compilacao do app. Verifique as mensagens acima.
    if "%~1" neq "--no-pause" pause
    exit /b %ERRORLEVEL%
)

:: 4. Copiar DLLs do CUDA para a pasta do executável (evita erro cublas64_13.dll em outras maquinas)
echo.
echo [2/3] Empacotando dependencias CUDA (cublas, cudart, nvrtc)...
set TARGET_DIR=%~dp0app\src-tauri\target\release
set CUDA_BIN_DIR=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\bin\x64

if exist "%CUDA_BIN_DIR%\cublas64_13.dll" (
    copy /Y "%CUDA_BIN_DIR%\cublas64_13.dll" "%TARGET_DIR%\" >nul
    copy /Y "%CUDA_BIN_DIR%\cublasLt64_13.dll" "%TARGET_DIR%\" >nul
    copy /Y "%CUDA_BIN_DIR%\cudart64_13.dll" "%TARGET_DIR%\" >nul
    if exist "%CUDA_BIN_DIR%\nvrtc64_130_0.dll" (
        copy /Y "%CUDA_BIN_DIR%\nvrtc64_130_0.dll" "%TARGET_DIR%\" >nul
    )
    echo    - cublas64_13.dll copiada
    echo    - cublasLt64_13.dll copiada
    echo    - cudart64_13.dll copiada
) else (
    echo [AVISO] CUDA Toolkit 13.3 bin\x64 nao encontrado. O executavel pode depender de DLLs externas.
)

:: 5. Gerar o instalador final contendo todas as DLLs
echo.
echo [3/3] Empacotando instalador NSIS...
call npm run tauri bundle

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


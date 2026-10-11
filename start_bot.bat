@echo off
rem -------------------------------------------------
rem Запуск Telegram‑бота у фоні з логуванням
rem -------------------------------------------------
set "BASE_DIR=%~dp0"
if "%BASE_DIR:~-1%"=="\" set "BASE_DIR=%BASE_DIR:~0,-1%"
set "LOG_DIR=%BASE_DIR%\logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

rem Створити файл error.log, якщо його немає
if not exist "%LOG_DIR%\error.log" type nul > "%LOG_DIR%\error.log"

rem Записати стартовий рядок у bot.log
echo [%date% %time%] Bot start >> "%LOG_DIR%\bot.log"
echo Starting GHOST GTA Bot... >> "%LOG_DIR%\bot.log"

rem Перевірити наявність node
set "NODE_BIN=node"
where node >nul 2>&1
if errorlevel 1 (
    if exist "C:\Program Files\node-v24.19.0-win-x64\node.exe" (
        set "NODE_BIN=C:\Program Files\node-v24.19.0-win-x64\node.exe"
    ) else if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_BIN=C:\Program Files\nodejs\node.exe"
    ) else if exist "C:\ugta_serverAPI\node.exe" (
        set "NODE_BIN=C:\ugta_serverAPI\node.exe"
    ) else (
        echo [ERROR] Node.js не знайдено! >> "%LOG_DIR%\bot.log"
        exit /b 1
    )
)

cd /d "%BASE_DIR%"
rem Запускаємо бот і перенаправляємо stdout+stderr в лог
"%NODE_BIN%" "%BASE_DIR%\bot.js" >> "%LOG_DIR%\bot.log" 2>&1

@echo off
chcp 65001 >nul
title GHOST GTA | Встановлення автозапуску бота

echo ========================================================
echo   Налаштування автозапуску бота при включенні Windows
echo ========================================================
echo.

set "BOT_DIR=%~dp0"
if "%BOT_DIR:~-1%"=="\" set "BOT_DIR=%BOT_DIR:~0,-1%"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\GHOST_GTA_Bot.vbs"

(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.CurrentDirectory = "%BOT_DIR%"
echo WshShell.Run "cmd.exe /c start_bot.bat", 0, False
) > "%SHORTCUT_PATH%"

if exist "%SHORTCUT_PATH%" (
    echo [УСПІШНО] Бот додано до автозавантаження Windows!
    echo Тепер щоразу при включенні комп'ютера бот сам запускатиметься у фоні.
) else (
    echo [ПОМИЛКА] Не вдалося створити файл в автозавантаженні.
)

echo.
pause

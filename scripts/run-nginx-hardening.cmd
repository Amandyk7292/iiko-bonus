@echo off
chcp 65001 >nul
title Bulka - исправление замечаний эквайринга
echo.
echo Введите пароль sudo для VPS.
echo При вводе символы пароля не отображаются - это нормально.
echo.
"C:\Windows\System32\OpenSSH\ssh.exe" -F "C:\Users\Asus Rog\.ssh\config" -tt bulka-vps "sudo bash /tmp/bulka-harden-nginx.sh"
set "result=%errorlevel%"
echo.
if "%result%"=="0" (
  echo Готово. Настройки Nginx применены и проверены.
) else (
  echo Настройка не завершена. Код ошибки: %result%
)
echo.
pause
exit /b %result%

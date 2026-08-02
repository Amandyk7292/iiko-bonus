$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Bulka - исправление замечаний эквайринга'

Write-Host ''
Write-Host 'Введите пароль sudo для VPS.' -ForegroundColor Yellow
Write-Host 'При вводе пароль не отображается - это нормально.' -ForegroundColor DarkGray
Write-Host ''

& ssh.exe -t bulka-vps 'sudo bash /tmp/bulka-harden-nginx.sh'
$exitCode = $LASTEXITCODE

Write-Host ''
if ($exitCode -eq 0) {
    Write-Host 'Готово. Настройки Nginx применены и проверены.' -ForegroundColor Green
} else {
    Write-Host "Настройка не завершена (код $exitCode)." -ForegroundColor Red
}

Read-Host 'Нажмите Enter, чтобы закрыть окно'
exit $exitCode

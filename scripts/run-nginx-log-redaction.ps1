$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Bulka - Nginx access log hardening'

Write-Host ''
Write-Host 'Enter the VPS root SSH password.' -ForegroundColor Yellow
Write-Host 'The password is not displayed while typing. Do not send it in chat.' `
    -ForegroundColor DarkGray
Write-Host ''

& ssh.exe -t -o User=root bulka-vps 'bash /tmp/bulka-harden-nginx-access-logs.sh'
$exitCode = $LASTEXITCODE

Write-Host ''
if ($exitCode -eq 0) {
    Write-Host 'Done. Query parameters are no longer written to the Nginx access log.' `
        -ForegroundColor Green
} else {
    Write-Host "The operation failed with exit code $exitCode." -ForegroundColor Red
}

Read-Host 'Press Enter to close this window'
exit $exitCode

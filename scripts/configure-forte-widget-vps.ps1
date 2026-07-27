param(
    [string]$SshHost = 'bulka-vps',
    [string]$StatusFile = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$remoteScriptSource = Join-Path $PSScriptRoot 'configure-forte-widget-vps.sh'
$remoteScript = '/tmp/configure-forte-widget-vps.sh'
$exitCode = 1

if ($StatusFile) {
    Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue
}

try {
    if (-not (Test-Path -LiteralPath $remoteScriptSource)) {
        throw "Missing activation script: $remoteScriptSource"
    }

    Write-Host ''
    Write-Host 'Open Forte E-commerce > Магазины > Подробнее before continuing.' -ForegroundColor Cyan
    Write-Host 'You will enter Shop ID, Secret Key and the RSA public key.' -ForegroundColor Cyan
    Write-Host 'Secret values are hidden and are sent directly to the VPS.' -ForegroundColor Yellow
    Write-Host ''

    & scp $remoteScriptSource "${SshHost}:$remoteScript"
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not upload the secure activation script.'
    }

    & ssh -tt $SshHost "chmod 0700 '$remoteScript' && sudo '$remoteScript'; result=`$?; rm -f -- '$remoteScript'; exit `$result"
    if ($LASTEXITCODE -ne 0) {
        throw 'Forte Payment Widget activation failed.'
    }

    $exitCode = 0
    Write-Host ''
    Write-Host 'Forte Payment Widget is active on the VPS.' -ForegroundColor Green
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    if ($StatusFile) {
        $statusDirectory = Split-Path -Parent $StatusFile
        if ($statusDirectory -and -not (Test-Path -LiteralPath $statusDirectory)) {
            New-Item -ItemType Directory -Path $statusDirectory -Force | Out-Null
        }
        Set-Content -LiteralPath $StatusFile -Value $(if ($exitCode -eq 0) { 'success' } else { 'failed' })
    }
    Write-Host ''
    Read-Host 'Press Enter to close this window'
}

exit $exitCode

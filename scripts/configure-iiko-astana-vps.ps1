param(
    [string]$SshHost = 'bulka-vps',
    [string]$StatusFile = ''
)

$ErrorActionPreference = 'Stop'
$remoteScriptSource = Join-Path $PSScriptRoot 'configure-iiko-astana-vps.sh'
$remoteScript = "/home/deploy/.configure-iiko-astana-$PID.sh"
$exitCode = 1

if ($StatusFile) {
    Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue
}

try {
    if (-not (Test-Path -LiteralPath $remoteScriptSource)) {
        throw "Missing activation script: $remoteScriptSource"
    }

    Write-Host ''
    Write-Host 'This keeps the existing IIKO_API_LOGIN unchanged.' -ForegroundColor Cyan
    Write-Host 'You will enter only the separate iiko Cloud API login for Astana.' -ForegroundColor Cyan
    Write-Host 'The value is hidden and is sent directly to the VPS.' -ForegroundColor Yellow
    Write-Host ''

    & scp $remoteScriptSource "${SshHost}:$remoteScript"
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not upload the secure Astana iiko activation script.'
    }

    & ssh -tt $SshHost "chmod 0700 '$remoteScript' && '$remoteScript'; result=`$?; rm -f -- '$remoteScript'; exit `$result"
    if ($LASTEXITCODE -ne 0) {
        throw 'Astana iiko Cloud activation failed.'
    }

    $exitCode = 0
    Write-Host ''
    Write-Host 'The separate Astana iiko Cloud profile is active on the VPS.' -ForegroundColor Green
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

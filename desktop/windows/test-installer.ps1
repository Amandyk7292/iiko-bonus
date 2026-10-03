[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = Join-Path $repositoryRoot ('outputs\windows-installer-test-' + [Guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $testRoot 'installed'
$registryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{643E9AF2-4135-47AB-BDCC-C71140B42D4E}_is1'
if (Test-Path -LiteralPath $registryPath) { throw 'An existing Bulka Staff installation is registered. Preserve it; do not run this isolated installer test.' }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$profile = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Bulka\Staff\Profile'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$nonce = [Guid]::NewGuid().ToString('N')
$marker = Join-Path $profile "bulka-installer-test-$nonce.txt"
[IO.File]::WriteAllText($marker, $nonce, [Text.Encoding]::ASCII)
$arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/SP-', '/NORESTART', '/TASKS=""', ('/DIR="' + $installDirectory + '"'))
$mutex = $null
$installed = $false
try {
    $createdNew = $false
    $mutex = [Threading.Mutex]::new($true, 'Local\Bulka.Staff.Launcher.v1', [ref]$createdNew)
    if (-not $createdNew) { throw 'Bulka Staff is currently running. Close its window before testing installer behavior.' }
    $blockedArguments = $arguments + ('/LOG="' + (Join-Path $testRoot 'blocked-install.log') + '"')
    $blocked = Start-Process -FilePath $InstallerPath -ArgumentList $blockedArguments -WindowStyle Hidden -PassThru
    if (-not $blocked.WaitForExit(55000)) { throw 'Blocked installer did not exit within its test deadline.' }
    if ($blocked.ExitCode -eq 0 -or (Test-Path -LiteralPath (Join-Path $installDirectory 'BulkaStaff.exe'))) {
        throw 'Installer did not block replacement while the application mutex existed.'
    }
    $mutex.ReleaseMutex(); $mutex.Dispose(); $mutex = $null
    $installArguments = $arguments + ('/LOG="' + (Join-Path $testRoot 'install.log') + '"')
    $install = Start-Process -FilePath $InstallerPath -ArgumentList $installArguments -WindowStyle Hidden -PassThru
    if (-not $install.WaitForExit(55000) -or $install.ExitCode -ne 0) { throw 'Silent per-user installation failed.' }
    $installed = $true
    $architecture = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
    $buildRoot = Split-Path -Parent (Split-Path -Parent $InstallerPath)
    foreach ($relativePath in @('BulkaStaff.exe', 'runtime\chrome.exe', 'distribution-notices.txt', 'runtime-lock.json')) {
        $installedPath = Join-Path $installDirectory $relativePath
        if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) { throw "Required installed component is missing: $relativePath" }
        if ($relativePath -in @('BulkaStaff.exe', 'runtime\chrome.exe')) {
            $payloadPath = Join-Path $buildRoot "payload\$architecture\$relativePath"
            if ((Get-FileHash -LiteralPath $payloadPath).Hash -ne (Get-FileHash -LiteralPath $installedPath).Hash) {
                throw 'Installer selected the wrong architecture or changed a verified payload.'
            }
        }
    }
    if (-not (Test-Path -LiteralPath $registryPath)) { throw 'Per-user uninstall registration is missing.' }
    if ([IO.File]::ReadAllText($marker) -ne $nonce) { throw 'Installation altered the existing browser profile marker.' }
    $uninstall = Start-Process -FilePath (Join-Path $installDirectory 'unins000.exe') -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + (Join-Path $testRoot 'uninstall.log') + '"')) -WindowStyle Hidden -PassThru
    if (-not $uninstall.WaitForExit(55000) -or $uninstall.ExitCode -ne 0) { throw 'Silent uninstall failed.' }
    $installed = $false
    if (Test-Path -LiteralPath (Join-Path $installDirectory 'BulkaStaff.exe')) { throw 'Uninstall left the installed launcher behind.' }
    if (Test-Path -LiteralPath $registryPath) { throw 'Uninstall left its test registration behind.' }
    if (-not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne $nonce) { throw 'Uninstall changed or deleted the existing browser profile.' }
    $result = [ordered]@{
        perUserInstall = $true; installedArchitecture = $architecture; installedPayloadHashesMatch = $true
        blocksWhileApplicationRuns = $true; blockedExitCode = $blocked.ExitCode
        uninstallRemovesApplication = $true; uninstallPreservesProfile = $true
        installedOnWindows7Hardware = $false
    }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'test-report.json') -Encoding UTF8
    Write-Host "Universal installer smoke test passed: $testRoot"
}
finally {
    if ($mutex) { if ($createdNew) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
    # Remove only this test's unique marker after proving profile preservation.
    if ((Test-Path -LiteralPath $marker -PathType Leaf) -and [IO.File]::ReadAllText($marker) -eq $nonce) { Remove-Item -LiteralPath $marker }
    if ($installed) { Write-Warning "A failed test installation is preserved for inspection: $installDirectory" }
}

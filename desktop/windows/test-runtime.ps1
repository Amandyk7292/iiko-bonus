[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PayloadDirectory,
    [string]$SiteUrl = 'http://127.0.0.1:58333/?desktop=1',
    [ValidateSet('x86', 'x64')][string[]]$Architectures = @('x86'),
    [ValidateRange(0, 60000)][int]$VirtualTimeBudget = 10000,
    [switch]$DisableGpu
)
$ErrorActionPreference = 'Stop'
$site = $null
if (-not [Uri]::TryCreate($SiteUrl, [UriKind]::Absolute, [ref]$site) -or
    $site.Host -notin @('localhost', '127.0.0.1', '::1') -or $site.Scheme -notin @('http', 'https')) {
    throw 'The render smoke test requires an explicit local, read-only preview URL.'
}
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Invoke-WebRequest -Method Head -Uri $SiteUrl -TimeoutSec 5 -UseBasicParsing | Out-Null
$testRoot = Join-Path $repositoryRoot ('outputs\windows-runtime-render-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$results = @()
foreach ($architecture in $Architectures) {
    $browser = [IO.Path]::GetFullPath((Join-Path $PayloadDirectory "$architecture\runtime\chrome.exe"))
    if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw "Verified runtime is missing: $architecture" }
    $architectureDirectory = Join-Path $testRoot $architecture
    New-Item -ItemType Directory -Path $architectureDirectory | Out-Null
    $profile = Join-Path $architectureDirectory 'temporary-profile'
    $screenshot = Join-Path $architectureDirectory 'login-desktop.png'
    $arguments = @('--headless', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
        '--window-size=1440,900', '--timeout=20000',
        ('--user-data-dir="' + $profile + '"'), ('--screenshot="' + $screenshot + '"'), $SiteUrl)
    if ($VirtualTimeBudget -gt 0) { $arguments = @("--virtual-time-budget=$VirtualTimeBudget") + $arguments }
    if ($DisableGpu) { $arguments = @('--disable-gpu') + $arguments }
    $process = Start-Process -FilePath $browser -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $architectureDirectory 'stdout.log') -RedirectStandardError (Join-Path $architectureDirectory 'stderr.log')
    if (-not $process.WaitForExit(55000)) {
        # Stop only this test's own browser and descendants, preserving diagnostics.
        $testChildren = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" | Where-Object { $_.ExecutablePath -eq $browser }
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        foreach ($testChild in $testChildren) { Stop-Process -Id $testChild.ProcessId -ErrorAction SilentlyContinue }
        throw "Headless runtime did not finish within its test deadline: $architecture"
    }
    if ($process.ExitCode -ne 0) { throw "Real headless browser exited with code $($process.ExitCode): $architecture" }
    if (-not (Test-Path -LiteralPath $screenshot -PathType Leaf) -or (Get-Item -LiteralPath $screenshot).Length -lt 4096) {
        throw "Headless browser did not create a useful screenshot: $architecture"
    }
    $results += [pscustomobject]@{
        architecture = $architecture; browserVersion = (Get-Item -LiteralPath $browser).VersionInfo.FileVersion
        processExitCode = $process.ExitCode; screenshot = $screenshot; screenshotBytes = (Get-Item -LiteralPath $screenshot).Length
        isolatedEmptyTestProfile = $true; browserSandboxDisabled = $false; tlsChecksDisabled = $false
        operatingSystem64Bit = [Environment]::Is64BitOperatingSystem
        browserUsesWOW64 = ($architecture -eq 'x86' -and [Environment]::Is64BitOperatingSystem)
        gpuDisabledForDiagnostics = [bool]$DisableGpu
        virtualTimeBudget = $VirtualTimeBudget
        visualReviewRequired = $true; testedOnWindows7Hardware = $false
    }
}
[ordered]@{ localUrl = $SiteUrl; runtimeResults = $results; note = 'Real bundled browsers rendered a local preview. No login or application mutation was performed.' } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $testRoot 'test-report.json') -Encoding UTF8
Write-Host "Real runtime render smoke completed; inspect the screenshots: $testRoot"

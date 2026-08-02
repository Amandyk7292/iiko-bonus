#requires -Version 7.0

param(
    [string]$RecoveryRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Bulka Recovery'),
    [int]$RetentionDays = 30
)

$ErrorActionPreference = 'Stop'
if ($RetentionDays -lt 7 -or $RetentionDays -gt 365) {
    throw 'RetentionDays must be between 7 and 365.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$storageScript = Join-Path $PSScriptRoot 'backup-supabase-storage.js'
$storageRoot = Join-Path $RecoveryRoot 'Storage Snapshots'
$databaseRoot = Join-Path $RecoveryRoot 'Database Dumps'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)][string]$FileName,
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$StandardInput = '',
        [string]$WorkingDirectory = $projectRoot
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FileName
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        $startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Could not start $FileName."
    }
    if ($StandardInput) {
        $process.StandardInput.Write($StandardInput)
    }
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "$FileName failed with exit code $($process.ExitCode): $errorOutput"
    }
    return $output
}

function Test-ChildPath {
    param(
        [Parameter(Mandatory)][string]$Parent,
        [Parameter(Mandatory)][string]$Child
    )

    $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
    $resolvedChild = [IO.Path]::GetFullPath($Child)
    return $resolvedChild.StartsWith(
        "$resolvedParent\",
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Remove-ExpiredItems {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][datetime]$Cutoff,
        [Parameter(Mandatory)][string]$Filter,
        [switch]$Directories
    )

    if (-not (Test-Path -LiteralPath $Root)) { return }
    $items = if ($Directories) {
        Get-ChildItem -LiteralPath $Root -Directory -Force -Filter $Filter |
            Where-Object { $_.LastWriteTimeUtc -lt $Cutoff }
    } else {
        Get-ChildItem -LiteralPath $Root -File -Force -Filter $Filter |
            Where-Object { $_.LastWriteTimeUtc -lt $Cutoff }
    }
    foreach ($item in $items) {
        if (-not (Test-ChildPath -Parent $Root -Child $item.FullName)) {
            throw "Refusing retention cleanup outside $Root."
        }
        Remove-Item -LiteralPath $item.FullName -Force -Recurse:$Directories
    }
}

New-Item -ItemType Directory -Path $RecoveryRoot, $storageRoot, $databaseRoot -Force |
    Out-Null
& icacls.exe $RecoveryRoot '/inheritance:r' '/grant:r' `
    "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not protect the recovery directory ACL.'
}
if (-not (Test-Path -LiteralPath $storageScript)) {
    throw "Storage backup script is missing: $storageScript"
}

$productionEnv = Invoke-CapturedProcess `
    -FileName 'ssh.exe' `
    -Arguments @('bulka-vps', 'cat /var/www/iiko-bonus/.env')
$keyCount = ([regex]::Matches(
    $productionEnv,
    '(?m)^[A-Za-z_][A-Za-z0-9_]*='
)).Count
if ($keyCount -lt 80) {
    throw "Production environment looks incomplete ($keyCount keys)."
}
$plainHashBytes = [Security.Cryptography.SHA256]::HashData(
    [Text.Encoding]::UTF8.GetBytes($productionEnv)
)
$plainHash = [Convert]::ToHexString($plainHashBytes).ToLowerInvariant()
$latestMetadata = Get-ChildItem -LiteralPath $RecoveryRoot `
    -Filter 'production-env-*.dpapi.json' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
$environmentBackup = $null
if ($latestMetadata) {
    $metadata = Get-Content -LiteralPath $latestMetadata.FullName -Raw |
        ConvertFrom-Json
    if ($metadata.sha256 -eq $plainHash) {
        $candidate = Join-Path $RecoveryRoot $metadata.encryptedFile
        if (Test-Path -LiteralPath $candidate) {
            $environmentBackup = $candidate
        }
    }
}
if (-not $environmentBackup) {
    $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $environmentBackup = Join-Path $RecoveryRoot "production-env-$timestamp.dpapi"
    $secure = ConvertTo-SecureString -String $productionEnv -AsPlainText -Force
    $cipher = ConvertFrom-SecureString -SecureString $secure
    [IO.File]::WriteAllText(
        $environmentBackup,
        $cipher,
        [Text.UTF8Encoding]::new($false)
    )
    $metadata = [ordered]@{
        schemaVersion = 1
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        sourceHost = '185.113.132.73'
        sourcePath = '/var/www/iiko-bonus/.env'
        encryption = 'Windows DPAPI CurrentUser'
        keyCount = $keyCount
        sha256 = $plainHash
        encryptedFile = [IO.Path]::GetFileName($environmentBackup)
    }
    [IO.File]::WriteAllText(
        "$environmentBackup.json",
        ($metadata | ConvertTo-Json),
        [Text.UTF8Encoding]::new($false)
    )
}

$storageOutput = Invoke-CapturedProcess `
    -FileName 'node.exe' `
    -Arguments @(
        $storageScript,
        '--env-stdin',
        "--output=$storageRoot"
    ) `
    -StandardInput $productionEnv
$storageResult = $storageOutput | ConvertFrom-Json
$productionEnv = $null

$latestDumpName = (
    Invoke-CapturedProcess `
        -FileName 'ssh.exe' `
        -Arguments @(
            'bulka-vps',
            "find /home/deploy/.bulka-releases/database-backups -maxdepth 1 -type f -name 'bulka-*.dump' -printf '%f\n' | sort | tail -n 1"
        )
).Trim()
if ($latestDumpName -notmatch '^bulka-[0-9TZ]+\.dump$') {
    throw 'Could not resolve the latest verified database dump.'
}
$localDump = Join-Path $databaseRoot $latestDumpName
if (-not (Test-Path -LiteralPath $localDump)) {
    & scp.exe `
        "bulka-vps:/home/deploy/.bulka-releases/database-backups/$latestDumpName" `
        $databaseRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database dump.' }
    & scp.exe `
        "bulka-vps:/home/deploy/.bulka-releases/database-backups/$latestDumpName.sha256" `
        $databaseRoot
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the database checksum.' }
}
$expectedHash = (
    (Get-Content -LiteralPath "$localDump.sha256" -Raw).Trim() -split '\s+'
)[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $localDump -Algorithm SHA256).
    Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) {
    throw 'Copied database dump checksum verification failed.'
}

$cutoff = [DateTime]::UtcNow.AddDays(-$RetentionDays)
Remove-ExpiredItems `
    -Root $storageRoot `
    -Cutoff $cutoff `
    -Filter 'supabase-storage-*' `
    -Directories
Remove-ExpiredItems `
    -Root $databaseRoot `
    -Cutoff $cutoff `
    -Filter 'bulka-*.dump*'
Remove-ExpiredItems `
    -Root $RecoveryRoot `
    -Cutoff $cutoff `
    -Filter 'production-env-*.dpapi'
Remove-ExpiredItems `
    -Root $RecoveryRoot `
    -Cutoff $cutoff `
    -Filter 'production-env-*.dpapi.json'

$result = [ordered]@{
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    environmentBackup = $environmentBackup
    environmentKeys = $keyCount
    storageSnapshot = $storageResult.snapshot
    storageFiles = $storageResult.files
    storageBytes = $storageResult.bytes
    databaseDump = $localDump
    databaseChecksumVerified = $true
}
[IO.File]::WriteAllText(
    (Join-Path $RecoveryRoot 'last-success.json'),
    ($result | ConvertTo-Json),
    [Text.UTF8Encoding]::new($false)
)
$result | ConvertTo-Json -Compress

param(
    [switch]$SkipBuild,
    [switch]$ApplyMigrations,
    [switch]$SkipMigrations,
    [switch]$EmergencyBypassProvenanceGate,
    [string]$EmergencyBypassReason
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
if ($SkipMigrations) {
    throw '-SkipMigrations is retired. Production releases must apply every pending migration before promotion.'
}
if ($EmergencyBypassProvenanceGate -and [string]::IsNullOrWhiteSpace($EmergencyBypassReason)) {
    throw 'Emergency provenance bypass requires -EmergencyBypassReason with an incident or change reference.'
}
if (-not $EmergencyBypassProvenanceGate -and -not [string]::IsNullOrWhiteSpace($EmergencyBypassReason)) {
    throw '-EmergencyBypassReason can only be used with -EmergencyBypassProvenanceGate.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$scratchRoot = Join-Path $projectRoot 'scratch'
# Migrations are mandatory for every production promotion. -ApplyMigrations is
# retained only for compatibility with older deployment commands.
$migrationMode = 'apply'

function Get-FileSha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Get-BytesSha256Hex {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
    }
}

function Get-SafeScratchPath {
    param([Parameter(Mandatory = $true)][string]$ChildName)

    if ([IO.Path]::IsPathRooted($ChildName) -or $ChildName -match '[\\/]') {
        throw "Scratch child name must be a single path segment: $ChildName"
    }
    $root = [IO.Path]::GetFullPath($scratchRoot).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $candidate = [IO.Path]::GetFullPath((Join-Path $root $ChildName))
    $prefix = "$root$([IO.Path]::DirectorySeparatorChar)"
    if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe scratch path: $candidate"
    }
    return $candidate
}

function Install-CiWebArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$ExtractPath
    )

    if (Test-Path -LiteralPath $ExtractPath) {
        throw "CI artifact extraction path already exists: $ExtractPath"
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    $entryNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$totalUncompressedBytes = 0
    try {
        foreach ($entry in $zip.Entries) {
            $entryName = $entry.FullName.Replace('\', '/')
            $segments = @($entryName.Split('/') | Where-Object { $_.Length -gt 0 })
            if ([string]::IsNullOrWhiteSpace($entryName) -or
                $entryName.StartsWith('/') -or
                $entryName -match ':' -or
                $segments -contains '.' -or
                $segments -contains '..') {
                throw "Unsafe path in CI artifact: $entryName"
            }
            $trimmedEntryName = $entryName.TrimEnd('/')
            $allowedArtifactEntry =
                $trimmedEntryName -in @('BulkaAndroid', 'BulkaAndroid/build', 'BulkaAndroid/build/web') -or
                $trimmedEntryName.StartsWith('BulkaAndroid/build/web/') -or
                $trimmedEntryName -in @('admin-ui', 'admin-ui/dist') -or
                $trimmedEntryName.StartsWith('admin-ui/dist/') -or
                $trimmedEntryName -in @('artifacts', 'artifacts/production-web', 'artifacts/production-web/SHA256SUMS')
            if (-not $allowedArtifactEntry) {
                throw "Unexpected path in CI web artifact: $entryName"
            }
            if (-not $entryNames.Add($entryName)) {
                throw "Duplicate or case-colliding path in CI artifact: $entryName"
            }
            $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            if ($unixFileType -eq 0xA000) {
                throw "Symbolic links are not allowed in the CI web artifact: $entryName"
            }
            $totalUncompressedBytes += $entry.Length
            if ($totalUncompressedBytes -gt 512MB) {
                throw 'CI web artifact expands beyond the 512 MiB release limit.'
            }
        }
    } finally {
        $zip.Dispose()
    }

    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractPath
    $extractFull = [IO.Path]::GetFullPath($ExtractPath).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $extractPrefix = "$extractFull$([IO.Path]::DirectorySeparatorChar)"
    $inventoryPath = Join-Path $extractFull 'artifacts\production-web\SHA256SUMS'
    $flutterSource = Join-Path $extractFull 'BulkaAndroid\build\web'
    $adminSource = Join-Path $extractFull 'admin-ui\dist'
    foreach ($requiredPath in @(
        $inventoryPath,
        (Join-Path $flutterSource 'index.html'),
        (Join-Path $flutterSource 'main.dart.js'),
        (Join-Path $flutterSource 'release-version.json'),
        (Join-Path $adminSource 'index.html')
    )) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "CI web artifact is incomplete: $requiredPath"
        }
    }

    $expected = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
    foreach ($line in (Get-Content -LiteralPath $inventoryPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -notmatch '^([0-9a-f]{64})[\t ]+\*?(.+)$') {
            throw "Invalid CI artifact inventory line: $line"
        }
        $expectedHash = $Matches[1]
        $relativePath = $Matches[2].Trim().Replace('\', '/')
        $segments = @($relativePath.Split('/') | Where-Object { $_.Length -gt 0 })
        if (($relativePath -notlike 'BulkaAndroid/build/web/*' -and
                $relativePath -notlike 'admin-ui/dist/*') -or
            $relativePath.StartsWith('/') -or
            $segments -contains '.' -or
            $segments -contains '..') {
            throw "Unsafe CI artifact inventory path: $relativePath"
        }
        if ($expected.ContainsKey($relativePath)) {
            throw "Duplicate CI artifact inventory path: $relativePath"
        }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $extractFull $relativePath))
        if (-not $fullPath.StartsWith($extractPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "CI artifact inventory references a missing or unsafe file: $relativePath"
        }
        $actualHash = Get-FileSha256Hex -Path $fullPath
        if ($actualHash -ne $expectedHash) {
            throw "CI artifact inventory hash mismatch: $relativePath"
        }
        $expected.Add($relativePath, $expectedHash)
    }
    if ($expected.Count -eq 0) {
        throw 'CI artifact inventory is empty.'
    }

    $actual = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($sourceDirectory in @($flutterSource, $adminSource)) {
        foreach ($file in Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse) {
            $relativePath = $file.FullName.Substring($extractPrefix.Length).Replace('\', '/')
            if (-not $actual.Add($relativePath)) {
                throw "Duplicate extracted CI artifact path: $relativePath"
            }
            if (-not $expected.ContainsKey($relativePath)) {
                throw "Uninventoried file in CI artifact: $relativePath"
            }
        }
    }
    if ($actual.Count -ne $expected.Count) {
        throw "CI artifact inventory count mismatch: expected $($expected.Count), found $($actual.Count)."
    }

    $flutterDestination = Join-Path $projectRoot 'public\app'
    $adminDestination = Join-Path $projectRoot 'admin-ui\dist'
    if (Test-Path -LiteralPath $flutterDestination) {
        Remove-Item -LiteralPath $flutterDestination -Recurse -Force
    }
    if (Test-Path -LiteralPath $adminDestination) {
        Remove-Item -LiteralPath $adminDestination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $flutterDestination -Force | Out-Null
    New-Item -ItemType Directory -Path $adminDestination -Force | Out-Null
    Copy-Item -Path (Join-Path $flutterSource '*') -Destination $flutterDestination -Recurse
    Copy-Item -Path (Join-Path $adminSource '*') -Destination $adminDestination -Recurse
    return $expected.Count
}

function Assert-CleanWorkingTree {
    $changes = @(git -C $projectRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw 'The project is not a valid Git working tree.'
    }
    if ($changes.Count -gt 0) {
        $preview = ($changes | Select-Object -First 12) -join [Environment]::NewLine
        throw "Deployment requires a clean Git working tree. Commit or stash changes first.`n$preview"
    }
}

Assert-CleanWorkingTree
$commitSha = (git -C $projectRoot rev-parse HEAD).Trim()
$shortCommit = $commitSha.Substring(0, 12)
$gitBranch = (git -C $projectRoot rev-parse --abbrev-ref HEAD).Trim()
$releaseId = "$(Get-Date -Format 'yyyyMMddHHmmss')-$shortCommit"
$stageRoot = Get-SafeScratchPath -ChildName "vps-release-$releaseId"
$archivePath = Get-SafeScratchPath -ChildName "bulka-release-$releaseId.zip"
$ciArtifactArchive = Get-SafeScratchPath -ChildName "production-web-$releaseId.zip"
$ciArtifactExtract = Get-SafeScratchPath -ChildName "production-web-$releaseId"
$remoteArchive = "/tmp/bulka-release-$releaseId.zip"
$remoteDeployScript = "/tmp/bulka-deploy-release-$releaseId.sh"
$remotePostgresScript = "/tmp/bulka-ensure-postgres-client-$releaseId.sh"
$provenance = $null
if ($EmergencyBypassProvenanceGate) {
    Write-Warning @"
EMERGENCY RELEASE PROVENANCE BYPASS IS ACTIVE.
Commit: $commitSha
Branch: $gitBranch
Reason: $EmergencyBypassReason
The origin/main and GitHub Actions success checks were not performed. The clean-tree check remains enforced.
"@
    $provenance = [ordered]@{
        verified = $false
        status = 'emergency-bypass'
        reason = $EmergencyBypassReason
        operator = [Environment]::UserName
        recordedAt = [DateTime]::UtcNow.ToString('o')
    }
} else {
    if ((Test-Path -LiteralPath $ciArtifactArchive) -or
        (Test-Path -LiteralPath $ciArtifactExtract)) {
        throw "CI artifact scratch path already exists for release $releaseId. Remove only that release-specific scratch path and retry."
    }
    $provenanceJson = & node (Join-Path $projectRoot 'scripts\check-release-provenance.js') `
        --cwd $projectRoot --download-artifact $ciArtifactArchive --json
    if ($LASTEXITCODE -ne 0) {
        throw 'Release provenance verification failed. Push this exact main commit and wait for the CI workflow to succeed.'
    }
    try {
        $provenance = $provenanceJson | ConvertFrom-Json
    } catch {
        throw 'Release provenance verifier returned invalid JSON.'
    }
    if (-not $provenance.verified -or $provenance.commitSha -ne $commitSha) {
        throw 'Release provenance verifier did not attest the current commit.'
    }
    $downloadedArtifactHash = Get-FileSha256Hex -Path $ciArtifactArchive
    if ($provenance.downloadedArchiveSha256 -ne $downloadedArtifactHash) {
        throw 'Downloaded CI artifact changed after the GitHub digest verification.'
    }
    $inventoryFileCount = Install-CiWebArtifact `
        -ArchivePath $ciArtifactArchive -ExtractPath $ciArtifactExtract
    Add-Member -InputObject $provenance -NotePropertyName inventoryFileCount `
        -NotePropertyValue $inventoryFileCount
    if ($SkipBuild) {
        Write-Host '-SkipBuild is retained for compatibility; normal releases always install the immutable CI web artifact.' `
            -ForegroundColor Yellow
    }
}

if ($EmergencyBypassProvenanceGate -and -not $SkipBuild) {
    & (Join-Path $projectRoot 'build_web.ps1')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Push-Location (Join-Path $projectRoot 'admin-ui')
    try {
        npm run lint
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        npm run build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
} elseif ($EmergencyBypassProvenanceGate) {
    Write-Warning 'Emergency bypass with -SkipBuild is using existing local ignored web outputs.'
}
Assert-CleanWorkingTree

$flutterBundlePath = Join-Path $projectRoot 'public\app\main.dart.js'
$flutterVersionPath = Join-Path $projectRoot 'public\app\release-version.json'
if (-not (Test-Path -LiteralPath $flutterBundlePath) -or
    -not (Test-Path -LiteralPath $flutterVersionPath)) {
    throw 'The finalized Flutter web release is missing.'
}
$flutterRelease = Get-Content -LiteralPath $flutterVersionPath -Raw | ConvertFrom-Json
$expectedFlutterHash = Get-FileSha256Hex -Path $flutterBundlePath
if ($flutterRelease.version -notin @($shortCommit, $commitSha)) {
    throw 'The Flutter web release version does not match the Git commit.'
}
if ($flutterRelease.mainSha256 -ne $expectedFlutterHash) {
    throw 'The Flutter web release manifest does not match main.dart.js.'
}

$scratchFull = [IO.Path]::GetFullPath($scratchRoot).TrimEnd('\')
$stageFull = [IO.Path]::GetFullPath($stageRoot)
$archiveFull = [IO.Path]::GetFullPath($archivePath)
if (-not $stageFull.StartsWith("$scratchFull\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe staging directory: $stageFull"
}
if (-not $archiveFull.StartsWith("$scratchFull\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe release archive: $archiveFull"
}
$archivePath = $archiveFull

if (Test-Path -LiteralPath $stageFull) {
    Remove-Item -LiteralPath $stageFull -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $stageFull 'public') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageFull 'admin-ui') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageFull 'scripts') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageFull 'supabase') -Force | Out-Null

$manifest = [ordered]@{
    schemaVersion = 1
    releaseId = $releaseId
    commitSha = $commitSha
    branch = $gitBranch
    builtAt = [DateTime]::UtcNow.ToString('o')
    migrationMode = $migrationMode
    source = 'clean-git-worktree'
    provenance = $provenance
}
[IO.File]::WriteAllText(
    (Join-Path $stageFull 'release-manifest.json'),
    ($manifest | ConvertTo-Json -Depth 6),
    [Text.UTF8Encoding]::new($false)
)

Copy-Item -Path (Join-Path $projectRoot 'public\*') `
    -Destination (Join-Path $stageFull 'public') -Recurse
$taplinkAssetStage = Join-Path $stageFull 'public\taplink\assets'
$taplinkBrandStage = Join-Path $taplinkAssetStage 'brand'
$taplinkFontStage = Join-Path $taplinkAssetStage 'fonts'
New-Item -ItemType Directory -Path $taplinkBrandStage -Force | Out-Null
New-Item -ItemType Directory -Path $taplinkFontStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'BulkaAndroid\assets\brand\bulka_logo.png') `
    -Destination $taplinkBrandStage
foreach ($fontName in @(
    'GolosText-Regular.ttf',
    'GolosText-SemiBold.ttf',
    'Montserrat-Regular-subset.ttf'
)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "BulkaAndroid\assets\fonts\$fontName") `
        -Destination $taplinkFontStage
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'admin-ui\dist') `
    -Destination (Join-Path $stageFull 'admin-ui\dist') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') `
    -Destination (Join-Path $stageFull 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'supabase\migrations') `
    -Destination (Join-Path $stageFull 'supabase\migrations') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'index.js') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'supabase_schema.sql') -Destination $stageFull

foreach ($scriptName in @(
    'apply-migrations.js',
    'backup-database.sh',
    'backup-supabase-storage.js',
    'configure-forte-widget-vps.sh',
    'configure-iiko-astana-vps.sh',
    'deploy-release.sh',
    'enable-nginx-upstream-fallback.sh',
    'ensure-postgres-client.sh',
    'harden-nginx-access-logs.sh',
    'install-database-backup-timer.sh',
    'install-pm2-logrotate.sh',
    'prepare-cloudflare-origin.sh',
    'prepare-pg-connection.js',
    'probe-iiko-city-profile.js',
    'rollback-vps.sh',
    'run-database-restore-drill.sh',
    'setup-google-wallet.js',
    'verify-database-restore.sh'
)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\$scriptName") `
        -Destination (Join-Path $stageFull 'scripts')
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
tar -a -cf $archivePath -C $stageFull `
    public admin-ui src supabase scripts `
    index.js package.json package-lock.json supabase_schema.sql release-manifest.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$archiveSha256 = Get-FileSha256Hex -Path $archivePath

scp $archivePath "bulka-vps:$remoteArchive"
if ($LASTEXITCODE -ne 0) { throw "Release upload failed with exit code $LASTEXITCODE." }
scp (Join-Path $projectRoot 'scripts\deploy-release.sh') `
    "bulka-vps:$remoteDeployScript"
if ($LASTEXITCODE -ne 0) { throw "Deployment script upload failed with exit code $LASTEXITCODE." }
scp (Join-Path $projectRoot 'scripts\ensure-postgres-client.sh') `
    "bulka-vps:$remotePostgresScript"
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL helper upload failed with exit code $LASTEXITCODE." }

ssh bulka-vps "bash '$remoteDeployScript' '$releaseId' '$migrationMode' '$remoteArchive' '$archiveSha256' '$remotePostgresScript' '$remoteDeployScript'"
if ($LASTEXITCODE -ne 0) { throw "Remote deployment failed with exit code $LASTEXITCODE." }

$publicReadiness = Invoke-RestMethod -Uri 'https://bulka.com.kz/readyz' -TimeoutSec 20
if ($publicReadiness.status -ne 'ready') {
    throw 'Public readiness check failed.'
}

$remoteFlutterHashOutput = @(
    ssh bulka-vps "sha256sum /var/www/iiko-bonus/public/app/main.dart.js | cut -d' ' -f1"
)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$remoteFlutterHash = ($remoteFlutterHashOutput | Select-Object -Last 1).Trim().ToLowerInvariant()
if ($remoteFlutterHash -ne $expectedFlutterHash) {
    throw 'The VPS Flutter bundle hash does not match the release artifact.'
}

$httpClient = [Net.Http.HttpClient]::new()
try {
    $httpClient.DefaultRequestHeaders.CacheControl =
        [Net.Http.Headers.CacheControlHeaderValue]::Parse('no-cache')
    $publicFlutterBytes = $httpClient.GetByteArrayAsync(
        "https://bulka.com.kz/main.dart.js?release=$shortCommit"
    ).GetAwaiter().GetResult()
} finally {
    $httpClient.Dispose()
}
$publicFlutterHash = Get-BytesSha256Hex -Bytes $publicFlutterBytes
if ($publicFlutterHash -ne $expectedFlutterHash) {
    throw 'The public Flutter bundle hash does not match the release artifact.'
}

try {
    Remove-Item -LiteralPath $archiveFull -Force
    Remove-Item -LiteralPath $stageFull -Recurse -Force
    if (Test-Path -LiteralPath $ciArtifactArchive) {
        Remove-Item -LiteralPath $ciArtifactArchive -Force
    }
    if (Test-Path -LiteralPath $ciArtifactExtract) {
        Remove-Item -LiteralPath $ciArtifactExtract -Recurse -Force
    }
} catch {
    Write-Warning "Local release staging cleanup failed: $($_.Exception.Message)"
}

Write-Host 'Deployment completed: https://bulka.com.kz' -ForegroundColor Green
Write-Host "Flutter bundle verified: $expectedFlutterHash" -ForegroundColor Green
if ($EmergencyBypassProvenanceGate) {
    Write-Warning "Deployment used the emergency provenance bypass: $EmergencyBypassReason"
} else {
    Write-Host "GitHub CI artifact verified: run $($provenance.workflowRunId), artifact $($provenance.artifactId)." `
        -ForegroundColor Green
}
Write-Host 'Staging is running privately on the VPS at 127.0.0.1:3101.' -ForegroundColor Green
Write-Host 'The three latest healthy versions are available through scripts/rollback-vps.sh.' `
    -ForegroundColor Green

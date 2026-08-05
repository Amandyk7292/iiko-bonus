param(
    [switch]$SkipBuild,
    [switch]$ApplyMigrations,
    [switch]$SkipMigrations
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
if ($ApplyMigrations -and $SkipMigrations) {
    throw 'Use either -ApplyMigrations or -SkipMigrations, not both.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$scratchRoot = Join-Path $projectRoot 'scratch'
$stageRoot = Join-Path $scratchRoot 'vps-release'
$archivePath = Join-Path $scratchRoot 'bulka-release.zip'
$remoteArchive = '/tmp/bulka-release.zip'
$remoteDeployScript = '/tmp/bulka-deploy-release.sh'
$remotePostgresScript = '/tmp/bulka-ensure-postgres-client.sh'
# New migrations are applied by default. -ApplyMigrations remains accepted for
# compatibility with older deployment commands.
$migrationMode = if ($SkipMigrations) { 'check' } else { 'apply' }

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

if (-not $SkipBuild) {
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
if (-not $stageFull.StartsWith("$scratchFull\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe staging directory: $stageFull"
}

if (Test-Path -LiteralPath $stageFull) {
    Remove-Item -LiteralPath $stageFull -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $stageFull 'public') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageFull 'admin-ui') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageFull 'kaspi-pos-automation-main') -Force | Out-Null
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
}
[IO.File]::WriteAllText(
    (Join-Path $stageFull 'release-manifest.json'),
    ($manifest | ConvertTo-Json -Depth 4),
    [Text.UTF8Encoding]::new($false)
)

Copy-Item -Path (Join-Path $projectRoot 'public\*') `
    -Destination (Join-Path $stageFull 'public') -Recurse
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
    'enable-nginx-upstream-fallback.sh',
    'ensure-postgres-client.sh',
    'install-database-backup-timer.sh',
    'install-pm2-logrotate.sh',
    'setup-google-wallet.js',
    'deploy-release.sh',
    'rollback-vps.sh',
    'verify-database-restore.sh',
    'run-database-restore-drill.sh',
    'prepare-cloudflare-origin.sh',
    'configure-forte-widget-vps.sh',
    'configure-iiko-astana-vps.sh',
    'probe-iiko-city-profile.js',
    'harden-nginx-access-logs.sh'
)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\$scriptName") `
        -Destination (Join-Path $stageFull 'scripts')
}

$kaspiSource = Join-Path $projectRoot 'kaspi-pos-automation-main'
$kaspiStage = Join-Path $stageFull 'kaspi-pos-automation-main'
Copy-Item -LiteralPath (Join-Path $kaspiSource 'src') `
    -Destination (Join-Path $kaspiStage 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $kaspiSource 'public') `
    -Destination (Join-Path $kaspiStage 'public') -Recurse
Copy-Item -LiteralPath (Join-Path $kaspiSource 'server.js') -Destination $kaspiStage
Copy-Item -LiteralPath (Join-Path $kaspiSource 'package.json') -Destination $kaspiStage
Copy-Item -LiteralPath (Join-Path $kaspiSource 'package-lock.json') -Destination $kaspiStage

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
tar -a -cf $archivePath -C $stageFull `
    public admin-ui src supabase scripts kaspi-pos-automation-main `
    index.js package.json package-lock.json supabase_schema.sql release-manifest.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$archiveSha256 = Get-FileSha256Hex -Path $archivePath

scp $archivePath "bulka-vps:$remoteArchive"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
scp (Join-Path $projectRoot 'scripts\deploy-release.sh') `
    "bulka-vps:$remoteDeployScript"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
scp (Join-Path $projectRoot 'scripts\ensure-postgres-client.sh') `
    "bulka-vps:$remotePostgresScript"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
ssh bulka-vps "bash '$remotePostgresScript'"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

ssh bulka-vps "bash '$remoteDeployScript' '$releaseId' '$migrationMode' '$remoteArchive' '$archiveSha256'"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

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

Write-Host 'Deployment completed: https://bulka.com.kz' -ForegroundColor Green
Write-Host "Flutter bundle verified: $expectedFlutterHash" -ForegroundColor Green
Write-Host 'Staging is running privately on the VPS at 127.0.0.1:3101.' -ForegroundColor Green
Write-Host 'The three latest healthy versions are available through scripts/rollback-vps.sh.' `
    -ForegroundColor Green

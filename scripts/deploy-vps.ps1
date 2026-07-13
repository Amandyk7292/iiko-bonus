param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$scratchRoot = Join-Path $projectRoot 'scratch'
$stageRoot = Join-Path $scratchRoot 'vps-release'
$archivePath = Join-Path $scratchRoot 'bulka-release.zip'
$remoteArchive = '/tmp/bulka-release.zip'
$releaseId = Get-Date -Format 'yyyyMMddHHmmss'

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

Copy-Item -LiteralPath (Join-Path $projectRoot 'public\app') `
    -Destination (Join-Path $stageFull 'public\app') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'admin-ui\dist') `
    -Destination (Join-Path $stageFull 'admin-ui\dist') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') `
    -Destination (Join-Path $stageFull 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'migrations') `
    -Destination (Join-Path $stageFull 'migrations') -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'index.js') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json') -Destination $stageFull
Copy-Item -LiteralPath (Join-Path $projectRoot 'supabase_schema.sql') -Destination $stageFull

$kaspiSource = Join-Path $projectRoot 'kaspi-pos-automation-main'
$kaspiStage = Join-Path $stageFull 'kaspi-pos-automation-main'
Copy-Item -LiteralPath (Join-Path $kaspiSource 'src') -Destination (Join-Path $kaspiStage 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $kaspiSource 'public') -Destination (Join-Path $kaspiStage 'public') -Recurse
Copy-Item -LiteralPath (Join-Path $kaspiSource 'server.js') -Destination $kaspiStage
Copy-Item -LiteralPath (Join-Path $kaspiSource 'package.json') -Destination $kaspiStage
Copy-Item -LiteralPath (Join-Path $kaspiSource 'package-lock.json') -Destination $kaspiStage

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
tar -a -cf $archivePath -C $stageFull `
    public admin-ui src migrations kaspi-pos-automation-main `
    index.js package.json package-lock.json supabase_schema.sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

scp $archivePath "bulka-vps:$remoteArchive"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$remoteScript = @"
set -euo pipefail
project=/var/www/iiko-bonus
release=/tmp/bulka-release-$releaseId
backup=/tmp/bulka-backup-$releaseId
archive=$remoteArchive
case "`$release" in /tmp/bulka-release-*) ;; *) exit 1 ;; esac
case "`$backup" in /tmp/bulka-backup-*) ;; *) exit 1 ;; esac
mkdir -p "`$release"
unzip -oq "`$archive" -d "`$release"

test -f "`$release/src/server.js"
test -f "`$release/public/app/index.html"
test -f "`$release/admin-ui/dist/index.html"
test -f "`$release/kaspi-pos-automation-main/server.js"

mkdir -p "`$backup/public" "`$backup/admin-ui" "`$backup/kaspi-pos-automation-main"
rsync -a "`$project/src/" "`$backup/src/"
rsync -a "`$project/migrations/" "`$backup/migrations/"
rsync -a "`$project/public/app/" "`$backup/public/app/"
rsync -a "`$project/admin-ui/dist/" "`$backup/admin-ui/dist/"
rsync -a "`$project/kaspi-pos-automation-main/src/" "`$backup/kaspi-pos-automation-main/src/"
rsync -a "`$project/kaspi-pos-automation-main/public/" "`$backup/kaspi-pos-automation-main/public/"
cp "`$project/index.js" "`$project/package.json" "`$project/package-lock.json" "`$backup/"
cp "`$project/supabase_schema.sql" "`$backup/"
cp "`$project/kaspi-pos-automation-main/server.js" \
  "`$project/kaspi-pos-automation-main/package.json" \
  "`$project/kaspi-pos-automation-main/package-lock.json" \
  "`$backup/kaspi-pos-automation-main/"

rollback() {
  trap - ERR
  rsync -a --delete "`$backup/src/" "`$project/src/"
  rsync -a --delete "`$backup/migrations/" "`$project/migrations/"
  rsync -a --delete "`$backup/public/app/" "`$project/public/app/"
  rsync -a --delete "`$backup/admin-ui/dist/" "`$project/admin-ui/dist/"
  rsync -a --delete "`$backup/kaspi-pos-automation-main/src/" "`$project/kaspi-pos-automation-main/src/"
  rsync -a --delete "`$backup/kaspi-pos-automation-main/public/" "`$project/kaspi-pos-automation-main/public/"
  cp "`$backup/index.js" "`$backup/package.json" "`$backup/package-lock.json" "`$backup/supabase_schema.sql" "`$project/"
  cp "`$backup/kaspi-pos-automation-main/server.js" \
    "`$backup/kaspi-pos-automation-main/package.json" \
    "`$backup/kaspi-pos-automation-main/package-lock.json" \
    "`$project/kaspi-pos-automation-main/"
  cd "`$project"
  npm ci --omit=dev --no-audit --no-fund
  npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
  pm2 restart iiko-bonus --update-env
  pm2 save
}
trap rollback ERR

rsync -a --delete "`$release/src/" "`$project/src/"
rsync -a --delete "`$release/migrations/" "`$project/migrations/"
rsync -a --delete "`$release/public/app/" "`$project/public/app/"
rsync -a --delete "`$release/admin-ui/dist/" "`$project/admin-ui/dist/"
rsync -a --delete "`$release/kaspi-pos-automation-main/src/" "`$project/kaspi-pos-automation-main/src/"
rsync -a --delete "`$release/kaspi-pos-automation-main/public/" "`$project/kaspi-pos-automation-main/public/"
cp "`$release/index.js" "`$release/package.json" "`$release/package-lock.json" "`$release/supabase_schema.sql" "`$project/"
cp "`$release/kaspi-pos-automation-main/server.js" \
  "`$release/kaspi-pos-automation-main/package.json" \
  "`$release/kaspi-pos-automation-main/package-lock.json" \
  "`$project/kaspi-pos-automation-main/"

cd "`$project"
npm ci --omit=dev --no-audit --no-fund
npm --prefix kaspi-pos-automation-main ci --omit=dev --no-audit --no-fund
pm2 restart iiko-bonus --update-env
for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done
test "`$healthy" = 1
curl -fsS http://127.0.0.1:3000/healthz
pm2 save
trap - ERR
rm -rf -- "`$release"
rm -rf -- "`$backup"
rm -f -- "`$archive"
"@

$remoteScript | ssh bulka-vps 'bash -s'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$publicHealth = Invoke-RestMethod -Uri 'https://bulka.com.kz/healthz' -TimeoutSec 20
if ($publicHealth.status -ne 'ok') {
    throw 'Public health check failed.'
}

Write-Host 'Deployment completed: https://bulka.com.kz' -ForegroundColor Green
